# Changelog

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
