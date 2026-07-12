#!/usr/bin/env node
import { loadConfig, serve } from "@database-mcp/core";
import { createRequire } from "node:module";
import { MysqlAdapter } from "./adapter.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

try {
  const config = loadConfig(process.argv.slice(2), process.env, {
    envPrefix: "MYSQL",
    dsnEnvVar: "MYSQL_DSN",
  });
  const c = config.connection;
  if (!c.dsn && !c.host && !c.database) {
    throw new Error(
      "config: no database given — pass --dsn mysql://user@host/db, set MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE, or use --config",
    );
  }
  await serve(new MysqlAdapter(c), config, version);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
