//! libSQL adapter over the official libsql crate. Zero MCP types.
//!
//! libSQL is a SQLite fork: catalog queries are identical to the SQLite
//! adapter's. What differs is the transport: the driver speaks to local files
//! and remote servers (libsql:/https:/ws:) with an auth token.

use std::process::ExitCode;
use std::time::Duration;

use database_mcp_rs_core::{Adapter, Config, EnvNames, QueryResult, run};
use libsql::{Builder, Connection, Database, OpenFlags, Value as Sql};
use serde_json::{Map, Value, json};

const JS_SAFE_MAX: i64 = (1 << 53) - 1;

fn main() -> ExitCode {
    run::<LibsqlAdapter>(env!("CARGO_PKG_VERSION"))
}

/// Integers beyond the JS safe range are returned as strings (JSON-safe).
/// Blobs have no JSON form; they are returned as lowercase hex.
fn to_json(v: Sql) -> Value {
    match v {
        Sql::Null => Value::Null,
        Sql::Integer(i) if i.abs() > JS_SAFE_MAX => Value::String(i.to_string()),
        Sql::Integer(i) => json!(i),
        Sql::Real(f) => json!(f),
        Sql::Text(t) => Value::String(t),
        Sql::Blob(b) => Value::String(b.iter().map(|x| format!("{x:02x}")).collect()),
    }
}

fn text(v: Sql) -> Option<String> {
    match v {
        Sql::Text(t) => Some(t),
        Sql::Integer(i) => Some(i.to_string()),
        _ => None,
    }
}

fn int(v: &Sql) -> i64 {
    match v {
        Sql::Integer(i) => *i,
        _ => 0,
    }
}

struct LibsqlAdapter {
    conn: Connection,
    remote_read_only: bool,
    // The connection borrows from the database handle; keep it alive.
    _db: Database,
}

