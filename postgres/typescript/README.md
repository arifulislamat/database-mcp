# @database-mcp/postgres

[![npm](https://img.shields.io/npm/v/%40database-mcp%2Fpostgres)](https://www.npmjs.com/package/@database-mcp/postgres) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a PostgreSQL
database. Two tools, guardrails on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@database-mcp/postgres"],
      "env": {
        "POSTGRES_HOST": "127.0.0.1",
        "POSTGRES_USER": "readonly_user",
        "POSTGRES_PASSWORD": "your-password",
        "POSTGRES_DATABASE": "mydb"
      }
    }
  }
}
```

## Configuration

Use whichever method fits your setup. When methods are combined, flags win
over the YAML file, and the YAML file wins over environment variables.

### Environment variables

`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DATABASE`, as in the quick start above. The driver also honors
libpq's native `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`,
so an existing psql environment works as-is.

### DATABASE_URL

The convention most hosting platforms already give you:

```json
"env": { "DATABASE_URL": "postgres://readonly_user@db.example.com:5432/mydb" }
```

Putting the password inside the URL works but is discouraged. If you do it
anyway, the server redacts it from any log output.

### Mounted secret file (Docker, Kubernetes)

Keeps the password out of the environment and out of every config file.
Point `POSTGRES_PASSWORD_FILE` at a file that contains only the password:

```json
"env": {
  "POSTGRES_HOST": "127.0.0.1",
  "POSTGRES_USER": "readonly_user",
  "POSTGRES_PASSWORD_FILE": "/run/secrets/postgres_password",
  "POSTGRES_DATABASE": "mydb"
}
```

### YAML config file

Keeps the client entry down to two lines. Pass an absolute path, since the
working directory at launch is unpredictable:

```json
"args": ["-y", "@database-mcp/postgres", "--config", "/absolute/path/database-mcp.yaml"]
```

```yaml
# /absolute/path/database-mcp.yaml
connection:
  host: 127.0.0.1
  port: 5432
  user: readonly_user
  password: ${POSTGRES_PASSWORD} # expanded from the environment at load time
  # or read it from a mounted file instead:
  # password_file: /run/secrets/postgres_password
  database: mydb

guardrails:
  readOnly: true
  maxRows: 1000
  queryTimeoutMs: 30000
```

Never write a literal password into the YAML file. Use `${VAR}` expansion or
`password_file` as shown.

### Checking the result

Run the server with `--print-config` to see exactly what it resolved. The
password always prints as `***`.

## Tools

- **`execute_sql`** `{ sql }` runs a single SQL statement.
- **`search_objects`** `{ table? }` lists tables in the current schema, or
  describes one (columns, indexes, foreign keys).

## Guardrails (defaults)

| Guardrail     | Default  | Override                                  |
| ------------- | -------- | ----------------------------------------- |
| Read-only     | on       | `--allow-write` / `ALLOW_WRITE`           |
| Row cap       | 1000     | `--max-rows` / `MAX_ROWS`                 |
| Query timeout | 30000 ms | `--query-timeout-ms` / `QUERY_TIMEOUT_MS` (server-side `statement_timeout`) |

Read-only is enforced in two layers: a conservative SQL guard, plus
`default_transaction_read_only=on` on every pooled session. Writes smuggled
through CTEs, like `WITH x AS (...) DELETE ...`, are rejected by Postgres
itself.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
