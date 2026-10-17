# Changelog

## 0.1.0

- Initial release: MariaDB MCP server, the database-mcp-rs-mysql adapter
  with MariaDB's engine label and MARIADB_* environment variables.
  Read-only by default (every pooled session runs
  SET SESSION TRANSACTION READ ONLY, re-applied after each pool reset),
  row caps, statement timeout that also sends KILL QUERY to the server.
