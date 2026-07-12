# @database-mcp/mysql

[![npm](https://img.shields.io/npm/v/%40database-mcp%2Fmysql)](https://www.npmjs.com/package/@database-mcp/mysql) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a MySQL database.
Two tools, guardrails on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@database-mcp/mysql"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_USER": "readonly_user",
        "MYSQL_PASSWORD": "your-password",
        "MYSQL_DATABASE": "mydb"
      }
    }
  }
}
```

## Configuration

Use whichever method fits your setup. When methods are combined, flags win
over the YAML file, and the YAML file wins over environment variables.

### Environment variables

`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`,
`MYSQL_DATABASE`, as in the quick start above.

### Mounted secret file (Docker, Kubernetes)

Keeps the password out of the environment and out of every config file.
Point `MYSQL_PASSWORD_FILE` at a file that contains only the password:

```json
"env": {
  "MYSQL_HOST": "127.0.0.1",
  "MYSQL_USER": "readonly_user",
  "MYSQL_PASSWORD_FILE": "/run/secrets/mysql_password",
  "MYSQL_DATABASE": "mydb"
}
```

### YAML config file

Keeps the client entry down to two lines. Pass an absolute path, since the
working directory at launch is unpredictable:

```json
"args": ["-y", "@database-mcp/mysql", "--config", "/absolute/path/database-mcp.yaml"]
```

```yaml
# /absolute/path/database-mcp.yaml
connection:
  host: 127.0.0.1
  port: 3306
  user: readonly_user
  password: ${MYSQL_PASSWORD} # expanded from the environment at load time
  # or read it from a mounted file instead:
  # password_file: /run/secrets/mysql_password
  database: mydb

guardrails:
  readOnly: true
  maxRows: 1000
  queryTimeoutMs: 30000
```

Never write a literal password into the YAML file. Use `${VAR}` expansion or
`password_file` as shown.

### Connection string

```json
"args": ["-y", "@database-mcp/mysql", "--dsn", "mysql://readonly_user@127.0.0.1:3306/mydb"]
```

Putting the password inside the DSN works but is discouraged. If you do it
anyway, the server redacts it from any log output.

### Checking the result

Run the server with `--print-config` to see exactly what it resolved. The
password always prints as `***`.

## Tools

- **`execute_sql`** `{ sql }` runs a single SQL statement.
- **`search_objects`** `{ table? }` lists tables, or describes one (columns,
  indexes, foreign keys).

## Guardrails (defaults)

| Guardrail     | Default  | Override                                  |
| ------------- | -------- | ----------------------------------------- |
| Read-only     | on       | `--allow-write` / `ALLOW_WRITE`           |
| Row cap       | 1000     | `--max-rows` / `MAX_ROWS`                 |
| Query timeout | 30000 ms | `--query-timeout-ms` / `QUERY_TIMEOUT_MS` |

Read-only is enforced in two layers: a conservative SQL guard, plus
`SET SESSION TRANSACTION READ ONLY` on every pooled connection. Writes
smuggled through CTEs are rejected by the server itself.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
