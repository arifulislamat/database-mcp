# database-mcp-rs-sqlite

[![crates.io](https://img.shields.io/crates/v/database-mcp-rs-sqlite)](https://crates.io/crates/database-mcp-rs-sqlite) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a SQLite database.
Two tools, guardrails on by default.

A single native binary: no Node or Python runtime needed.

## Install

```bash
cargo install database-mcp-rs-sqlite
```

The crate is `database-mcp-rs-sqlite`; the command it installs is
`database-mcp-sqlite`, the same as the npm and PyPI packages, so client
configs work with any language line.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "database-mcp-sqlite",
      "args": ["--dsn", "/absolute/path/to/database.db"]
    }
  }
}
```

## Configuration

SQLite needs one thing: the path to the database file. Three ways to give it:

### Flag

`--dsn /absolute/path/to/database.db`, as in the quick start.

### Environment variable

`SQLITE_PATH=/absolute/path/to/database.db`

### Config file

`--config /absolute/path/to/database-mcp.yaml`:

```yaml
connection:
  dsn: /absolute/path/to/database.db

guardrails:
  readOnly: true
  maxRows: 1000
  queryTimeoutMs: 30000
```

## Tools

- `execute_sql`: run a single SQL statement. Returns a summary line and
  compact JSON `{columns, rows}`.
- `search_objects`: list tables with estimated row counts, or describe one
  table (columns, indexes, foreign keys).

## Guardrails

- Read-only by default, enforced twice: a SQL guard plus the database file
  opened read-only with `PRAGMA query_only = ON`. Pass `--allow-write` to
  enable writes.
- Results capped at `maxRows` (default 1000, `MAX_ROWS`).
- Statements exceeding `queryTimeoutMs` (default 30000, `QUERY_TIMEOUT_MS`)
  are interrupted, including a single long-running statement.

Full contract: [docs/tool-contract.md](https://github.com/arifulislamat/database-mcp/blob/main/docs/tool-contract.md)

---

mcp-name: io.github.arifulislamat/database-mcp-sqlite
