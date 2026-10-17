//! PostgreSQL adapter over tokio-postgres. Zero MCP types.

use std::process::ExitCode;
use std::sync::Arc;

use database_mcp_rs_core::{Adapter, Config, EnvNames, QueryResult, Secret, log, run};
use serde_json::{Map, Value, json};
use tokio_postgres::types::Type;
use tokio_postgres::{Client, SimpleQueryMessage};
use tokio_postgres_rustls::MakeRustlsConnect;

const JS_SAFE_MAX: i128 = (1 << 53) - 1;

fn main() -> ExitCode {
    run::<PostgresAdapter>(env!("CARGO_PKG_VERSION"))
}

/// Simple-query values arrive as text; the prepared column type decides the
/// JSON form. BIGINTs beyond the JS safe range and NUMERICs become strings
/// (JSON-safe), timestamps use ISO 8601 like the Python line, JSON columns
/// are parsed, BYTEA becomes lowercase hex.
fn to_json(text: &str, ty: &Type) -> Value {
    match *ty {
        Type::INT2 | Type::INT4 | Type::INT8 | Type::OID => match text.parse::<i128>() {
            Ok(i) if i.abs() <= JS_SAFE_MAX => json!(i as i64),
            _ => Value::String(text.into()),
        },
        Type::FLOAT4 | Type::FLOAT8 => text
            .parse::<f64>()
            .ok()
            .filter(|f| f.is_finite())
            .map_or(Value::String(text.into()), |f| json!(f)),
        Type::BOOL => json!(text == "t"),
        Type::JSON | Type::JSONB => {
            serde_json::from_str(text).unwrap_or(Value::String(text.into()))
        }
        Type::BYTEA => Value::String(text.strip_prefix("\\x").unwrap_or(text).into()),
        Type::TIMESTAMP => Value::String(text.replacen(' ', "T", 1)),
        // Offsets as +hh:mm, like Python's isoformat (Postgres prints +00).
        Type::TIMESTAMPTZ => {
            let iso = text.replacen(' ', "T", 1);
            let short_offset =
                iso.len() > 3 && matches!(iso.as_bytes()[iso.len() - 3], b'+' | b'-');
            Value::String(if short_offset {
                format!("{iso}:00")
            } else {
                iso
            })
        }
        _ => Value::String(text.into()),
    }
}

/// The server's own message, without the driver's "db error: ERROR:"
/// wrapper, so errors read the same as the TypeScript and Python lines.
fn message(e: tokio_postgres::Error) -> String {
    match e.as_db_error() {
        Some(db) => db.message().to_string(),
        None => e.to_string(),
    }
}

struct PostgresAdapter {
    client: Client,
}

impl PostgresAdapter {
    /// Every row of a catalog query, each value as optional text.
    async fn rows(
        &self,
        sql: &str,
        param: Option<&str>,
    ) -> Result<Vec<Vec<Option<String>>>, String> {
        let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = match &param {
            Some(p) => vec![p],
            None => vec![],
        };
        let rows = self.client.query(sql, &params).await.map_err(message)?;
        Ok(rows
            .iter()
            .map(|r| {
                (0..r.len())
                    .map(|i| match *r.columns()[i].type_() {
                        Type::BOOL => r.get::<_, Option<bool>>(i).map(|b| b.to_string()),
                        Type::INT8 => r.get::<_, Option<i64>>(i).map(|n| n.to_string()),
                        Type::INT4 => r.get::<_, Option<i32>>(i).map(|n| n.to_string()),
                        _ => r.get::<_, Option<String>>(i),
                    })
                    .collect()
            })
            .collect())
    }
}

impl Adapter for PostgresAdapter {
    const ENGINE: &'static str = "postgres";
    const ENV: EnvNames = EnvNames {
        prefix: "POSTGRES",
        dsn_var: Some("DATABASE_URL"),
        password_var: None,
    };

