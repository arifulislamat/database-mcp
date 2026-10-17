# Changelog

## 0.1.0

- Initial release: PostgreSQL MCP server on database-mcp-rs-core,
  tokio-postgres with built-in TLS (rustls). Read-only by default
  (default_transaction_read_only=on as a startup parameter), row caps,
  statement_timeout as a startup parameter, libpq PG* variables honored
  as fallbacks.
