# db-mcp

A family of Model Context Protocol (MCP) servers that give AI clients safe,
structured access to SQL databases. One independent, installable package per
(database engine × language) combination, all sharing an identical two-tool
contract (`execute_sql`, `search_objects`).

See [`docs/architecture.md`](docs/architecture.md) for design decisions.

## Layout

- `packages/core` — `@db-mcp/core`: engine-agnostic protocol layer, tool
  registration, adapter interface, guardrails, config, SQL guard.
- `packages/sqlite` — `@db-mcp/sqlite`: the SQLite family adapter and CLI.
- `conformance/` — the shared, language-agnostic conformance suite.

## Getting started

```sh
npm install
npm run build

# Run the SQLite server directly (stdio transport):
node packages/sqlite/dist/cli.js --allow-write --dsn ./my.db

# Run the conformance suite against it:
npm run conformance:sqlite
```

## Configuration

Every server reads configuration from, in order of precedence: CLI flags,
a `--config <path.yaml>` file, environment variables, then defaults.

| Flag                 | Env var             | Default   |
| --------------------- | -------------------- | --------- |
| `--dsn`               | `DB_MCP_DSN`         | —         |
| `--allow-write`       | `ALLOW_WRITE`        | `false`   |
| `--max-rows`          | `MAX_ROWS`           | `1000`    |
| `--query-timeout-ms`  | `QUERY_TIMEOUT_MS`   | `30000`   |
| `--transport`         | `DB_MCP_TRANSPORT`   | `stdio`   |
| `--port`              | `DB_MCP_PORT`        | `3000`    |
