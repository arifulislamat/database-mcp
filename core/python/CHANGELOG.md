# Changelog

## 0.3.1

- Security: the SQL guard let a second statement through when a comment
  marker sat inside a string (`SELECT '--'; COMMIT; BEGIN READ WRITE; ...`),
  and treated MySQL executable comments (`/*! ... */`) as plain comments. The
  guard now scans quotes and comments with the rules every supported engine
  shares, and rejects any non-trailing semicolon in text the engines lex
  differently.
- Security: read-only mode blocks MySQL `SELECT ... INTO OUTFILE/DUMPFILE`.
- Security: `--print-config` and driver errors no longer print the password
  from key=value DSNs (`host=db password=...`) or from URLs with an empty
  user (`postgres://:pw@db/x`).
- `maxRows` and `queryTimeoutMs` must be positive integers. A bad value is a
  `config:` error instead of silently disabling the guardrail.

## 0.3.0

- Move to MCP Python SDK 2.x (`mcp>=2.0,<3`), lifting the 0.2.1 cap. The
  protocol layer now registers its handlers through the 2.x `Server`
  constructor; tool names, descriptions, input schemas, error texts and
  the HTTP Host/Origin guard are unchanged. Engines pick this up on their
  next install.

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
