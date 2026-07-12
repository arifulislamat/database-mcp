# @database-mcp/libsql

MCP server giving AI clients safe, structured access to a libSQL database —
local files or remote servers (Turso / sqld). Two tools, guardrails on by
default.

## Quick start (Claude Desktop / Claude Code / Cursor)

Remote database with an auth token (the token comes from the environment,
never from the client config):

```json
{
  "mcpServers": {
    "libsql": {
      "command": "npx",
      "args": ["-y", "@database-mcp/libsql", "--dsn", "libsql://your-db.turso.io"],
      "env": { "LIBSQL_AUTH_TOKEN": "..." }
    }
  }
}
```

Local file: `--dsn /absolute/path/to/database.db` (no token needed).

Environment variables instead of flags: `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN` (or
`LIBSQL_AUTH_TOKEN_FILE` for Docker/K8s-style mounted secrets). Or keep
everything in YAML via `--config` (values support `${VAR}` expansion).
`--print-config` shows the resolved config with the token redacted.

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

**Read-only on remote servers:** the SQL guard blocks mutating statements,
and local files additionally enforce `PRAGMA query_only`. Remote servers may
not honor per-session pragmas — for hard protection, connect with a
**read-only auth token** (Turso supports these natively).

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
