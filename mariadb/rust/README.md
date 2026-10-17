# database-mcp-rs-mariadb

[![crates.io](https://img.shields.io/crates/v/database-mcp-rs-mariadb)](https://crates.io/crates/database-mcp-rs-mariadb) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a MariaDB database.
Two tools, guardrails on by default.

A single native binary: no Node or Python runtime needed.

## Install

```bash
cargo install database-mcp-rs-mariadb
```

The crate is `database-mcp-rs-mariadb`; the command it installs is
`database-mcp-mariadb`, the same as the npm and PyPI packages, so client
configs work with any language line.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "mariadb": {
      "command": "database-mcp-mariadb",
      "env": {
        "MARIADB_HOST": "127.0.0.1",
        "MARIADB_USER": "youruser",
        "MARIADB_PASSWORD": "yourpassword",
        "MARIADB_DATABASE": "yourdb"
      }
    }
  }
}
```

## Configuration

Sources, highest precedence first: flags, `--config` YAML, environment
variables, defaults.

### Environment variables

`MARIADB_HOST`, `MARIADB_PORT`, `MARIADB_USER`, `MARIADB_PASSWORD`,
`MARIADB_DATABASE`, or a full `MARIADB_DSN`
(`mysql://user:pass@host:3306/db`, inline credentials discouraged).

### Password without plaintext

- `MARIADB_PASSWORD_FILE=/run/secrets/mariadb_password` (Docker/Kubernetes
  secrets convention)
- In YAML: `connection.password: ${MARIADB_PASSWORD}` (env expansion, never
  a literal)

The password is held in a non-printable type and redacted from all output.

## Tools

- `execute_sql`: run a single SQL statement. Returns a summary line and
  compact JSON `{columns, rows}`.
- `search_objects`: list tables with estimated row counts, or describe one
  table (columns, indexes, foreign keys).

## Guardrails

- Read-only by default, enforced twice: a SQL guard plus
  `SET SESSION TRANSACTION READ ONLY` at the server. Pass `--allow-write`
  to enable writes.
- Results capped at `maxRows` (default 1000, `MAX_ROWS`).
- Statements exceeding `queryTimeoutMs` (default 30000, `QUERY_TIMEOUT_MS`)
  are aborted.

Full contract: [docs/tool-contract.md](https://github.com/arifulislamat/database-mcp/blob/main/docs/tool-contract.md)

---

mcp-name: io.github.arifulislamat/database-mcp-mariadb
