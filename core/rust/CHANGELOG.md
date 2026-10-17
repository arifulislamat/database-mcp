# Changelog

## 0.1.1

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

## 0.1.0

- Initial release: Rust core on the official rmcp SDK. Two-tool contract,
  stdio and Streamable HTTP transports (127.0.0.1 only, Host and Origin
  validated), multi-source config with `${VAR}` expansion and `*_FILE`
  secrets, layer-one SQL guard, redaction at every output boundary.
