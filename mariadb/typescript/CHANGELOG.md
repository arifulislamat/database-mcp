# Changelog

Behavior inherited from core (config, guardrails, transports, secret
handling) is tracked in the
[@database-mcp/core changelog](https://github.com/arifulislamat/database-mcp/blob/main/core/typescript/CHANGELOG.md).

## 0.4.1

- MCP Registry metadata (mcpName, server.json). No behavior change.

## 0.4.0

- Dependency refresh via core 0.4.0. Requires Node 22 or newer.

## 0.3.0

- Streamable HTTP transport available via core (`--transport http`).

## 0.2.0

- First release: thin package over the @database-mcp/mysql adapter with
  MariaDB-flavored configuration.
