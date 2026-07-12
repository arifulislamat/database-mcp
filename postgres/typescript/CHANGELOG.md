# Changelog

Behavior inherited from core (config, guardrails, transports, secret
handling) is tracked in the
[@database-mcp/core changelog](https://github.com/arifulislamat/database-mcp/blob/main/core/typescript/CHANGELOG.md).

## 0.3.0

- Streamable HTTP transport available via core (`--transport http`).

## 0.2.0

- First release: pg_catalog introspection, session read-only via the
  `default_transaction_read_only` startup parameter, server-side
  `statement_timeout`, password leak-checked in CI.
