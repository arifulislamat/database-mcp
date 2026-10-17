//! MySQL adapter over mysql_async. Zero MCP types.
//!
//! MariaDB shares the wire protocol, driver, and information_schema;
//! database-mcp-rs-mariadb reuses this adapter with its own `Flavor`.

use std::marker::PhantomData;
use std::time::Duration;

use database_mcp_rs_core::{Adapter, Config, EnvNames, QueryResult};
use mysql_async::consts::ColumnType as T;
use mysql_async::prelude::Queryable;
use mysql_async::{Column, Conn, Opts, OptsBuilder, Pool, Row, Value as My};
use serde_json::{Map, Value, json};

const JS_SAFE_MAX: i128 = (1 << 53) - 1;
/// The `binary` character set: BLOB, BINARY, VARBINARY and BIT columns.
const BINARY_CHARSET: u16 = 63;

/// What differs between MySQL-family engines: the label and env names.
pub trait Flavor: Send + Sync + 'static {
    const ENGINE: &'static str;
    const ENV: EnvNames;
}

pub struct Mysql;

impl Flavor for Mysql {
    const ENGINE: &'static str = "mysql";
    const ENV: EnvNames = EnvNames {
        prefix: "MYSQL",
        dsn_var: Some("MYSQL_DSN"),
        password_var: None,
    };
}

/// Text-protocol values arrive as bytes; the column type decides the JSON
/// form. Integers beyond the JS safe range and DECIMALs become strings
/// (JSON-safe), DATETIMEs use ISO 8601 like the Python line, JSON columns
/// are parsed, binary values become lowercase hex. DATE, TIME and JSON also
/// report the binary charset, so hex is decided by type, not charset alone.
fn to_json(v: My, col: &Column) -> Value {
    let bytes = match v {
        My::NULL => return Value::Null,
        My::Bytes(b) => b,
        // Not produced by the text protocol; render whatever arrives.
        My::Int(i) => return to_json(My::Bytes(i.to_string().into_bytes()), col),
        My::UInt(u) => return to_json(My::Bytes(u.to_string().into_bytes()), col),
        My::Float(f) => return json!(f),
        My::Double(f) => return json!(f),
        other => return Value::String(other.as_sql(true).trim_matches('\'').to_string()),
    };
    let text = || String::from_utf8_lossy(&bytes).into_owned();
    match col.column_type() {
        T::MYSQL_TYPE_TINY
        | T::MYSQL_TYPE_SHORT
        | T::MYSQL_TYPE_LONG
        | T::MYSQL_TYPE_INT24
        | T::MYSQL_TYPE_LONGLONG
        | T::MYSQL_TYPE_YEAR => match text().parse::<i128>() {
            Ok(i) if i.abs() <= JS_SAFE_MAX => json!(i as i64),
            _ => Value::String(text()),
        },
        T::MYSQL_TYPE_FLOAT | T::MYSQL_TYPE_DOUBLE => text()
            .parse::<f64>()
            .map(|f| json!(f))
            .unwrap_or(Value::String(text())),
        T::MYSQL_TYPE_DATETIME | T::MYSQL_TYPE_TIMESTAMP => {
            Value::String(text().replacen(' ', "T", 1))
        }
        T::MYSQL_TYPE_JSON => serde_json::from_slice(&bytes).unwrap_or(Value::String(text())),
        T::MYSQL_TYPE_TINY_BLOB
        | T::MYSQL_TYPE_MEDIUM_BLOB
        | T::MYSQL_TYPE_LONG_BLOB
        | T::MYSQL_TYPE_BLOB
        | T::MYSQL_TYPE_STRING
        | T::MYSQL_TYPE_VAR_STRING
        | T::MYSQL_TYPE_VARCHAR
        | T::MYSQL_TYPE_BIT
            if col.character_set() == BINARY_CHARSET =>
        {
            Value::String(bytes.iter().map(|x| format!("{x:02x}")).collect())
        }
        _ => Value::String(text()),
    }
}

