# @database-mcp/mysql

MCP server giving AI clients safe, structured access to a MySQL database.
Two tools, guardrails on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

The password comes from the environment or a mounted secret file — never
from the client config:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@database-mcp/mysql"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_USER": "readonly_user",
        "MYSQL_PASSWORD": "...",
        "MYSQL_DATABASE": "mydb"
      }
    }
  }
}
```

Alternatives: `MYSQL_PASSWORD_FILE=/run/secrets/mysql_password`
(Docker/K8s-style), a YAML file via `--config` (values support `${VAR}`
expansion), or `--dsn mysql://user@host:3306/db` (inline DSN passwords are
discouraged but redacted if used). `--print-config` shows the resolved
config with the password redacted.

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
`SET SESSION TRANSACTION READ ONLY` on every pooled connection — so writes
smuggled through CTEs are rejected by the server itself.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
