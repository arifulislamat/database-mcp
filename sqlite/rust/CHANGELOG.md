# Changelog

## 0.1.1

- First release built by the release workflow, with prebuilt binaries for
  macOS, Linux and Windows. No code changes.

## 0.1.0

- Initial release: SQLite MCP server on database-mcp-rs-core, bundled SQLite
  via rusqlite, read-only by default (read-only open plus
  PRAGMA query_only), row caps, statement timeout that interrupts a running
  query.
