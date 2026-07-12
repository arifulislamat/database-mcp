#!/usr/bin/env node
import { loadConfig, serve } from "@database-mcp/core";
import { createRequire } from "node:module";
import { MariadbAdapter } from "./adapter.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

try {
  const config = loadConfig(process.argv.slice(2), process.env, {
    envPrefix: "MARIADB",
    dsnEnvVar: "MARIADB_DSN",
  });
  const c = config.connection;
  if (!c.dsn && !c.host && !c.database) {
    throw new Error(
      "config: no database given — pass --dsn mysql://user@host/db, set MARIADB_HOST/MARIADB_USER/MARIADB_DATABASE, or use --config",
    );
  }
  await serve(new MariadbAdapter(c), config, version);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
