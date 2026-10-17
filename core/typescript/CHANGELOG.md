# Changelog

## 0.5.1

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

## 0.5.0

- New `IsolatedAdapter`: runs an adapter in a child process so a statement
  stuck in a synchronous driver can be stopped at `queryTimeoutMs` (#38).
- Binary values (BLOB, BYTEA, BINARY) are returned as lowercase hex strings,
  now part of the tool contract (#39).

## 0.4.2

- Fix #18: `--print-config` printed the password embedded in a DSN
  (`DATABASE_URL` and friends) in full. The dump is now redacted, and
  driver error messages in tool results are redacted as well. Leak checks
  in CI now cover the `--print-config` path.

## 0.4.0

- Dependency refresh: zod 4, MCP SDK 1.29, TypeScript 7.
- Requires Node 22 or newer (Node 20 is end-of-life).

## 0.3.1

- HTTP transport: reject requests whose Host or Origin header is not local
  (DNS rebinding protection).

## 0.3.0

- Streamable HTTP transport: `--transport http --port N`, one MCP session
  per client, binds 127.0.0.1. stdio remains the default.

## 0.2.2

- Map the Postgres statement-timeout wording to the stable `timeout:` prefix.

## 0.2.1

- Map MySQL and Postgres session read-only rejections to the stable
  `read-only:` prefix; map mysql2 query timeouts to `timeout:`.

## 0.2.0

- Multi-source config: flags, YAML file with `${VAR}` expansion, discrete
  env vars with `*_FILE` variants, defaults.
- Non-printable `Secret` type, log-boundary redaction, DSN and connect-error
  sanitization, `--print-config` with secrets redacted.

## 0.1.0

- First release: protocol layer, `DatabaseAdapter` interface, SQL guard,
  `execute_sql` and `search_objects` tools.
