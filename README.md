# database-mcp

MCP servers that give AI clients safe, structured access to SQL databases.

One installable package per database engine. Every package exposes the same
minimal two-tool surface — `execute_sql` and `search_objects` — with
guardrails on by default: read-only mode, row caps, and statement timeouts.

## Packages

| Engine   | TypeScript (npm)         | Status  |
| -------- | ------------------------ | ------- |
| SQLite   | `@database-mcp/sqlite`   | planned |
| libSQL   | `@database-mcp/libsql`   | planned |
| MySQL    | `@database-mcp/mysql`    | planned |
| MariaDB  | `@database-mcp/mariadb`  | planned |
| Postgres | `@database-mcp/postgres` | planned |

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
  flags, a YAML config file, or environment variables — credentials are never
  accepted through a tool call.
- **Secrets never appear in logs.** Passwords live in non-printable secret
  types, DSNs are sanitized before logging, and a redaction filter guards the
  log boundary.

## Quick start

Coming with the first release (`@database-mcp/sqlite`).

```json
{
  "mcpServers": {
    "database-mcp": {
      "command": "npx",
      "args": ["@database-mcp/sqlite", "--dsn", "/absolute/path/to/database.db"]
    }
  }
}
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: the conformance
suite is the definition of done — a change is mergeable only when
`conformance/run.mjs` passes against every affected server.

## License

[MIT](LICENSE)
