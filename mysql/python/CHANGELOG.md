# Changelog

## 0.2.0

- A timed-out statement now fails with `timeout:`, is stopped at the server
  with KILL QUERY, and the connection recovers; before, every later call
  failed (#38). The read-only setting is re-applied on reconnect.
- Binary values are lowercase hex instead of a Python repr (#39).

## 0.1.0

- Initial release: MySQL MCP server on database-mcp-core (Python), PyMySQL
  driver, read-only by default (SET SESSION TRANSACTION READ ONLY), row
  caps, statement timeouts.
