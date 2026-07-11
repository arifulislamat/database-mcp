# @database-mcp/sqlite

MCP server giving AI clients safe, structured access to a SQLite database.
Two tools, guardrails on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

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

Or with environment variables instead of flags: set `SQLITE_PATH`. Or keep
everything in a YAML file and pass only `--config /abs/path/db-mcp.yaml`
(values support `${VAR}` env expansion; secrets support `*_file` indirection).
`--print-config` shows the resolved config with secrets redacted.

## Tools

- **`execute_sql`** `{ sql }` — run a single SQL statement. Returns a summary
  line (`N rows` / `truncated to N rows` / `OK (N affected)`) followed by
  compact JSON `{columns, rows}`.
- **`search_objects`** `{ table? }` — without arguments, lists tables with
  estimated row counts; with a table name, returns its columns, indexes, and
  foreign keys.

## Guardrails (defaults)

| Guardrail       | Default    | Override                          |
| --------------- | ---------- | --------------------------------- |
| Read-only       | on         | `--allow-write` / `ALLOW_WRITE`   |
| Row cap         | 1000       | `--max-rows` / `MAX_ROWS`         |
| Query timeout   | 30000 ms   | `--query-timeout-ms` / `QUERY_TIMEOUT_MS` |

Read-only is enforced in two layers: a conservative SQL guard, plus the
database file opened read-only with `PRAGMA query_only=ON` — so writes
smuggled through CTEs are blocked too.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
