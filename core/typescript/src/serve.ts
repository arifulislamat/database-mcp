import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DatabaseAdapter } from "./adapter.js";
import type { Config } from "./config.js";
import { buildServer } from "./server.js";

/**
 * Connects the adapter, registers the tools, and serves over stdio.
 * The whole lifecycle an engine entry point needs — an engine package is
 * just an adapter plus a few lines calling this.
 */
export async function serve(adapter: DatabaseAdapter, config: Config, version: string): Promise<void> {
  // stdout is reserved for the MCP stream; all logging goes to stderr.
  await adapter.connect({ readOnly: config.guardrails.readOnly });

  const server = buildServer(adapter, config.guardrails, version);
  const shutdown = async () => {
    await server.close();
    await adapter.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(new StdioServerTransport());
  console.error(`database-mcp-${adapter.engine} ${version} ready (read-only: ${config.guardrails.readOnly})`);
}
