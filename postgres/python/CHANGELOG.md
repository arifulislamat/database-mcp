# Changelog

## 0.2.1

- Security: in read-only mode every query runs in a read-only transaction
  that is rolled back, so `SELECT set_config(...)` can no longer switch
  read-only or the statement timeout off for later queries.
- Requires the core release with the SQL guard and redaction fixes
  (database-mcp-core 0.3.1).

## 0.2.0

- Values inside arrays are converted too: `numeric[]` and `date[]` no
  longer fail to serialize.
- BYTEA values are lowercase hex instead of a Python repr (#39).

## 0.1.0

- Initial release: PostgreSQL MCP server on database-mcp-core (Python),
  psycopg driver, read-only by default (default_transaction_read_only
  startup parameter), row caps, server-side statement_timeout.