impl LibsqlAdapter {
    /// Every row of a single-parameter catalog query, as raw values.
    async fn rows(&self, sql: &str, param: &str) -> Result<Vec<Vec<Sql>>, String> {
        let mut rows = self
            .conn
            .query(sql, [param])
            .await
            .map_err(|e| e.to_string())?;
        let width = rows.column_count();
        let mut out = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            out.push(
                (0..width)
                    .map(|i| row.get_value(i).unwrap_or(Sql::Null))
                    .collect(),
            );
        }
        Ok(out)
    }

    async fn run_query(&self, sql: &str, max_rows: usize) -> libsql::Result<QueryResult> {
        if self.remote_read_only {
            self.conn.execute("PRAGMA query_only = ON", ()).await?;
        }
        let stmt = self.conn.prepare(sql).await?;
        let columns: Vec<String> = stmt
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
        if columns.is_empty() {
            let affected = stmt.execute(()).await?;
            return Ok(QueryResult {
                columns,
                rows: vec![],
                row_count: affected as u64,
                truncated: false,
            });
        }
        let mut cursor = stmt.query(()).await?;
        let mut rows = Vec::new();
        let mut truncated = false;
        while let Some(row) = cursor.next().await? {
            if rows.len() >= max_rows {
                truncated = true;
                break;
            }
            let mut obj = Map::new();
            for (i, c) in columns.iter().enumerate() {
                obj.insert(c.clone(), to_json(row.get_value(i as i32)?));
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
}

impl Adapter for LibsqlAdapter {
    const ENGINE: &'static str = "libsql";
    const ENV: EnvNames = EnvNames {
        prefix: "LIBSQL",
        dsn_var: Some("LIBSQL_URL"),
        password_var: Some("LIBSQL_AUTH_TOKEN"),
    };

    async fn connect(config: &Config) -> Result<Self, String> {
        let url = config.connection.dsn.as_deref().ok_or(
            "config: no database given, pass --dsn <file-or-libsql-url>, set LIBSQL_URL, or use --config",
        )?;
        let read_only = config.guardrails.read_only;
        let err = |e: libsql::Error| e.to_string();
        let remote = ["libsql://", "http://", "https://", "ws://", "wss://"]
            .iter()
            .any(|p| url.starts_with(p));

        let db = if remote {
            let token = config
                .connection
                .password
                .as_ref()
                .map(|s| s.reveal().to_string())
                .unwrap_or_default();
            Builder::new_remote(url.to_string(), token)
                .build()
                .await
                .map_err(err)?
        } else {
            // The driver takes a plain path for local files; strip the file:
            // scheme the conformance harness (and the TS line) uses. A
            // read-only open is layer two on top of query_only. No CREATE
            // flag: the file must exist.
            let path = url.strip_prefix("file:").unwrap_or(url);
            let flags = if read_only {
                OpenFlags::SQLITE_OPEN_READ_ONLY
            } else {
                OpenFlags::SQLITE_OPEN_READ_WRITE
            };
            Builder::new_local(path)
                .flags(flags)
                .build()
                .await
                .map_err(err)?
        };
        let conn = db.connect().map_err(err)?;

        if read_only {
            conn.execute("PRAGMA query_only = ON", ())
                .await
                .map_err(err)?;
        }
        // Fail fast on bad URL/credentials.
        conn.query("SELECT 1", ()).await.map_err(err)?;
        // Remote: the server drops an idle stream and the driver silently
        // opens a fresh one without the pragma, so run_query() sets it again
        // right before every query.
        Ok(LibsqlAdapter {
            conn,
            remote_read_only: read_only && remote,
            _db: db,
        })
    }

    async fn query(
        &self,
        sql: &str,
        max_rows: usize,
        timeout_ms: u64,
    ) -> Result<QueryResult, String> {
        let limit = Duration::from_millis(timeout_ms);
        // A local statement runs synchronously inside the future, blocking
        // its runtime worker, so neither the outer timeout nor a spawned task
        // (stuck in that worker's LIFO slot) can fire mid-step. A plain
        // thread interrupts the connection at the deadline unless the query
        // finishes first. Remote connections don't support interrupt; there
        // the outer timeout abandons the call instead.
        let conn = self.conn.clone();
        let (done, finished) = std::sync::mpsc::channel::<()>();
        let watchdog = std::thread::spawn(move || {
            let fired = finished.recv_timeout(limit).is_err();
            if fired {
                let _ = conn.interrupt();
            }
            fired
        });
        let result = tokio::time::timeout(limit, self.run_query(sql, max_rows)).await;
        let _ = done.send(());
        let fired = watchdog.join().unwrap_or(true);
        match result {
            Ok(Ok(r)) => Ok(r),
            Ok(Err(e)) if !fired => Err(e.to_string()),
            _ => Err(format!("timeout: query exceeded {timeout_ms}ms")),
        }
    }

    async fn list_tables(&self) -> Result<Vec<Value>, String> {
        let mut names = Vec::new();
        let mut rows = self
            .conn
            .query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                (),
            )
            .await
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            names.push(row.get::<String>(0).map_err(|e| e.to_string())?);
        }
        let mut out = Vec::new();
        for name in names {
            let quoted = name.replace('"', "\"\"");
            let mut r = self
                .conn
                .query(&format!("SELECT count(*) FROM \"{quoted}\""), ())
                .await
                .map_err(|e| e.to_string())?;
            let n = match r.next().await.map_err(|e| e.to_string())? {
                Some(row) => row.get::<i64>(0).map_err(|e| e.to_string())?,
                None => 0,
            };
            out.push(json!({ "name": name, "estimatedRows": n }));
        }
        Ok(out)
    }

    async fn describe_table(&self, table: &str) -> Result<Value, String> {
        let cols = self
            .rows(
                "SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?1)",
                table,
            )
            .await?;
        if cols.is_empty() {
            return Err(format!("unknown table: {table}"));
        }
        let columns: Vec<Value> = cols
            .into_iter()
            .map(|c| {
                let [name, ty, notnull, default, pk] = <[Sql; 5]>::try_from(c).unwrap();
                json!({
                    "name": text(name),
                    "type": text(ty).unwrap_or_default(),
                    "nullable": int(&notnull) == 0,
                    "key": if int(&pk) != 0 { Some("PRI") } else { None },
                    "default": text(default),
                })
            })
            .collect();

        let mut indexes = Vec::new();
        for ix in self
            .rows("SELECT name, \"unique\" FROM pragma_index_list(?1)", table)
            .await?
        {
            let name = text(ix[0].clone()).unwrap_or_default();
            let cols: Vec<Option<String>> = self
                .rows("SELECT name FROM pragma_index_info(?1)", &name)
                .await?
                .into_iter()
                .map(|r| text(r[0].clone()))
                .collect();
            indexes.push(json!({ "name": name, "columns": cols, "unique": int(&ix[1]) != 0 }));
        }

        // SQLite-family FKs are unnamed; synthesize a stable name from the FK id.
        let mut fks: Vec<(i64, Value)> = Vec::new();
        let fk_rows = self
            .rows(
                "SELECT id, \"table\", \"from\", \"to\" FROM pragma_foreign_key_list(?1) ORDER BY id, seq",
                table,
            )
            .await?;
        for r in fk_rows {
            let id = int(&r[0]);
            if fks.last().map(|(last, _)| *last) != Some(id) {
                fks.push((
                    id,
                    json!({
                        "name": format!("fk_{table}_{id}"),
                        "columns": [],
                        "referencesTable": text(r[1].clone()),
                        "referencesColumns": [],
                    }),
                ));
            }
            let fk = &mut fks.last_mut().unwrap().1;
            fk["columns"]
                .as_array_mut()
                .unwrap()
                .push(json!(text(r[2].clone())));
            fk["referencesColumns"]
                .as_array_mut()
                .unwrap()
                .push(json!(text(r[3].clone())));
        }

        Ok(json!({
            "name": table,
            "columns": columns,
            "indexes": indexes,
            "foreignKeys": fks.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
        }))
    }
}
