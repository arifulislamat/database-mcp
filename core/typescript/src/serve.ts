import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DatabaseAdapter } from "./adapter.js";
import type { Config } from "./config.js";
import { installLogRedaction, redact } from "./secret.js";
import { buildServer } from "./server.js";

/**
 * Connects the adapter, registers the tools, and serves over stdio.
 * The whole lifecycle an engine entry point needs — an engine package is
 * just an adapter plus a few lines calling this.
 */
export async function serve(adapter: DatabaseAdapter, config: Config, version: string): Promise<void> {
  // stdout is reserved for the MCP stream; stderr carries logs and is
  // masked by the redaction filter before anything reaches the terminal.
  installLogRedaction();

  try {
    await adapter.connect({ readOnly: config.guardrails.readOnly });
  } catch (e) {
    // Driver connection errors can echo credentials; never rethrow raw.
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`connection failed: ${redact(message)}`);
  }

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
