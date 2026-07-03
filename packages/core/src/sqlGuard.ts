/**
 * The shared SQL guard. Read-only classification is conservative: anything
 * not obviously a read is treated as a write and blocked (PRD §8).
 *
 * This module is engine-agnostic — it inspects the SQL text only, never a
 * database connection.
 */

// Statements that are unambiguously read-only. Everything else (INSERT,
// UPDATE, DELETE, DDL, CALL, MERGE, pragmas that mutate state, etc.) is
// treated as a write and rejected in read-only mode.
const READ_ONLY_LEADING_KEYWORDS = new Set([
  "SELECT",
  "WITH",
  "EXPLAIN",
  "SHOW",
  "DESCRIBE",
  "DESC",
  "PRAGMA",
  "VALUES",
]);

/** Strips leading SQL comments (line and block) and whitespace. */
function stripLeadingNoise(sql: string): string {
  let s = sql;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const trimmed = s.replace(/^\s+/, "");
    if (trimmed.startsWith("--")) {
      const newlineIdx = trimmed.indexOf("\n");
      s = newlineIdx === -1 ? "" : trimmed.slice(newlineIdx + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const endIdx = trimmed.indexOf("*/");
      s = endIdx === -1 ? "" : trimmed.slice(endIdx + 2);
      continue;
    }
    return trimmed;
  }
}

/**
 * Returns true if `sql` is safe to run when the server is in read-only mode.
 * Conservative by design: unknown/ambiguous statements are rejected.
 */
export function isReadOnlyStatement(sql: string): boolean {
  const cleaned = stripLeadingNoise(sql);
  if (cleaned.length === 0) {
    return false;
  }

  // PRAGMA statements that assign a value (e.g. `PRAGMA foreign_keys = OFF`)
  // mutate connection state and must not be treated as reads.
  if (/^PRAGMA\b/i.test(cleaned) && /=/.test(cleaned.split(/[;\n]/)[0])) {
    return false;
  }

  const match = cleaned.match(/^[A-Za-z]+/);
  if (!match) {
    return false;
  }

  const leadingKeyword = match[0].toUpperCase();
  if (!READ_ONLY_LEADING_KEYWORDS.has(leadingKeyword)) {
    return false;
  }

  // Reject statement batches (a second statement after a semicolon could be
  // a write) to keep the "single statement" contract from §6.1 honest.
  const withoutTrailingSemicolon = cleaned.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    return false;
  }

  return true;
}

/**
 * Error message prefix mandated by PRD §6.1 for rejected writes in
 * read-only mode.
 */
export const READ_ONLY_ERROR_PREFIX = "read-only:";

/** Error message prefix mandated by PRD §6.1 for statement timeouts. */
export const TIMEOUT_ERROR_PREFIX = "timeout:";

/** Error message prefix mandated by PRD §6.2 for unknown tables. */
export const UNKNOWN_TABLE_ERROR_PREFIX = "unknown table:";
