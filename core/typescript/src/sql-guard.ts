const READ_PREFIXES = ["SELECT", "WITH", "EXPLAIN", "VALUES", "SHOW", "DESCRIBE", "DESC"];
const WHITESPACE = " \t\n\v\f";

/**
 * First keyword after leading whitespace and comments, or "" when the lead
 * is anything an engine could read differently: a lone CR, `#`, an
 * executable comment (`/*!`, `/*M!`), a nested or unterminated comment.
 */
function firstWord(sql: string): string {
  let i = 0;
  for (;;) {
    while (i < sql.length && WHITESPACE.includes(sql[i])) i++;
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      if (end === -1) return "";
      if (sql.slice(i, end).includes("\r")) return "";
      i = end + 1;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return "";
      const body = sql.slice(i + 2, end);
      if (body.startsWith("!") || body.startsWith("M!") || body.includes("/*")) return "";
      i = end + 2;
    } else {
      break;
    }
  }
  return (sql.slice(i).match(/^[A-Za-z]+/) ?? [""])[0].toUpperCase();
}

/**
 * Scans quotes and comments the way SQLite, MySQL and Postgres all agree on.
 * Text they lex differently (backslash escapes, dollar quotes, `#` comments,
 * backticks, `[identifiers]`, a lone CR ending a comment, `--` without a
 * space, nested or executable comments) makes the scan ambiguous; then any
 * semicolon before the end counts as a second statement.
 */
function scan(sql: string): { empty: boolean; multi: boolean } {
  let quote: string | null = null;
  let comment: "line" | "block" | null = null;
  let ambiguous = false;
  let empty = true;
  let afterSemi = false;
  let multi = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if ("\\$#[`\r".includes(ch)) ambiguous = true;
    if (comment === "line") {
      if (ch === "\n") comment = null;
    } else if (comment === "block") {
      if (ch === "/" && next === "*") ambiguous = true;
      if (ch === "*" && next === "/") {
        comment = null;
        i++;
      }
    } else if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "-" && next === "-") {
      if (!" \t\n".includes(sql[i + 2] ?? "x")) ambiguous = true;
      comment = "line";
      i++;
    } else if (ch === "/" && next === "*") {
      if (sql[i + 2] === "!" || sql.startsWith("M!", i + 2)) ambiguous = true;
      comment = "block";
      i++;
    } else if (ch === ";") {
      empty = false;
      afterSemi = true;
    } else if (!WHITESPACE.includes(ch)) {
      empty = false;
      if (afterSemi) multi = true;
      if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    }
  }
  if (ambiguous) multi = sql.replace(/[ \t\n\v\f;]+$/, "").includes(";");
  return { empty, multi };
}

/**
 * Layer-one guard. Returns an error message (with its stable prefix) or null.
 * Conservative: anything not obviously a read is treated as a write. Writes
 * that sneak past (e.g. `WITH x AS (...) DELETE ...`) are stopped by the
 * adapter's session-level read-only enforcement, layer two.
 */
export function guardSql(sql: string, readOnly: boolean): string | null {
  const normalized = sql.replace(/\r\n/g, "\n");
  const { empty, multi } = scan(normalized);
  if (empty) return "read-only: empty statement";
  if (multi) return "multi-statement: only a single SQL statement is allowed";
  if (readOnly) {
    const first = firstWord(normalized);
    if (!READ_PREFIXES.includes(first)) {
      return `read-only: statement '${first}' is blocked (start the server with --allow-write to enable writes)`;
    }
    // MySQL writes files on the server from a plain SELECT.
    if (/\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(normalized)) {
      return "read-only: SELECT ... INTO OUTFILE/DUMPFILE is blocked (start the server with --allow-write to enable writes)";
    }
  }
  return null;
}