/// A catalog value as text, whichever protocol encoding it came in.
fn text(row: &Row, i: usize) -> Option<String> {
    match row.as_ref(i)? {
        My::NULL => None,
        My::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
        My::Int(n) => Some(n.to_string()),
        My::UInt(n) => Some(n.to_string()),
        other => Some(other.as_sql(true).trim_matches('\'').to_string()),
    }
}

/// The server's own message, without the driver's "Server error: `ERROR ...`"
/// wrapper, so errors read the same as the TypeScript and Python lines.
fn message(e: mysql_async::Error) -> String {
    match e {
        mysql_async::Error::Server(s) => s.message,
        other => other.to_string(),
    }
}

pub struct MysqlAdapter<F = Mysql> {
    pool: Pool,
    flavor: PhantomData<fn() -> F>,
}

impl<F> MysqlAdapter<F> {
    async fn conn(&self) -> Result<Conn, String> {
        self.pool.get_conn().await.map_err(message)
    }

    /// Every row of a single-parameter catalog query.
    async fn rows(&self, sql: &str, param: &str) -> Result<Vec<Row>, String> {
        self.conn()
            .await?
            .exec(sql, (param,))
            .await
            .map_err(message)
    }

    async fn run_query(
        conn: &mut Conn,
        sql: &str,
        max_rows: usize,
    ) -> mysql_async::Result<QueryResult> {
        let mut result = conn.query_iter(sql).await?;
        let cols = result.columns().unwrap_or_else(|| Vec::new().into());
        if cols.is_empty() {
            let affected = result.affected_rows();
            result.drop_result().await?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                row_count: affected,
                truncated: false,
            });
        }
        let columns: Vec<String> = cols.iter().map(|c| c.name_str().into_owned()).collect();
        let mut rows = Vec::new();
        let mut truncated = false;
        // ponytail: past the cap the rest of the result is read and dropped
        // by the driver; server-side LIMIT injection if huge scans matter.
        while let Some(row) = result.next().await? {
            if rows.len() >= max_rows {
                truncated = true;
                continue;
            }
            let mut obj = Map::new();
            for (i, (name, col)) in columns.iter().zip(cols.iter()).enumerate() {
                obj.insert(
                    name.clone(),
                    to_json(row.as_ref(i).cloned().unwrap_or(My::NULL), col),
                );
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

impl<F: Flavor> Adapter for MysqlAdapter<F> {
    const ENGINE: &'static str = F::ENGINE;
    const ENV: EnvNames = F::ENV;

    async fn connect(config: &Config) -> Result<Self, String> {
        let c = &config.connection;
        let builder = match &c.dsn {
            Some(dsn) => OptsBuilder::from_opts(
                Opts::from_url(dsn).map_err(|e| format!("config: invalid DSN: {e}"))?,
            ),
            None if c.host.is_some() || c.database.is_some() => OptsBuilder::default()
                .ip_or_hostname(c.host.clone().unwrap_or("127.0.0.1".into()))
                .tcp_port(c.port.unwrap_or(3306))
                .user(c.user.clone())
                .pass(c.password.as_ref().map(|p| p.reveal().to_string()))
                .db_name(c.database.clone()),
            None => {
                let p = F::ENV.prefix;
                return Err(format!(
                    "config: no database given, pass --dsn mysql://user@host/db, \
                     set {p}_HOST/{p}_USER/{p}_DATABASE, or use --config"
                ));
            }
        };
        // Layer two: every pooled session rejects writes at the server,
        // catching what the SQL guard can't see (CTE-smuggled writes etc.).
        // `setup`, not `init`: the pool resets each connection on return,
        // which clears session settings, and only `setup` re-runs after it.
        let setup: Vec<&str> = if config.guardrails.read_only {
            vec!["SET SESSION TRANSACTION READ ONLY"]
        } else {
            vec![]
        };
        let pool = Pool::new(builder.setup(setup).prefer_socket(false));
        // Fail fast on bad host/credentials.
        let mut conn = pool.get_conn().await.map_err(message)?;
        conn.query_drop("SELECT 1").await.map_err(message)?;
        Ok(MysqlAdapter {
            pool,
            flavor: PhantomData,
        })
    }

    async fn query(
        &self,
        sql: &str,
        max_rows: usize,
        timeout_ms: u64,
    ) -> Result<QueryResult, String> {
        let mut conn = self.conn().await?;
        let id = conn.id();
        match tokio::time::timeout(
            Duration::from_millis(timeout_ms),
            Self::run_query(&mut conn, sql, max_rows),
        )
        .await
        {
            Ok(result) => result.map_err(message),
            Err(_) => {
                // Stop the work on the server too, from a second connection;
                // the pool drains the interrupted result before reusing it.
                if let Ok(mut killer) = self.pool.get_conn().await {
                    let _ = killer.query_drop(format!("KILL QUERY {id}")).await;
                }
                Err(format!("timeout: query exceeded {timeout_ms}ms"))
            }
        }
    }

    async fn list_tables(&self) -> Result<Vec<Value>, String> {
        let rows: Vec<Row> = self
            .conn()
            .await?
            .query(
                "SELECT TABLE_NAME AS name, TABLE_ROWS AS estimatedRows
                   FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE()
                  ORDER BY TABLE_NAME",
            )
            .await
            .map_err(message)?;
        Ok(rows
            .iter()
            .map(|r| {
                let n: i64 = text(r, 1).and_then(|s| s.parse().ok()).unwrap_or(0);
                json!({ "name": text(r, 0), "estimatedRows": n })
            })
            .collect())
    }

    async fn describe_table(&self, table: &str) -> Result<Value, String> {
        let cols = self
            .rows(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
                   FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                  ORDER BY ORDINAL_POSITION",
                table,
            )
            .await?;
        if cols.is_empty() {
            return Err(format!("unknown table: {table}"));
        }
        let columns: Vec<Value> = cols
            .iter()
            .map(|c| {
                json!({
                    "name": text(c, 0),
                    "type": text(c, 1),
                    "nullable": text(c, 2).as_deref() == Some("YES"),
                    "key": text(c, 3).filter(|k| !k.is_empty()),
                    "default": text(c, 4),
                })
            })
            .collect();

        let mut indexes: Vec<Value> = Vec::new();
        for r in self
            .rows(
                "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
                   FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                  ORDER BY INDEX_NAME, SEQ_IN_INDEX",
                table,
            )
            .await?
        {
            let name = text(&r, 0);
            if indexes
                .last()
                .map(|ix| ix["name"] != json!(name))
                .unwrap_or(true)
            {
                let unique = text(&r, 2).as_deref() == Some("0");
                indexes.push(json!({ "name": name, "columns": [], "unique": unique }));
            }
            indexes.last_mut().unwrap()["columns"]
                .as_array_mut()
                .unwrap()
                .push(json!(text(&r, 1)));
        }

        let mut fks: Vec<Value> = Vec::new();
        for r in self
            .rows(
                "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                   FROM information_schema.KEY_COLUMN_USAGE
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                    AND REFERENCED_TABLE_NAME IS NOT NULL
                  ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION",
                table,
            )
            .await?
        {
            let name = text(&r, 0);
            if fks
                .last()
                .map(|fk| fk["name"] != json!(name))
                .unwrap_or(true)
            {
                fks.push(json!({
                    "name": name,
                    "columns": [],
                    "referencesTable": text(&r, 2),
                    "referencesColumns": [],
                }));
            }
            let fk = fks.last_mut().unwrap();
            fk["columns"]
                .as_array_mut()
                .unwrap()
                .push(json!(text(&r, 1)));
            fk["referencesColumns"]
                .as_array_mut()
                .unwrap()
                .push(json!(text(&r, 3)));
        }

        Ok(json!({ "name": table, "columns": columns, "indexes": indexes, "foreignKeys": fks }))
    }
}
