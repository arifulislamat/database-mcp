# database-mcp

[![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](LICENSE)
[![npm](https://img.shields.io/npm/v/%40database-mcp%2Fcore?label=%40database-mcp%2Fcore)](https://www.npmjs.com/package/@database-mcp/core)
[![Node >= 20](https://img.shields.io/node/v/%40database-mcp%2Fcore)](https://nodejs.org)

MCP servers that give AI clients safe, structured access to SQL databases.

One installable package per database engine. Every package exposes the same
minimal two-tool surface, `execute_sql` and `search_objects`, with
guardrails on by default: read-only mode, row caps, and statement timeouts.

## Packages

| Engine   | TypeScript (npm)         | Version |
| -------- | ------------------------ | ------- |
| SQLite   | [`@database-mcp/sqlite`](https://www.npmjs.com/package/@database-mcp/sqlite)   | [![npm](https://img.shields.io/npm/v/%40database-mcp%2Fsqlite?label=)](https://www.npmjs.com/package/@database-mcp/sqlite) |
| libSQL   | [`@database-mcp/libsql`](https://www.npmjs.com/package/@database-mcp/libsql)   | [![npm](https://img.shields.io/npm/v/%40database-mcp%2Flibsql?label=)](https://www.npmjs.com/package/@database-mcp/libsql) |
| MySQL    | [`@database-mcp/mysql`](https://www.npmjs.com/package/@database-mcp/mysql)    | [![npm](https://img.shields.io/npm/v/%40database-mcp%2Fmysql?label=)](https://www.npmjs.com/package/@database-mcp/mysql) |
| MariaDB  | [`@database-mcp/mariadb`](https://www.npmjs.com/package/@database-mcp/mariadb)  | [![npm](https://img.shields.io/npm/v/%40database-mcp%2Fmariadb?label=)](https://www.npmjs.com/package/@database-mcp/mariadb) |
| Postgres | [`@database-mcp/postgres`](https://www.npmjs.com/package/@database-mcp/postgres) | [![npm](https://img.shields.io/npm/v/%40database-mcp%2Fpostgres?label=)](https://www.npmjs.com/package/@database-mcp/postgres) |

All five are published, provenance-attested, and pass the shared conformance
suite against real databases in CI.

Python, Go, and Rust implementations are planned once the TypeScript line is
complete. All packages, in every language, pass the same language-agnostic
conformance suite, so behavior is identical everywhere.

## Design principles

- **Two tools, no more.** A tiny tool surface keeps the model's context window
  clean. `search_objects` progressively discloses schema: call it with no
  arguments to list tables, with a table name to get columns, indexes, and
  foreign keys.
- **Safe by default.** Read-only mode is enforced in two layers: a
  conservative SQL guard, plus a session-level read-only setting in the
  database itself. Rows are capped (default 1000) and statements time out
  (default 30s).
- **Configured at launch, never via chat.** Connection details come from
  flags, a YAML config file, or environment variables. Credentials are never
  accepted through a tool call.
- **Secrets never appear in logs.** Passwords live in non-printable secret
  types, DSNs are sanitized before logging, and a redaction filter guards the
  log boundary.

## Quick start

Pick your engine's package; each README has the full config surface. SQLite:

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@database-mcp/sqlite", "--dsn", "/absolute/path/to/database.db"]
    }
  }
}
```

Networked engines take credentials from the environment (`MYSQL_*`,
`MARIADB_*`, `POSTGRES_*`/`DATABASE_URL`, `LIBSQL_URL`/`LIBSQL_AUTH_TOKEN`),
`*_FILE` mounted secrets, or a YAML file via `--config`. Never from a chat
prompt.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: the conformance
suite is the definition of done. A change is mergeable only when
`conformance/run.mjs` passes against every affected server.

## License

[MIT](LICENSE)
