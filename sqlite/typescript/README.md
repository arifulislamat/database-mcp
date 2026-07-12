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

## Configuration

SQLite needs one thing: the path to the database file. Three ways to give it:

### Flag

`--dsn /absolute/path/to/database.db`, as in the quick start.

### Environment variable

```json
"env": { "SQLITE_PATH": "/absolute/path/to/database.db" }
```

### YAML config file

Useful if you want the guardrail settings in one file. Pass an absolute
path, since the working directory at launch is unpredictable:

```json
"args": ["-y", "@database-mcp/sqlite", "--config", "/absolute/path/database-mcp.yaml"]
```

```yaml
# /absolute/path/database-mcp.yaml
connection:
  dsn: /absolute/path/to/database.db

guardrails:
  readOnly: true
  maxRows: 1000
  queryTimeoutMs: 30000
```

Run the server with `--print-config` to see exactly what it resolved.

## Tools

- **`execute_sql`** `{ sql }` runs a single SQL statement. Returns a summary
  line (`N rows` / `truncated to N rows` / `OK (N affected)`) followed by
  compact JSON `{columns, rows}`.
- **`search_objects`** `{ table? }` lists tables with estimated row counts,
  or describes one table (columns, indexes, foreign keys).

## Guardrails (defaults)

| Guardrail       | Default    | Override                          |
| --------------- | ---------- | --------------------------------- |
| Read-only       | on         | `--allow-write` / `ALLOW_WRITE`   |
| Row cap         | 1000       | `--max-rows` / `MAX_ROWS`         |
| Query timeout   | 30000 ms   | `--query-timeout-ms` / `QUERY_TIMEOUT_MS` |

Read-only is enforced in two layers: a conservative SQL guard, plus the
database file opened read-only with `PRAGMA query_only=ON`. Writes smuggled
through CTEs are blocked too.

## Part of database-mcp

One package per engine, identical tool contract, shared conformance suite:
[github.com/arifulislamat/database-mcp](https://github.com/arifulislamat/database-mcp)

## License

MIT
