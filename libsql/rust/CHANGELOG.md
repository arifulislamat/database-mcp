# Changelog

## 0.1.0

- Initial release: libSQL/Turso MCP server on database-mcp-rs-core, official
  libsql crate (local files and remote servers, no embedded replicas).
  Read-only by default (read-only open plus PRAGMA query_only locally),
  auth token handled as a secret, statement timeout that interrupts a
  running local query.
