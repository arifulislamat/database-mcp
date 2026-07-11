# Security Policy

db-mcp servers handle database credentials. Security reports are taken
seriously and handled privately.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, affected package(s), and reproduction steps.

You should receive an initial response within 72 hours.

## Scope

Of particular interest:

- Credential or secret leakage into logs, error messages, or config dumps.
- Bypasses of read-only mode (e.g. a mutating statement that passes the SQL
  guard and the session-level read-only enforcement).
- Bypasses of the row cap or statement timeout.

## Supported versions

Only the latest published version of each package receives security fixes.
