//! Shared core for the database-mcp Rust servers. Engine crates contain only
//! an `Adapter` implementation plus a one-line `main` calling [`run`].

mod config;
mod secret;
mod server;
mod sql_guard;

use std::future::Future;

use serde_json::{Map, Value};

pub use config::{Config, Connection, EnvNames, Guardrails, Transport, dump, load_config};
pub use secret::{Secret, log, redact, register_secret, sanitize_dsn};
pub use server::{DbServer, run};
pub use sql_guard::guard_sql;

/// The result of one statement. Empty `columns` signals a write/DDL result,
/// with `row_count` holding the affected count.
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Map<String, Value>>,
    pub row_count: u64,
    pub truncated: bool,
}

/// The seam between the engine-agnostic protocol layer and a database driver.
///
/// Adapters contain zero MCP types. Schema results use the wire-format keys
/// from docs/tool-contract.md directly:
///
///   list_tables    -> [{"name", "estimatedRows"}]
///   describe_table -> {"name", "columns": [{name, type, nullable, key, default}],
///                      "indexes": [{name, columns, unique}],
///                      "foreignKeys": [{name, columns, referencesTable, referencesColumns}]}
///
/// Values that can overflow JSON consumers (BIGINT, DECIMAL) are returned as
/// strings. When `read_only` is set, the adapter must enforce it at the
/// connection/session level (the SQL guard is only layer one). Errors are
/// plain messages; an unknown table starts with `unknown table:`.
pub trait Adapter: Send + Sync + Sized + 'static {
    /// Engine name, used in the server name and tool descriptions.
    const ENGINE: &'static str;
    /// Environment variable names this engine reads.
    const ENV: EnvNames;

    fn connect(config: &Config) -> impl Future<Output = Result<Self, String>> + Send;

    fn query(
        &self,
        sql: &str,
        max_rows: usize,
        timeout_ms: u64,
    ) -> impl Future<Output = Result<QueryResult, String>> + Send;

    fn list_tables(&self) -> impl Future<Output = Result<Vec<Value>, String>> + Send;

    fn describe_table(&self, table: &str) -> impl Future<Output = Result<Value, String>> + Send;
}
