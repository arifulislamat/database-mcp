#!/usr/bin/env node
import { loadConfig, serve } from "@database-mcp/core";
import { createRequire } from "node:module";
import { SqliteAdapter } from "./adapter.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

try {
  const config = loadConfig(process.argv.slice(2), process.env, {
    envPrefix: "SQLITE",
    dsnEnvVar: "SQLITE_PATH",
  });
  if (!config.connection.dsn) {
    throw new Error("config: no database given — pass --dsn /path/to.db, set SQLITE_PATH, or use --config");
  }
  await serve(new SqliteAdapter(config.connection.dsn), config, version);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
