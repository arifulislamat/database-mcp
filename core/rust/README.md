# database-mcp-rs-core

[![crates.io](https://img.shields.io/crates/v/database-mcp-rs-core)](https://crates.io/crates/database-mcp-rs-core) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

Engine-agnostic core for the database-mcp Rust servers: the MCP protocol
layer (on the official `rmcp` SDK), the `Adapter` trait, multi-source config
resolution, guardrails (read-only mode, row caps, statement timeouts), the
SQL guard, and secret handling with log redaction.

You probably want an engine crate instead, e.g.
[database-mcp-rs-sqlite](https://crates.io/crates/database-mcp-rs-sqlite).
Each engine crate is a thin adapter plus a one-line `main` on top of this
core.

The tool contract and behavior are identical across every language and engine
in the [database-mcp](https://github.com/arifulislamat/database-mcp) family,
validated by a shared conformance suite.
