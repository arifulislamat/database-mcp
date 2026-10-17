# Changelog

## 0.1.2

- Requires the core release with the SQL guard and redaction fixes
  (database-mcp-rs-core 0.1.1).

## 0.1.1

- First release built by the release workflow, with prebuilt binaries for
  macOS, Linux and Windows. No code changes.

## 0.1.0

- Initial release: MariaDB MCP server, the database-mcp-rs-mysql adapter
  with MariaDB's engine label and MARIADB_* environment variables.
  Read-only by default (every pooled session runs
  SET SESSION TRANSACTION READ ONLY, re-applied after each pool reset),
  row caps, statement timeout that also sends KILL QUERY to the server.
