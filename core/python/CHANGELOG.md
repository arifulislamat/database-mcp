# Changelog

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
