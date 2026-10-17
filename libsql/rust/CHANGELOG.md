# Changelog

## 0.1.2

- Security: read-only now holds on every query to a remote libSQL server.
  Before, the session pragma did not survive across remote requests.
- Requires the core release with the SQL guard and redaction fixes
  (database-mcp-rs-core 0.1.1).

## 0.1.1

- First release built by the release workflow, with prebuilt binaries for
  macOS, Linux and Windows. No code changes.

## 0.1.0

- Initial release: libSQL/Turso MCP server on database-mcp-rs-core, official
  libsql crate (local files and remote servers, no embedded replicas).
  Read-only by default (read-only open plus PRAGMA query_only locally),
  auth token handled as a secret, statement timeout that interrupts a
  running local query.
