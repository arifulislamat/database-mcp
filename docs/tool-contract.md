# The tool contract

Every database-mcp server, in every language, for every engine, exposes
exactly these two tools. Behavior is validated by the conformance suite in
`/conformance`; a server is conformant only when the suite passes against it.

## `execute_sql`

**Input:** `{ "sql": string }` — a single SQL statement.

- Multi-statement input (`SELECT 1; DROP TABLE x`) is rejected before it
  reaches the database. Error starts with `multi-statement:`.
- In read-only mode (the default), mutating statements are rejected. Error
  starts with `read-only:`. Enforcement is two-layered: a conservative SQL
  guard, plus a session-level read-only setting in the database itself — so a
  write smuggled through a CTE fails too.
- Results are capped at `maxRows` (default 1000). Truncation is stated.
- Statements exceeding `queryTimeoutMs` (default 30000) are aborted. Error
  starts with `timeout:`.

**Output:** one text content block.

```
<summary line>
{"columns": [...], "rows": [...]}
```

The summary line is `N rows`, `truncated to N rows`, or `OK (N affected)`.
`rows` is an array of objects keyed by column name. Numbers that can overflow
JSON (BIGINT, DECIMAL) are returned as strings.

**Errors:** `isError: true`; the content text is the message with its stable
prefix (`read-only:`, `timeout:`, `multi-statement:`).

## `search_objects`

Progressive schema disclosure — one tool instead of four.

**Input:** `{ "table"?: string }`

- Without `table`: `{ "tables": [{ "name", "estimatedRows" }] }` for the
  active schema. `estimatedRows` is an estimate; do not rely on exactness.
- With `table`:

```json
{
  "name": "...",
  "columns": [{ "name": "", "type": "", "nullable": true, "key": null, "default": null }],
  "indexes": [{ "name": "", "columns": [], "unique": false }],
  "foreignKeys": [{ "name": "", "columns": [], "referencesTable": "", "referencesColumns": [] }]
}
```

- Unknown table: `isError: true`, message starts with `unknown table:`.

## Invariants

- Connections are configured at launch (flags/env/config file) — credentials
  are never accepted through a tool call.
- stdout is reserved for the MCP stream; logs go to stderr.
- Adding a tool to this contract is a breaking design change, not a feature.
