# @database-mcp/postgres

MCP server giving AI clients safe, structured access to a PostgreSQL
database. Two tools, guardrails on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

The password comes from the environment or a mounted secret file — never
from the client config:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@database-mcp/postgres"],
      "env": {
        "POSTGRES_HOST": "127.0.0.1",
        "POSTGRES_USER": "readonly_user",
        "POSTGRES_PASSWORD": "...",
        "POSTGRES_DATABASE": "mydb"
      }
    }
  }
}
```

Alternatives: `DATABASE_URL=postgres://user@host:5432/db`,
`POSTGRES_PASSWORD_FILE=/run/secrets/...` (Docker/K8s-style), libpq's native
`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`, or a YAML file via `--config`
(values support `${VAR}` expansion). `--print-config` shows the resolved
config with the password redacted.

## Tools

- **`execute_sql`** `{ sql }` — run a single SQL statement.
- **`search_objects`** `{ table? }` — list tables in the current schema, or
  describe one (columns, indexes, foreign keys).

## Guardrails (defaults)

| Guardrail     | Default  | Override                                  |
| ------------- | -------- | ----------------------------------------- |
| Read-only     | on       | `--allow-write` / `ALLOW_WRITE`           |
| Row cap       | 1000     | `--max-rows` / `MAX_ROWS`                 |
| Query timeout | 30000 ms | `--query-timeout-ms` / `QUERY_TIMEOUT_MS` (server-side `statement_timeout`) |

Read-only is enforced in two layers: a conservative SQL guard, plus
`default_transaction_read_only=on` on every pooled session — so writes
smuggled through CTEs (`WITH x AS (...) DELETE ...`) are rejected by
Postgres itself.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
