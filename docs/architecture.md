# Architecture decisions

This document records decisions made while implementing db-mcp, per PRD §8's
instruction to "resolve [open questions] as you go, record decisions in
docs/architecture.md."

## Scope of this session

The PRD was delivered in fragments across chat messages. At the time this
foundation was built, the following sections had **not** been received:

- The remainder of §8 ("Open questions")
- §9
- §11 (the milestone list)
- §12 (the reference starter scaffold for MySQL + TypeScript)
- §13 (References)

Rather than block, this session built the **first milestone's worth of
foundation** using the explicit guidance in §7 that SQLite is deliberately
the first engine to build, and the tool/adapter contracts in §6–§8, which
were fully specified. Later sessions should reconcile this work against the
real milestone list and starter scaffold once available, and update this
document accordingly.

## Repository layout

```
packages/
  core/      @db-mcp/core   — engine-agnostic protocol layer, tool
                              registration, adapter interface, guardrails,
                              config loader, SQL guard
  sqlite/    @db-mcp/sqlite — SQLite family adapter + CLI entry point
conformance/                — shared, language-agnostic conformance suite
docs/                       — this file
```

npm workspaces link `packages/*` and `conformance` under a single root
`package.json`. Each engine package depends on `@db-mcp/core` and adds
exactly one adapter plus a CLI entry point, per PRD §5.

## Decisions

1. **Connection config is a `{ dsn, options }` bag, not a fixed struct.**
   SQLite needs a file path; libSQL needs a URL + token; MySQL/Postgres need
   host/port/user/password. `ConnectionConfig` carries a primary `dsn`
   string/path plus an open `options` record that each adapter interprets on
   its own terms. This was built in from the start per PRD §7's instruction
   that the config model "must be an abstraction over 'how to reach this
   database'."

2. **Config precedence**: CLI flags > `--config` YAML file > environment
   variables > defaults, implemented in `packages/core/src/config.ts`,
   matching the order given in PRD §8.

3. **Read-only classification is conservative and text-based**
   (`packages/core/src/sqlGuard.ts`): only `SELECT`, `WITH`, `EXPLAIN`,
   `SHOW`, `DESCRIBE`/`DESC`, `PRAGMA` (non-assigning), and `VALUES` leading
   keywords are treated as reads; anything else — including any statement
   containing a second `;`-separated statement — is rejected as a write in
   read-only mode. This lives entirely in core so it is identical across
   engines.

4. **SQLite query timeout is best-effort, not preemptive.**
   `better-sqlite3` executes statements synchronously and does not expose a
   way to interrupt an in-flight statement from JavaScript. The adapter
   times the statement and throws `QueryTimeoutError` if the wall-clock
   duration exceeded `queryTimeoutMs`, but a pathological query will still
   run to completion before the timeout is reported. This is documented in
   `packages/sqlite/src/adapter.ts` as a known limitation of the embedded,
   synchronous driver — not a gap in the `DatabaseAdapter` contract itself.
   Networked engines (MySQL, Postgres) should be able to genuinely abort a
   running statement via their driver's cancellation APIs; do not carry this
   limitation over to those adapters without re-justifying it.

5. **Conformance suite (PRD §10)** lives in `/conformance`, is written once
   in Node using the MCP TypeScript SDK client, and is invoked as
   `node run.mjs -- <command> [args...]`. Most cases are declarative
   (`cases.json`); the read/write fixture roundtrip is orchestrated in
   `run.mjs` itself because it requires setup/teardown and a runtime probe
   of whether the server-under-test is in read-only or write mode (rather
   than requiring two separate invocations with different flags).

## Open items for the next session

- Confirm the real milestone list (§11) and re-sequence/rename this work
  (currently treated as "M0/M0.5") to match it exactly.
- Reconcile `packages/core` and `packages/sqlite` against the actual starter
  scaffold in §12 once provided; the scaffold is meant to be the reference
  style for every other package.
- Decide on the Streamable HTTP transport implementation (v1.x) — `config.ts`
  already models `{ kind: "http", port }` but `serveStdio` is the only
  transport wired up so far.
- Add MySQL/MariaDB and Postgres adapters once SQLite/libSQL are fully
  accepted, per the driver-family grouping in §5/§7.
