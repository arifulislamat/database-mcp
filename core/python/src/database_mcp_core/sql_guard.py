"""Layer-one read-only guard: conservative string classification."""

import re

_READ_PREFIXES = {"SELECT", "WITH", "EXPLAIN", "VALUES", "SHOW", "DESCRIBE", "DESC"}

_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"--[^\n]*")
_FIRST_WORD = re.compile(r"^[A-Za-z]+")


def _strip_comments(sql: str) -> str:
    return _LINE_COMMENT.sub(" ", _BLOCK_COMMENT.sub(" ", sql)).strip()


def _has_multiple_statements(sql: str) -> bool:
    """True if a semicolon appears outside string literals before the end."""
    quote: str | None = None
    for i, ch in enumerate(sql):
        if quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"', "`"):
            quote = ch
        elif ch == ";" and sql[i + 1 :].strip():
            return True
    return False


def guard_sql(sql: str, read_only: bool) -> str | None:
    """Returns an error message (with its stable prefix) or None.

    Conservative: anything not obviously a read is treated as a write. Writes
    that sneak past (e.g. `WITH x AS (...) DELETE ...`) are stopped by the
    adapter's session-level read-only enforcement, layer two.
    """
    stripped = _strip_comments(sql)
    if not stripped:
        return "read-only: empty statement"
    if _has_multiple_statements(stripped):
        return "multi-statement: only a single SQL statement is allowed"
    if read_only:
        m = _FIRST_WORD.match(stripped)
        first = m.group(0).upper() if m else ""
        if first not in _READ_PREFIXES:
            return f"read-only: statement '{first}' is blocked (start the server with --allow-write to enable writes)"
    return None
