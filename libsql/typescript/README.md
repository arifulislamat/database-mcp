# @database-mcp/libsql

[![npm](https://img.shields.io/npm/v/%40database-mcp%2Flibsql)](https://www.npmjs.com/package/@database-mcp/libsql) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a libSQL database,
either a local file or a remote server (Turso / sqld). Two tools, guardrails
on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

Remote database with an auth token:

```json
{
  "mcpServers": {
    "libsql": {
      "command": "npx",
      "args": ["-y", "@database-mcp/libsql", "--dsn", "libsql://your-db.turso.io"],
      "env": { "LIBSQL_AUTH_TOKEN": "your-token" }
    }
  }
}
```

Local file, no token needed:

```json
"args": ["-y", "@database-mcp/libsql", "--dsn", "/absolute/path/to/database.db"]
```

## Configuration

Use whichever method fits your setup. When methods are combined, flags win
over the YAML file, and the YAML file wins over environment variables.

### Environment variables

`LIBSQL_URL` for the database and `LIBSQL_AUTH_TOKEN` for the token:

```json
"env": {
  "LIBSQL_URL": "libsql://your-db.turso.io",
  "LIBSQL_AUTH_TOKEN": "your-token"
}
```

### Mounted secret file (Docker, Kubernetes)

Keeps the token out of the environment and out of every config file. Point
`LIBSQL_AUTH_TOKEN_FILE` at a file that contains only the token:

```json
"env": {
  "LIBSQL_URL": "libsql://your-db.turso.io",
  "LIBSQL_AUTH_TOKEN_FILE": "/run/secrets/libsql_token"
}
```

### YAML config file

Keeps the client entry down to two lines. Pass an absolute path, since the
working directory at launch is unpredictable. The token goes in the
`password` field:

```json
"args": ["-y", "@database-mcp/libsql", "--config", "/absolute/path/database-mcp.yaml"]
```

```yaml
# /absolute/path/database-mcp.yaml
connection:
  dsn: libsql://your-db.turso.io
  password: ${LIBSQL_AUTH_TOKEN} # expanded from the environment at load time
  # or read it from a mounted file instead:
  # password_file: /run/secrets/libsql_token

guardrails:
  readOnly: true
  maxRows: 1000
  queryTimeoutMs: 30000
```

Never write a literal token into the YAML file. Use `${VAR}` expansion or
`password_file` as shown.

### Checking the result

Run the server with `--print-config` to see exactly what it resolved. The
token always prints as `***`.

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

The SQL guard blocks mutating statements, and local files additionally
enforce `PRAGMA query_only`. Remote servers may not honor per-session
pragmas, so for hard protection connect with a read-only auth token. Turso
supports these natively.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
