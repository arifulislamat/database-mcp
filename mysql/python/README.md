# database-mcp-mysql

[![PyPI](https://img.shields.io/pypi/v/database-mcp-mysql)](https://pypi.org/project/database-mcp-mysql/) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

MCP server giving AI clients safe, structured access to a MySQL database.
Two tools, guardrails on by default.

## Quick start (Claude Desktop / Claude Code / Cursor)

```json
{
  "mcpServers": {
    "mysql": {
      "command": "uvx",
      "args": ["database-mcp-mysql"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_USER": "youruser",
        "MYSQL_PASSWORD": "yourpassword",
        "MYSQL_DATABASE": "yourdb"
      }
    }
  }
}
```

## Configuration

Sources, highest precedence first: flags, `--config` YAML, environment
variables, defaults.

### Environment variables

`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`,
or a full `MYSQL_DSN` (`mysql://user:pass@host:3306/db`, inline credentials
discouraged).

### Password without plaintext

- `MYSQL_PASSWORD_FILE=/run/secrets/mysql_password` (Docker/Kubernetes
  secrets convention)
- In YAML: `connection.password: ${MYSQL_PASSWORD}` (env expansion, never a
  literal)

The password is held in a non-printable type and redacted from all output.

### Config file

`--config /absolute/path/to/database-mcp.yaml`:

```yaml
connection:
  host: 127.0.0.1
  port: 3306
  user: mcpuser
  password: ${MYSQL_PASSWORD}
  database: yourdb

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

- Read-only by default, enforced twice: a SQL guard plus
  `SET SESSION TRANSACTION READ ONLY` at the server. Pass `--allow-write`
  to enable writes.
- Results capped at `maxRows` (default 1000, `MAX_ROWS`).
- Statements exceeding `queryTimeoutMs` (default 30000, `QUERY_TIMEOUT_MS`)
  are aborted.

Full contract: [docs/tool-contract.md](https://github.com/arifulislamat/database-mcp/blob/main/docs/tool-contract.md)

---

mcp-name: io.github.arifulislamat/database-mcp-mysql
