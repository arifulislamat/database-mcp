//! The MCP protocol layer (the two contract tools) and the transport lifecycle.

use std::collections::HashMap;
use std::process::ExitCode;
use std::sync::{Arc, LazyLock};

use regex::Regex;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{ErrorData, RoleServer, ServerHandler, ServiceExt};
use serde_json::{Value, json};

use crate::Adapter;
use crate::config::{Config, Guardrails, dump, load_config};
use crate::secret::{install_panic_redaction, log, redact};
use crate::sql_guard::guard_sql;

static PREFIXED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"timeout:|read-only:|multi-statement:|unknown table:").unwrap());
// SQLite: "readonly database"/query_only; MySQL: "READ ONLY transaction";
// Postgres: "read-only transaction".
static LAYER2_READONLY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)readonly database|query_only|read.only transaction").unwrap()
});
static LAYER2_TIMEOUT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)inactivity timeout|PROTOCOL_SEQUENCE_TIMEOUT|statement timeout").unwrap()
});

/// Maps session-level write rejections (layer two) to the stable prefix.
fn sanitize_error(message: &str) -> String {
    if PREFIXED.is_match(message) {
        // Prefixed messages are ours, but may quote driver text; mask anyway.
        return redact(message);
    }
    if LAYER2_READONLY.is_match(message) {
        return "read-only: statement blocked by the database session (start the server with --allow-write to enable writes)".into();
    }
    if LAYER2_TIMEOUT.is_match(message) {
        return "timeout: query exceeded the configured queryTimeoutMs".into();
    }
    // Tool results travel over stdout (the MCP stream), which no stderr
    // filter covers; mask driver messages here too.
    redact(message)
}

pub struct DbServer<A> {
    adapter: Arc<A>,
    guardrails: Guardrails,
    version: &'static str,
}

impl<A> Clone for DbServer<A> {
    fn clone(&self) -> Self {
        DbServer {
            adapter: self.adapter.clone(),
            guardrails: self.guardrails.clone(),
            version: self.version,
        }
    }
}

fn schema(v: Value) -> Arc<serde_json::Map<String, Value>> {
    match v {
        Value::Object(m) => Arc::new(m),
        _ => unreachable!("tool schemas are objects"),
    }
}

impl<A: Adapter> DbServer<A> {
    fn tools(&self) -> Vec<Tool> {
        let g = &self.guardrails;
        vec![
            Tool::new(
                "execute_sql",
                format!(
                    "Run a single SQL statement against the {} database. Returns a summary line followed by compact JSON {{columns, rows}}. {}Results are capped at {} rows.",
                    A::ENGINE,
                    if g.read_only {
                        "The connection is read-only. "
                    } else {
                        ""
                    },
                    g.max_rows
                ),
                schema(json!({
                    "type": "object",
                    "properties": { "sql": { "type": "string", "description": "A single SQL statement" } },
                    "required": ["sql"],
                })),
            ),
            Tool::new(
                "search_objects",
                "Explore the schema progressively. Without arguments: list all tables with estimated row counts. With a table name: full detail, columns, indexes, and foreign keys.",
                schema(json!({
                    "type": "object",
                    "properties": {
                        "table": { "type": "string", "description": "Table name for detail; omit to list tables" }
                    },
                })),
            ),
        ]
    }

    async fn execute_sql(&self, sql: &str) -> Result<String, String> {
        if let Some(blocked) = guard_sql(sql, self.guardrails.read_only) {
            return Err(blocked);
        }
        let r = self
            .adapter
            .query(
                sql,
                self.guardrails.max_rows,
                self.guardrails.query_timeout_ms,
            )
            .await
            .map_err(|e| sanitize_error(&e))?;
        let summary = if r.columns.is_empty() {
            format!("OK ({} affected)", r.row_count)
        } else if r.truncated {
            format!("truncated to {} rows", r.row_count)
        } else {
            format!("{} rows", r.row_count)
        };
        let payload = json!({ "columns": r.columns, "rows": r.rows });
        Ok(format!("{summary}\n{payload}"))
    }

