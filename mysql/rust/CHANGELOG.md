# Changelog

## 0.1.0

- Initial release: MySQL MCP server on database-mcp-rs-core, mysql_async
  connection pool. Read-only by default (every pooled session runs
  SET SESSION TRANSACTION READ ONLY, re-applied after each pool reset),
  row caps, statement timeout that also sends KILL QUERY to the server.
