# Changelog

## 0.2.1

- Security: in read-only mode every query runs in a read-only transaction
  that is rolled back, so `SELECT set_config(...)` can no longer switch
  read-only or the statement timeout off for later queries.
- Requires the core release with the SQL guard and redaction fixes
  (database-mcp-rs-core 0.1.1).

## 0.2.0

- Arrays are returned as JSON arrays (nested, with NULLs), matching the TS
  and Python lines.
- `timestamptz` offsets print as `+hh:mm`.
- First release built by the release workflow, with prebuilt binaries.

## 0.1.0

- Initial release: PostgreSQL MCP server on database-mcp-rs-core,
  tokio-postgres with built-in TLS (rustls). Read-only by default
  (default_transaction_read_only=on as a startup parameter), row caps,
  statement_timeout as a startup parameter, libpq PG* variables honored
  as fallbacks.
