#!/usr/bin/env node
import { IsolatedAdapter, loadConfig, serve } from "@database-mcp/core";
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

try {
  const config = loadConfig(process.argv.slice(2), process.env, {
    envPrefix: "SQLITE",
    dsnEnvVar: "SQLITE_PATH",
  });
  if (!config.connection.dsn) {
    throw new Error("config: no database given — pass --dsn /path/to.db, set SQLITE_PATH, or use --config");
  }
  // better-sqlite3 runs statements synchronously; a child process is the
  // only way to stop a runaway one at queryTimeoutMs (issue #38).
  const adapter = new IsolatedAdapter("sqlite", new URL("./adapter.js", import.meta.url).href, "SqliteAdapter", [
    config.connection.dsn,
  ]);
  await serve(adapter, config, version);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
