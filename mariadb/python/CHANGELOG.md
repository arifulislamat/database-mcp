# Changelog

## 0.2.0

- Picks up database-mcp-mysql 0.2: timeouts recover the connection (#38) and
  binary values are lowercase hex (#39).

## 0.1.0

- Initial release: MariaDB MCP server on database-mcp-core (Python), thin
  subclass of the database-mcp-mysql adapter (shared wire protocol and
  PyMySQL driver), read-only by default, row caps, statement timeouts.
