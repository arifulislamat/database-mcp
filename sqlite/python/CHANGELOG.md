# Changelog

## 0.2.1

- Writes that return rows (`INSERT ... RETURNING`) are committed. They were
  rolled back on close.
- Requires the core release with the SQL guard and redaction fixes
  (database-mcp-core 0.3.1).

## 0.2.0

- A statement that never yields a row now stops at `queryTimeoutMs`
  (sqlite3 progress handler) instead of hanging the server (#38).
- BLOB values are lowercase hex instead of failing to serialize (#39).

## 0.1.0

- Initial release: SQLite MCP server on database-mcp-core (Python), stdlib
  sqlite3 driver, read-only by default (read-only open plus
  PRAGMA query_only), row caps, statement deadline.
