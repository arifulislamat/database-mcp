# database-mcp-mariadb

[![PyPI](https://img.shields.io/pypi/v/database-mcp-mariadb)](https://pypi.org/project/database-mcp-mariadb/) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a MariaDB database.
Two tools, guardrails on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "mariadb": {
      "command": "uvx",
      "args": ["database-mcp-mariadb"],
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
