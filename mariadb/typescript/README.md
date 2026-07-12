# @database-mcp/mariadb

MCP server giving AI clients safe, structured access to a MariaDB database.
Two tools, guardrails on by default. MariaDB is MySQL wire-compatible, so
this is a thin package over the [`@database-mcp/mysql`](https://www.npmjs.com/package/@database-mcp/mysql)
adapter — identical behavior, MariaDB-flavored configuration.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "mariadb": {
      "command": "npx",
      "args": ["-y", "@database-mcp/mariadb"],
      "env": {
        "MARIADB_HOST": "127.0.0.1",
        "MARIADB_USER": "readonly_user",
        "MARIADB_PASSWORD": "...",
        "MARIADB_DATABASE": "mydb"
      }
    }
  }
}
```

Alternatives: `MARIADB_PASSWORD_FILE=/run/secrets/...`, a YAML file via
`--config` (`${VAR}` expansion supported), or `--dsn`. `--print-config`
shows the resolved config with the password redacted.

## Tools

- **`execute_sql`** `{ sql }` — run a single SQL statement.
- **`search_objects`** `{ table? }` — list tables, or describe one (columns,
  indexes, foreign keys).

## Guardrails (defaults)

| Guardrail     | Default  | Override                                  |
| ------------- | -------- | ----------------------------------------- |
| Read-only     | on       | `--allow-write` / `ALLOW_WRITE`           |
| Row cap       | 1000     | `--max-rows` / `MAX_ROWS`                 |
| Query timeout | 30000 ms | `--query-timeout-ms` / `QUERY_TIMEOUT_MS` |

Read-only is enforced in two layers: a conservative SQL guard, plus
`SET SESSION TRANSACTION READ ONLY` on every pooled connection.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
