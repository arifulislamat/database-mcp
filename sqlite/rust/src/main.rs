//! SQLite adapter over rusqlite (bundled SQLite). Zero MCP types.

use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use database_mcp_rs_core::{Adapter, Config, EnvNames, QueryResult, run};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, ErrorCode, OpenFlags};
use serde_json::{Map, Value, json};

const JS_SAFE_MAX: i64 = (1 << 53) - 1;

fn main() -> ExitCode {
    run::<SqliteAdapter>(env!("CARGO_PKG_VERSION"))
}

/// Integers beyond the JS safe range are returned as strings (JSON-safe).
/// Blobs have no JSON form; they are returned as lowercase hex.
fn to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) if i.abs() > JS_SAFE_MAX => Value::String(i.to_string()),
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::String(b.iter().map(|x| format!("{x:02x}")).collect()),
    }
}

struct SqliteAdapter {
    // ponytail: one connection behind a mutex serializes all calls; fine for a
    // local file, a pool if concurrent HTTP sessions ever need parallel reads.
    db: Arc<Mutex<Connection>>,
}

impl SqliteAdapter {
    /// rusqlite is synchronous; run each call off the async runtime.
    async fn with_db<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || f(&db.lock().unwrap_or_else(|e| e.into_inner())))
            .await
            .map_err(|e| e.to_string())?
    }
}

impl Adapter for SqliteAdapter {
    const ENGINE: &'static str = "sqlite";
    const ENV: EnvNames = EnvNames {
        prefix: "SQLITE",
        dsn_var: Some("SQLITE_PATH"),
        password_var: None,
    };

    async fn connect(config: &Config) -> Result<Self, String> {
        let path = config.connection.dsn.as_deref().ok_or(
            "config: no database given, pass --dsn /path/to.db, set SQLITE_PATH, or use --config",
        )?;
        // A read-only open makes the file read-only at the OS level;
        // query_only makes the session reject writes too. Layer-two
        // enforcement per the tool contract. No CREATE flag: the file must
        // exist, mirroring fileMustExist in the TS line.
        let read_only = config.guardrails.read_only;
        let flags = if read_only {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE
        } | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let db = Connection::open_with_flags(path, flags).map_err(|e| e.to_string())?;
        if read_only {
            db.pragma_update(None, "query_only", "ON")
                .map_err(|e| e.to_string())?;
        }
        Ok(SqliteAdapter {
            db: Arc::new(Mutex::new(db)),
        })
    }

    async fn query(
        &self,
        sql: &str,
        max_rows: usize,
        timeout_ms: u64,
    ) -> Result<QueryResult, String> {
        let sql = sql.to_string();
        self.with_db(move |db| {
            // The progress handler interrupts a running statement once the
            // deadline passes, including a single slow aggregate.
            let deadline = Instant::now() + Duration::from_millis(timeout_ms);
            db.progress_handler(1000, Some(move || Instant::now() > deadline))
                .map_err(|e| e.to_string())?;
            let result = run_query(db, &sql, max_rows);
            let _ = db.progress_handler(0, None::<fn() -> bool>);
            result.map_err(|e| match e.sqlite_error_code() {
                Some(ErrorCode::OperationInterrupted) => {
                    format!("timeout: query exceeded {timeout_ms}ms")
                }
                _ => e.to_string(),
            })
        })
        .await
    }

    async fn list_tables(&self) -> Result<Vec<Value>, String> {
        self.with_db(|db| list_tables(db).map_err(|e| e.to_string()))
            .await
    }

    async fn describe_table(&self, table: &str) -> Result<Value, String> {
        let table = table.to_string();
        self.with_db(move |db| describe(db, &table)).await
    }
}

fn list_tables(db: &Connection) -> rusqlite::Result<Vec<Value>> {
    let names: Vec<String> = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    names
        .into_iter()
        .map(|name| {
            let quoted = name.replace('"', "\"\"");
            let n: i64 = db.query_row(&format!("SELECT count(*) FROM \"{quoted}\""), [], |r| {
                r.get(0)
            })?;
            Ok(json!({ "name": name, "estimatedRows": n }))
        })
        .collect()
}

fn run_query(db: &Connection, sql: &str, max_rows: usize) -> rusqlite::Result<QueryResult> {
    let mut stmt = db.prepare(sql)?;
    if stmt.column_count() == 0 {
        let affected = stmt.execute([])?;
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: affected as u64,
            truncated: false,
        });
    }
    let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut rows = Vec::new();
    let mut truncated = false;
    let mut cursor = stmt.query([])?;
    while let Some(row) = cursor.next()? {
        if rows.len() >= max_rows {
            truncated = true;
            break;
        }
        let mut obj = Map::new();
        for (i, c) in columns.iter().enumerate() {
            obj.insert(c.clone(), to_json(row.get_ref(i)?));
        }
        rows.push(obj);
    }
    Ok(QueryResult {
        row_count: rows.len() as u64,
        columns,
        rows,
        truncated,
    })
}

fn describe(db: &Connection, table: &str) -> Result<Value, String> {
    let err = |e: rusqlite::Error| e.to_string();
    let columns: Vec<Value> = db
        .prepare("SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?1)")
        .map_err(err)?
        .query_map([table], |r| {
            Ok(json!({
                "name": r.get::<_, String>(0)?,
                "type": r.get::<_, String>(1)?,
                "nullable": r.get::<_, i64>(2)? == 0,
                "key": if r.get::<_, i64>(4)? != 0 { Some("PRI") } else { None },
                "default": r.get::<_, Option<String>>(3)?,
            }))
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    if columns.is_empty() {
        return Err(format!("unknown table: {table}"));
    }

    let index_list: Vec<(String, bool)> = db
        .prepare("SELECT name, \"unique\" FROM pragma_index_list(?1)")
        .map_err(err)?
        .query_map([table], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut indexes = Vec::new();
    for (name, unique) in index_list {
        let cols: Vec<String> = db
            .prepare("SELECT name FROM pragma_index_info(?1)")
            .map_err(err)?
            .query_map([&name], |r| r.get(0))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        indexes.push(json!({ "name": name, "columns": cols, "unique": unique }));
    }

    // SQLite FKs are unnamed; synthesize a stable name from the FK id.
    let mut fks: Vec<(i64, Value)> = Vec::new();
    let mut stmt = db
        .prepare("SELECT id, \"table\", \"from\", \"to\" FROM pragma_foreign_key_list(?1) ORDER BY id, seq")
        .map_err(err)?;
    let mut rows = stmt.query([table]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: i64 = r.get(0).map_err(err)?;
        if fks.last().map(|(last, _)| *last) != Some(id) {
            fks.push((
                id,
                json!({
                    "name": format!("fk_{table}_{id}"),
                    "columns": [],
                    "referencesTable": r.get::<_, String>(1).map_err(err)?,
                    "referencesColumns": [],
                }),
            ));
        }
        let fk = &mut fks.last_mut().unwrap().1;
        fk["columns"]
            .as_array_mut()
            .unwrap()
            .push(json!(r.get::<_, String>(2).map_err(err)?));
        fk["referencesColumns"]
            .as_array_mut()
            .unwrap()
            .push(json!(r.get::<_, Option<String>>(3).map_err(err)?));
    }

    Ok(json!({
        "name": table,
        "columns": columns,
        "indexes": indexes,
        "foreignKeys": fks.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
    }))
}
