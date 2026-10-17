# database-mcp-rs-libsql

[![crates.io](https://img.shields.io/crates/v/database-mcp-rs-libsql)](https://crates.io/crates/database-mcp-rs-libsql) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a libSQL database:
a local file or a remote libSQL/Turso server. Two tools, guardrails on by
default.

A single native binary: no Node or Python runtime needed.

## Install

```bash
cargo install database-mcp-rs-libsql
```

The crate is `database-mcp-rs-libsql`; the command it installs is
`database-mcp-libsql`, the same as the npm and PyPI packages, so client
configs work with any language line.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "libsql": {
      "command": "database-mcp-libsql",
      "args": ["--dsn", "libsql://your-db.turso.io"],
      "env": { "LIBSQL_AUTH_TOKEN": "your-token" }
    }
  }
}
```

For a local file, use `--dsn /absolute/path/to/database.db` and skip the token.

## Configuration

### Connection

- Flag: `--dsn <file-or-libsql-url>`
- Environment: `LIBSQL_URL`
- Config file: `connection.dsn` in `--config /path/to/database-mcp.yaml`

### Auth token (remote servers)

Three ways, strongest first:

- `LIBSQL_AUTH_TOKEN_FILE=/run/secrets/token` (file contents, never in the
  environment or any committed file)
- `LIBSQL_AUTH_TOKEN=...`
- In YAML: `connection.password: ${LIBSQL_AUTH_TOKEN}` (env expansion, never
  a literal)

The token is held in a non-printable type and redacted from all output.

## Tools

- `execute_sql`: run a single SQL statement. Returns a summary line and
  compact JSON `{columns, rows}`.
- `search_objects`: list tables with estimated row counts, or describe one
  table (columns, indexes, foreign keys).

## Guardrails

- Read-only by default, enforced twice: a SQL guard plus
  local files opened read-only with `PRAGMA query_only = ON`. Remote servers may not honor the pragma; use a
  read-only Turso token for real protection. Pass `--allow-write` to enable
  writes.
- Results capped at `maxRows` (default 1000, `MAX_ROWS`).
- Statements exceeding `queryTimeoutMs` (default 30000, `QUERY_TIMEOUT_MS`)
  are aborted. On a local file the running statement is interrupted, even a
  single long one; a remote call is abandoned at the deadline.

Full contract: [docs/tool-contract.md](https://github.com/arifulislamat/database-mcp/blob/main/docs/tool-contract.md)

---

mcp-name: io.github.arifulislamat/database-mcp-libsql
