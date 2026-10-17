"""Layer-one read-only guard: conservative string classification."""

import re

_READ_PREFIXES = {"SELECT", "WITH", "EXPLAIN", "VALUES", "SHOW", "DESCRIBE", "DESC"}
_WHITESPACE = " \t\n\v\f"
_FIRST_WORD = re.compile(r"[A-Za-z]+")
_INTO_FILE = re.compile(r"\bINTO\s+(OUTFILE|DUMPFILE)\b", re.IGNORECASE)
_TRAILING = re.compile(r"[ \t\n\v\f;]+$")


def _first_word(sql: str) -> str:
    """First keyword after leading whitespace and comments, or "" when the
    lead is anything an engine could read differently: a lone CR, `#`, an
    executable comment (`/*!`, `/*M!`), a nested or unterminated comment."""
    i = 0
    while True:
        while i < len(sql) and sql[i] in _WHITESPACE:
            i += 1
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            if end == -1 or "\r" in sql[i:end]:
                return ""
            i = end + 1
        elif sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            if end == -1:
                return ""
            body = sql[i + 2 : end]
            if body.startswith(("!", "M!")) or "/*" in body:
                return ""
            i = end + 2
        else:
            break
    m = _FIRST_WORD.match(sql, i)
    return m.group(0).upper() if m else ""


def _scan(sql: str) -> tuple[bool, bool]:
    """Returns (empty, multi). Scans quotes and comments the way SQLite, MySQL
    and Postgres all agree on. Text they lex differently (backslash escapes,
    dollar quotes, `#` comments, backticks, `[identifiers]`, a lone CR ending
    a comment, `--` without a space, nested or executable comments) makes the
    scan ambiguous; then any semicolon before the end counts as a second
    statement."""
    quote: str | None = None
    comment: str | None = None
    ambiguous = False
    empty = True
    after_semi = False
    multi = False
    i = 0
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1 : i + 2]
        if ch in "\\$#[`\r":
            ambiguous = True
        if comment == "line":
            if ch == "\n":
                comment = None
        elif comment == "block":
            if ch == "/" and nxt == "*":
                ambiguous = True
            if ch == "*" and nxt == "/":
                comment = None
                i += 1
        elif quote:
            if ch == quote:
                quote = None
        elif ch == "-" and nxt == "-":
            if sql[i + 2 : i + 3] not in (" ", "\t", "\n"):
                ambiguous = True
            comment = "line"
            i += 1
        elif ch == "/" and nxt == "*":
            if sql.startswith(("!", "M!"), i + 2):
                ambiguous = True
            comment = "block"
            i += 1
        elif ch == ";":
            empty = False
            after_semi = True
        elif ch not in _WHITESPACE:
            empty = False
            if after_semi:
                multi = True
            if ch in ("'", '"', "`"):
                quote = ch
        i += 1
    if ambiguous:
        multi = ";" in _TRAILING.sub("", sql)
    return empty, multi


def guard_sql(sql: str, read_only: bool) -> str | None:
    """Returns an error message (with its stable prefix) or None.

    Conservative: anything not obviously a read is treated as a write. Writes
    that sneak past (e.g. `WITH x AS (...) DELETE ...`) are stopped by the
    adapter's session-level read-only enforcement, layer two.
    """
    normalized = sql.replace("\r\n", "\n")
    empty, multi = _scan(normalized)
    if empty:
        return "read-only: empty statement"
    if multi:
        return "multi-statement: only a single SQL statement is allowed"
    if read_only:
        first = _first_word(normalized)
        if first not in _READ_PREFIXES:
            return f"read-only: statement '{first}' is blocked (start the server with --allow-write to enable writes)"
        # MySQL writes files on the server from a plain SELECT.
        if _INTO_FILE.search(normalized):
            return "read-only: SELECT ... INTO OUTFILE/DUMPFILE is blocked (start the server with --allow-write to enable writes)"
    return None