    async fn connect(config: &Config) -> Result<Self, String> {
        let c = &config.connection;
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let mut pg = match &c.dsn {
            Some(dsn) => dsn
                .parse::<tokio_postgres::Config>()
                .map_err(|e| format!("config: invalid DSN: {e}"))?,
            None => {
                // libpq's native PGHOST/PGUSER/PGPASSWORD/PGDATABASE fill in
                // anything not given explicitly, as with psycopg and pg.
                let host = c.host.clone().or_else(|| env("PGHOST"));
                let database = c.database.clone().or_else(|| env("PGDATABASE"));
                if host.is_none() && database.is_none() {
                    return Err(
                        "config: no database given, pass --dsn postgres://user@host/db, \
                         set DATABASE_URL or POSTGRES_HOST/POSTGRES_USER/POSTGRES_DATABASE \
                         (or libpq PG* vars), or use --config"
                            .into(),
                    );
                }
                let mut pg = tokio_postgres::Config::new();
                pg.host(host.as_deref().unwrap_or("localhost"));
                pg.port(
                    c.port
                        .or_else(|| env("PGPORT").and_then(|p| p.parse().ok()))
                        .unwrap_or(5432),
                );
                pg.user(
                    c.user
                        .clone()
                        .or_else(|| env("PGUSER"))
                        .or_else(|| env("USER"))
                        .unwrap_or("postgres".into()),
                );
                // PGPASSWORD becomes a Secret (and is registered for
                // redaction) the moment it is read, like every password.
                let password = c
                    .password
                    .clone()
                    .or_else(|| env("PGPASSWORD").map(Secret::new));
                if let Some(p) = &password {
                    pg.password(p.reveal());
                }
                if let Some(db) = &database {
                    pg.dbname(db);
                }
                pg
            }
        };
        // Server-side per-statement timeout is the timeout guardrail. Layer
        // two: a startup parameter makes the session read-only at the server,
        // catching what the SQL guard can't see (CTE-smuggled writes).
        // Startup params instead of a SET on connect: no race, they apply
        // before the first query.
        let mut options = format!(
            "-c statement_timeout={}",
            config.guardrails.query_timeout_ms
        );
        if config.guardrails.read_only {
            options.push_str(" -c default_transaction_read_only=on");
        }
        pg.options(&options);

        // TLS when the server offers it (sslmode=prefer by default) or the
        // DSN requires it, verified against the Mozilla root store.
        let roots = rustls::RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_root_certificates(roots)
            .with_no_client_auth();
        let (client, connection) = pg
            .connect(MakeRustlsConnect::new(tls))
            .await
            .map_err(message)?;
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                log(&format!("postgres: connection closed: {e}"));
            }
        });
        // ponytail: one client; tokio-postgres pipelines concurrent calls on
        // it. A pool if long queries ever block other sessions.
        client.simple_query("SELECT 1").await.map_err(message)?; // fail fast
        Ok(PostgresAdapter { client })
    }

    async fn query(
        &self,
        sql: &str,
        max_rows: usize,
        _timeout_ms: u64,
    ) -> Result<QueryResult, String> {
        // The statement_timeout startup parameter enforces the deadline at
        // the server; its error maps to the timeout: prefix in core.
        // Prepare only parses and describes: it yields column types without
        // executing. The simple query then runs the statement once.
        let types: Vec<Type> = self
            .client
            .prepare(sql)
            .await
            .map_err(message)?
            .columns()
            .iter()
            .map(|c| c.type_().clone())
            .collect();
        let messages = self.client.simple_query(sql).await.map_err(message)?;
        let mut columns: Vec<String> = Vec::new();
        let mut rows = Vec::new();
        let mut truncated = false;
        let mut affected = 0;
        // ponytail: the full result buffers before the cap, as in the Python
        // line; simple_query_raw streaming if huge results matter.
        for m in messages {
            match m {
                SimpleQueryMessage::RowDescription(cols) => {
                    columns = cols.iter().map(|c| c.name().to_string()).collect();
                }
                SimpleQueryMessage::Row(row) => {
                    if rows.len() >= max_rows {
                        truncated = true;
                        continue;
                    }
                    let mut obj = Map::new();
                    for (i, name) in columns.iter().enumerate() {
                        let v = match row.get(i) {
                            Some(t) => to_json(t, types.get(i).unwrap_or(&Type::TEXT)),
                            None => Value::Null,
                        };
                        obj.insert(name.clone(), v);
                    }
                    rows.push(obj);
                }
                SimpleQueryMessage::CommandComplete(n) => affected = n,
                _ => {}
            }
        }
        if types.is_empty() {
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                row_count: affected,
                truncated: false,
            });
        }
        Ok(QueryResult {
            row_count: rows.len() as u64,
            columns,
            rows,
            truncated,
        })
    }

    async fn list_tables(&self) -> Result<Vec<Value>, String> {
        let rows = self
            .rows(
                "SELECT c.relname::text AS name, c.reltuples::bigint AS estimated
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE c.relkind = 'r' AND n.nspname = current_schema()
                  ORDER BY c.relname",
                None,
            )
            .await?;
        // reltuples is -1 before the first VACUUM/ANALYZE.
        Ok(rows
            .into_iter()
            .map(|r| {
                let n: i64 = r[1]
                    .as_deref()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0)
                    .max(0);
                json!({ "name": r[0], "estimatedRows": n })
            })
            .collect())
    }

    async fn describe_table(&self, table: &str) -> Result<Value, String> {
        let cols = self
            .rows(
                "SELECT c.column_name::text, c.data_type::text, c.is_nullable::text, c.column_default::text,
                        EXISTS (
                          SELECT 1 FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage kcu
                              ON kcu.constraint_name = tc.constraint_name
                             AND kcu.table_schema = tc.table_schema
                           WHERE tc.constraint_type = 'PRIMARY KEY'
                             AND tc.table_schema = c.table_schema
                             AND tc.table_name = c.table_name
                             AND kcu.column_name = c.column_name
                        ) AS is_pk
                   FROM information_schema.columns c
                  WHERE c.table_schema = current_schema() AND c.table_name = $1
                  ORDER BY c.ordinal_position",
                Some(table),
            )
            .await?;
        if cols.is_empty() {
            return Err(format!("unknown table: {table}"));
        }
        let columns: Vec<Value> = cols
            .iter()
            .map(|c| {
                json!({
                    "name": c[0],
                    "type": c[1],
                    "nullable": c[2].as_deref() == Some("YES"),
                    "key": if c[4].as_deref() == Some("true") { Some("PRI") } else { None },
                    "default": c[3],
                })
            })
            .collect();

        let mut indexes: Vec<Value> = Vec::new();
        for r in self
            .rows(
                "SELECT i.relname::text AS name, ix.indisunique AS is_unique, a.attname::text AS col
                   FROM pg_class t
                   JOIN pg_index ix ON t.oid = ix.indrelid
                   JOIN pg_class i ON i.oid = ix.indexrelid
                   JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
                   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                  WHERE t.relname = $1
                    AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
                  ORDER BY i.relname, k.ord",
                Some(table),
            )
            .await?
        {
            if indexes.last().map(|ix| ix["name"] != json!(r[0])).unwrap_or(true) {
                indexes.push(json!({ "name": r[0], "columns": [], "unique": r[1].as_deref() == Some("true") }));
            }
            indexes.last_mut().unwrap()["columns"].as_array_mut().unwrap().push(json!(r[2]));
        }

        let mut fks: Vec<Value> = Vec::new();
        for r in self
            .rows(
                "SELECT tc.constraint_name::text, kcu.column_name::text,
                        ccu.table_name::text AS ref_table, ccu.column_name::text AS ref_column
                   FROM information_schema.table_constraints tc
                   JOIN information_schema.key_column_usage kcu
                     ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
                   JOIN information_schema.constraint_column_usage ccu
                     ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                  WHERE tc.constraint_type = 'FOREIGN KEY'
                    AND tc.table_schema = current_schema() AND tc.table_name = $1
                  ORDER BY tc.constraint_name, kcu.ordinal_position",
                Some(table),
            )
            .await?
        {
            if fks.last().map(|fk| fk["name"] != json!(r[0])).unwrap_or(true) {
                fks.push(json!({
                    "name": r[0],
                    "columns": [],
                    "referencesTable": r[2],
                    "referencesColumns": [],
                }));
            }
            let fk = fks.last_mut().unwrap();
            fk["columns"].as_array_mut().unwrap().push(json!(r[1]));
            fk["referencesColumns"].as_array_mut().unwrap().push(json!(r[3]));
        }

        Ok(json!({ "name": table, "columns": columns, "indexes": indexes, "foreignKeys": fks }))
    }
}
