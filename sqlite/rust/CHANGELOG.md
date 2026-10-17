# Changelog

## 0.1.0

- Initial release: SQLite MCP server on database-mcp-rs-core, bundled SQLite
  via rusqlite, read-only by default (read-only open plus
  PRAGMA query_only), row caps, statement timeout that interrupts a running
  query.
