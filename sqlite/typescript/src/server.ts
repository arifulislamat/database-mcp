import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DatabaseAdapter } from "./adapter.js";
import type { Guardrails } from "./config.js";
import { makeExecuteSql } from "./tools/execute-sql.js";
import { makeSearchObjects } from "./tools/search-objects.js";

export function buildServer(adapter: DatabaseAdapter, guardrails: Guardrails, version: string): McpServer {
  const server = new McpServer({ name: `database-mcp-${adapter.engine}`, version });

  server.registerTool(
    "execute_sql",
    {
      description:
        `Run a single SQL statement against the ${adapter.engine} database. ` +
        `Returns a summary line followed by compact JSON {columns, rows}. ` +
        (guardrails.readOnly ? "The connection is read-only. " : "") +
        `Results are capped at ${guardrails.maxRows} rows.`,
      inputSchema: { sql: z.string().describe("A single SQL statement") },
    },
    makeExecuteSql(adapter, guardrails),
  );

  server.registerTool(
    "search_objects",
    {
      description:
        "Explore the schema progressively. Without arguments: list all tables with estimated row counts. " +
        "With a table name: full detail — columns, indexes, and foreign keys.",
      inputSchema: { table: z.string().optional().describe("Table name for detail; omit to list tables") },
    },
    makeSearchObjects(adapter),
  );

  return server;
}
