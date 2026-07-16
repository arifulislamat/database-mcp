# database-mcp-core

[![PyPI](https://img.shields.io/pypi/v/database-mcp-core)](https://pypi.org/project/database-mcp-core/) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

Engine-agnostic core for the database-mcp Python servers: the MCP protocol
layer, the adapter interface, multi-source config resolution, guardrails
(read-only mode, row caps, statement timeouts), the SQL guard, and secret
handling with log redaction.

You probably want an engine package instead, e.g.
[database-mcp-sqlite](https://pypi.org/project/database-mcp-sqlite/). Each
engine package is a thin adapter plus an entry point on top of this core.

The tool contract and behavior are identical across every language and engine
in the [database-mcp](https://github.com/arifulislamat/database-mcp) family,
validated by a shared conformance suite.