    async fn search_objects(&self, table: Option<&str>) -> Result<String, String> {
        let result = match table {
            Some(t) => self.adapter.describe_table(t).await,
            None => self
                .adapter
                .list_tables()
                .await
                .map(|tables| json!({ "tables": tables })),
        };
        result
            .map(|v| v.to_string())
            .map_err(|e| sanitize_error(&e))
    }
}

impl<A: Adapter> ServerHandler for DbServer<A> {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_server_info(
            Implementation::new(format!("database-mcp-{}", A::ENGINE), self.version),
        )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.tools()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let args = request.arguments.unwrap_or_default();
        let text = match request.name.as_ref() {
            "execute_sql" => match args.get("sql").and_then(Value::as_str) {
                Some(sql) => self.execute_sql(sql).await,
                None => Err("invalid arguments: 'sql' (string) is required".into()),
            },
            "search_objects" => {
                self.search_objects(args.get("table").and_then(Value::as_str))
                    .await
            }
            other => Err(format!("unknown tool: {other}")),
        };
        Ok(match text {
            Ok(t) => CallToolResult::success(vec![ContentBlock::text(t)]),
            Err(e) => CallToolResult::error(vec![ContentBlock::text(e)]),
        }
        .into())
    }
}

/// The whole engine entry point: config, connect, serve. Engine binaries call
/// `run::<TheirAdapter>(env!("CARGO_PKG_VERSION"))` and nothing else.
pub fn run<A: Adapter>(version: &'static str) -> ExitCode {
    install_panic_redaction();
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let env: HashMap<String, String> = std::env::vars().collect();
    let config = match load_config(&argv, &env, &A::ENV) {
        Ok(c) => c,
        Err(e) => {
            log(&e);
            return ExitCode::FAILURE;
        }
    };
    // Debug aid. The password renders as *** and redact() masks
    // DSN-embedded credentials, which are plain strings (issue #18).
    if argv.iter().any(|a| a == "--print-config") {
        println!(
            "{}",
            redact(&serde_json::to_string_pretty(&dump(&config)).unwrap())
        );
        return ExitCode::SUCCESS;
    }
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(r) => r,
        Err(e) => {
            log(&format!("cannot start runtime: {e}"));
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(serve::<A>(config, version)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            log(&e);
            ExitCode::FAILURE
        }
    }
}

async fn serve<A: Adapter>(config: Config, version: &'static str) -> Result<(), String> {
    // Driver connection errors can echo credentials; log() redacts.
    let adapter = A::connect(&config).await.map_err(|e| {
        if e.starts_with("config:") {
            e
        } else {
            format!("connection failed: {e}")
        }
    })?;
    let server = DbServer {
        adapter: Arc::new(adapter),
        guardrails: config.guardrails.clone(),
        version,
    };
    let read_only = config.guardrails.read_only;

    if config.transport.kind == "http" {
        return serve_http(server, config.transport.port, read_only, version).await;
    }
    let running = server
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|e| format!("stdio: {e}"))?;
    log(&format!(
        "database-mcp-{} {version} ready (read-only: {read_only})",
        A::ENGINE
    ));
    running.waiting().await.map_err(|e| format!("stdio: {e}"))?;
    Ok(())
}

/// Streamable HTTP (the current spec transport; SSE is deprecated and not
/// implemented). All sessions share the adapter. Binds 127.0.0.1 only;
/// remote auth is deliberately out of scope for now.
async fn serve_http<A: Adapter>(
    server: DbServer<A>,
    port: u16,
    read_only: bool,
    version: &str,
) -> Result<(), String> {
    // DNS rebinding protection: rmcp validates Host against loopback names by
    // default; Origin validation is opt-in, so allow only local origins.
    let local_origins = ["localhost", "127.0.0.1", "[::1]"]
        .iter()
        .flat_map(|h| [format!("http://{h}:*"), format!("https://{h}:*")]);
    let service = StreamableHttpService::new(
        move || Ok(server.clone()),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default().with_allowed_origins(local_origins),
    );
    let router = axum::Router::new().nest_service("/mcp", service);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("http: cannot bind 127.0.0.1:{port}: {e}"))?;
    log(&format!(
        "database-mcp-{} {version} listening on http://127.0.0.1:{port}/mcp (read-only: {read_only})",
        A::ENGINE
    ));
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|e| format!("http: {e}"))
}
