# Contributing to database-mcp

Thanks for your interest in contributing.

## Ground rules

- **The conformance suite is the definition of done.** A server package is
  "working" only when the shared suite passes against it. A PR is not
  mergeable unless CI (which runs the suite) is green.
- **The tool contract is authoritative.** Every package exposes the identical
  two-tool surface documented in `docs/tool-contract.md`. Changes to the
  contract are a design decision, not an implementation detail. Open an
  issue first.
- **Keep the protocol layer engine-agnostic.** Database-specific code lives
  only in adapter files. If you find yourself importing a DB driver outside
  an adapter, stop and refactor.
- Small, reviewable PRs: one package or one focused change each.

## Running the conformance suite locally

```bash
npm install
npm run build
node conformance/run.mjs -- <command to launch the server> [args...]
```

SQLite needs no infrastructure (the suite seeds a temp file). Networked
engines (MySQL, MariaDB, Postgres) use `docker-compose up -d` first.

## Project structure

```
core/<language>/       engine-agnostic core (protocol layer, config, guardrails)
<engine>/<language>/   thin per-engine package (adapter + entry point)
conformance/           language-agnostic test suite, the merge gate
docs/                  tool contract and architecture notes
```

## Reporting security issues

Never open a public issue for a security problem; this project handles
database credentials. See [SECURITY.md](SECURITY.md).
