import type { DatabaseAdapter } from "../adapter.js";
import type { Guardrails } from "../config.js";
import { redact } from "../secret.js";
import { guardSql } from "../sql-guard.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Maps session-level write rejections (layer two) to the stable prefix. */
function sanitizeError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/timeout:|read-only:|multi-statement:/.test(message)) return message;
  // SQLite: "readonly database"/query_only; MySQL: "READ ONLY transaction";
  // Postgres: "read-only transaction".
  if (/readonly database|query_only|read.only transaction/i.test(message)) {
    return "read-only: statement blocked by the database session (start the server with --allow-write to enable writes)";
  }
  // mysql2: inactivity timeout; Postgres: "canceling statement due to statement timeout".
  if (/inactivity timeout|PROTOCOL_SEQUENCE_TIMEOUT|statement timeout/i.test(message)) {
    return "timeout: query exceeded the configured queryTimeoutMs";
  }
  // Tool results travel over stdout (the MCP stream), which the stderr
  // redaction filter cannot cover — mask driver messages here too.
  return redact(message);
}

export function makeExecuteSql(adapter: DatabaseAdapter, guardrails: Guardrails) {
  return async ({ sql }: { sql: string }): Promise<ToolResult> => {
    const blocked = guardSql(sql, guardrails.readOnly);
    if (blocked) return err(blocked);
    try {
      const r = await adapter.query(sql, {
        maxRows: guardrails.maxRows,
        timeoutMs: guardrails.queryTimeoutMs,
      });
      const summary =
        r.columns.length === 0
          ? `OK (${r.rowCount} affected)`
          : r.truncated
            ? `truncated to ${r.rowCount} rows`
            : `${r.rowCount} rows`;
      const payload = JSON.stringify({ columns: r.columns, rows: r.rows });
      return { content: [{ type: "text", text: `${summary}\n${payload}` }] };
    } catch (e) {
      return err(sanitizeError(e));
    }
  };
}
