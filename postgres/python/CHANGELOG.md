# Changelog

## 0.2.0

- Values inside arrays are converted too: `numeric[]` and `date[]` no
  longer fail to serialize.
- BYTEA values are lowercase hex instead of a Python repr (#39).

## 0.1.0

- Initial release: PostgreSQL MCP server on database-mcp-core (Python),
  psycopg driver, read-only by default (default_transaction_read_only
  startup parameter), row caps, server-side statement_timeout.
