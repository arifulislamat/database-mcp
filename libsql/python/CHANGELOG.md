# Changelog

## 0.2.1

- Security: read-only now holds on every query to a remote libSQL server.
  Before, the session pragma did not survive across remote requests.
- Writes that return rows (`INSERT ... RETURNING`) are committed. They were
  rolled back on close.
- Requires the core release with the SQL guard and redaction fixes
  (database-mcp-core 0.3.1).

## 0.2.0

- A runaway statement now stops at `queryTimeoutMs` instead of hanging the
  server: the driver cannot interrupt, so queries run in an isolated child
  process (#38).
- BLOB values are lowercase hex instead of failing to serialize (#39).

## 0.1.0

- Initial release: libSQL MCP server on database-mcp-core (Python), local
  files and remote libSQL/Turso servers with auth token support, read-only
  by default (PRAGMA query_only), row caps, statement timeouts.
