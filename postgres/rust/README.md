# database-mcp-rs-postgres

[![crates.io](https://img.shields.io/crates/v/database-mcp-rs-postgres)](https://crates.io/crates/database-mcp-rs-postgres) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a PostgreSQL
database. Two tools, guardrails on by default.

A single native binary: no Node or Python runtime needed. TLS is built in
(rustls), so hosted Postgres with `sslmode=require` works out of the box.

## Install

```bash
cargo install database-mcp-rs-postgres
```

The crate is `database-mcp-rs-postgres`; the command it installs is
`database-mcp-postgres`, the same as the npm and PyPI packages, so client
configs work with any language line.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "postgres": {
      "command": "database-mcp-postgres",
      "env": {
        "POSTGRES_HOST": "127.0.0.1",
        "POSTGRES_USER": "youruser",
        "POSTGRES_PASSWORD": "yourpassword",
        "POSTGRES_DATABASE": "yourdb"
      }
    }
  }
}
```

## Configuration

Sources, highest precedence first: flags, `--config` YAML, environment
variables, defaults.

### Environment variables

`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DATABASE`, or a full `DATABASE_URL`
(`postgres://user:pass@host:5432/db`, inline credentials discouraged).
libpq's native `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` also work.

### Password without plaintext

- `POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password`
  (Docker/Kubernetes secrets convention)
- In YAML: `connection.password: ${POSTGRES_PASSWORD}` (env expansion,
  never a literal)

The password is held in a non-printable type and redacted from all output.

## Tools

- `execute_sql`: run a single SQL statement. Returns a summary line and
  compact JSON `{columns, rows}`.
- `search_objects`: list tables with estimated row counts, or describe one
  table (columns, indexes, foreign keys).

## Guardrails

- Read-only by default, enforced twice: a SQL guard plus the
  `default_transaction_read_only=on` startup parameter at the server. Pass
  `--allow-write` to enable writes.
- Results capped at `maxRows` (default 1000, `MAX_ROWS`).
- Statements exceeding `queryTimeoutMs` (default 30000, `QUERY_TIMEOUT_MS`)
  are aborted server-side via `statement_timeout`.

Full contract: [docs/tool-contract.md](https://github.com/arifulislamat/database-mcp/blob/main/docs/tool-contract.md)

---

mcp-name: io.github.arifulislamat/database-mcp-postgres
