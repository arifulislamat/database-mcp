#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { SqliteAdapter } from "./adapters/sqlite.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

async function main() {
  // stdout is reserved for the MCP stream; all logging goes to stderr.
  const config = loadConfig(process.argv.slice(2), process.env);
  const adapter = new SqliteAdapter(config.dsn);
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
  console.error(`database-mcp-sqlite ${version} ready (read-only: ${config.guardrails.readOnly})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
