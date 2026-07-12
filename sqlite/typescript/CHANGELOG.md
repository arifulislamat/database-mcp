# Changelog

Behavior inherited from core (config, guardrails, transports, secret
handling) is tracked in the
[@database-mcp/core changelog](https://github.com/arifulislamat/database-mcp/blob/main/core/typescript/CHANGELOG.md).

## 0.3.0

- Streamable HTTP transport available via core (`--transport http`).

## 0.2.0

- YAML config, `${VAR}` expansion and `--print-config` via core 0.2.0.

## 0.1.1

- Restructured as a thin package on @database-mcp/core. No behavior change.

## 0.1.0

- First release: SQLite adapter with PRAGMA introspection, layered read-only
  (read-only file open plus `PRAGMA query_only`), row cap, query deadline.
