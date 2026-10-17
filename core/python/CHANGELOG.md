# Changelog

## 0.2.1

- Cap the MCP Python SDK below 2.0 (`mcp>=1.9,<2`). SDK 2.0 removed the
  low-level decorator API this server uses, so every fresh install since
  late August 2026 crashed at startup with "'Server' object has no
  attribute 'list_tools'". Engines pick up this fix automatically.

## 0.2.0

- New `IsolatedAdapter`: runs an adapter in a child process so a driver
  that cannot interrupt a statement still stops at `queryTimeoutMs` (#38).
- Binary values (bytes) are returned as lowercase hex strings, now part of
  the tool contract (#39).

## 0.1.0

- Initial release: Python port of the TypeScript core. Protocol layer with
  the two contract tools, adapter interface, multi-source config (flags,
  YAML with ${VAR} expansion, env vars with *_FILE variants, defaults),
  guardrails, SQL guard, Secret type with boundary log redaction, stdio and
  Streamable HTTP transports.
