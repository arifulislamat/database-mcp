import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { DatabaseAdapter } from "./adapter.js";
import { QueryTimeoutError, UnknownTableError } from "./adapter.js";
import type { Guardrails } from "./guardrails.js";
import {
  isReadOnlyStatement,
  READ_ONLY_ERROR_PREFIX,
  TIMEOUT_ERROR_PREFIX,
  UNKNOWN_TABLE_ERROR_PREFIX,
} from "./sqlGuard.js";

export interface CreateServerOptions {
  name: string;
  version: string;
  adapter: DatabaseAdapter;
  guardrails: Guardrails;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/**
 * Builds the two-tool MCP server surface (PRD §6) on top of a
 * `DatabaseAdapter`. This function is engine-agnostic: it never imports a
 * DB driver directly.
 */
export function createServer(options: CreateServerOptions): McpServer {
  const { adapter, guardrails } = options;

  const server = new McpServer({ name: options.name, version: options.version });

  server.registerTool(
    "execute_sql",
    {
      title: "Execute SQL",
      description:
        "Execute a single SQL statement against the connected database. " +
        "Read-only mode blocks mutating statements. Results are capped at " +
        "maxRows and aborted after queryTimeoutMs.",
      inputSchema: {
        sql: z.string().min(1).describe("A single SQL statement to execute."),
      },
    },
    async ({ sql }) => {
      if (guardrails.readOnly && !isReadOnlyStatement(sql)) {
        return textResult(
          `${READ_ONLY_ERROR_PREFIX} write statements are disabled (read-only mode is on)`,
          true,
        );
      }

      try {
        const result = await adapter.query(sql, {
          maxRows: guardrails.maxRows,
          timeoutMs: guardrails.queryTimeoutMs,
        });

        const summary = result.truncated
          ? `truncated to ${result.rows.length} rows`
          : isReadOnlyStatement(sql)
            ? `${result.rowCount} rows`
            : `OK (${result.rowCount} affected)`;

        const body = JSON.stringify({ columns: result.columns, rows: result.rows });
        return textResult(`${summary}\n${body}`);
      } catch (err) {
        if (err instanceof QueryTimeoutError) {
          return textResult(`${TIMEOUT_ERROR_PREFIX} ${err.message}`, true);
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResult(message, true);
      }
    },
  );

  server.registerTool(
    "search_objects",
    {
      title: "Search database objects",
      description:
        "Progressive-disclosure schema browser. Called with no table to list " +
        "tables, or with a table name to get columns/indexes/foreign keys.",
      inputSchema: {
        table: z.string().min(1).optional().describe("Table name to describe."),
      },
    },
    async ({ table }) => {
      try {
        if (!table) {
          const tables = await adapter.listTables();
          return textResult(JSON.stringify({ tables }));
        }
        const description = await adapter.describeTable(table);
        return textResult(JSON.stringify(description));
      } catch (err) {
        if (err instanceof UnknownTableError) {
          return textResult(`${UNKNOWN_TABLE_ERROR_PREFIX} ${err.table}`, true);
        }
        const message = err instanceof Error ? err.message : String(err);
        return textResult(message, true);
      }
    },
  );

  return server;
}

/** Connects `server` over stdio. Used by every engine package's CLI entry point. */
export async function serveStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
