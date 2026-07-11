const READ_PREFIXES = ["SELECT", "WITH", "EXPLAIN", "VALUES", "SHOW", "DESCRIBE", "DESC"];

/** Strips comments and returns the statement trimmed, or null if empty. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
}

/** True if a semicolon appears outside string literals before the end. */
function hasMultipleStatements(sql: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === ";" && sql.slice(i + 1).trim() !== "") {
      return true;
    }
  }
  return false;
}

/**
 * Layer-one guard. Returns an error message (with its stable prefix) or null.
 * Conservative: anything not obviously a read is treated as a write. Writes
 * that sneak past (e.g. `WITH x AS (...) DELETE ...`) are stopped by the
 * adapter's session-level read-only enforcement, layer two.
 */
export function guardSql(sql: string, readOnly: boolean): string | null {
  const stripped = stripComments(sql);
  if (!stripped) return "read-only: empty statement";
  if (hasMultipleStatements(stripped)) {
    return "multi-statement: only a single SQL statement is allowed";
  }
  if (readOnly) {
    const first = (stripped.match(/^[A-Za-z]+/) ?? [""])[0].toUpperCase();
    if (!READ_PREFIXES.includes(first)) {
      return `read-only: statement '${first}' is blocked (start the server with --allow-write to enable writes)`;
    }
  }
  return null;
}
