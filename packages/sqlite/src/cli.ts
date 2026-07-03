#!/usr/bin/env node
import { createServer, loadConfig, serveStdio } from "@db-mcp/core";
import { SqliteAdapter } from "./adapter.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const file = config.connection.dsn ?? ":memory:";

  const adapter = new SqliteAdapter({ file });
  await adapter.connect();

  const server = createServer({
    name: "db-mcp-sqlite",
    version: "0.1.0",
    adapter,
    guardrails: config.guardrails,
  });

  if (config.transport.kind === "stdio") {
    await serveStdio(server);
  } else {
    throw new Error(
      `transport "${config.transport.kind}" is not yet implemented for @db-mcp/sqlite`,
    );
  }

  const shutdown = async () => {
    await adapter.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
