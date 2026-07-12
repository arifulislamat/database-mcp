#!/usr/bin/env node
import { loadConfig, serve } from "@database-mcp/core";
import { createRequire } from "node:module";
import { PostgresAdapter } from "./adapter.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

try {
  const config = loadConfig(process.argv.slice(2), process.env, {
    envPrefix: "POSTGRES",
    dsnEnvVar: "DATABASE_URL",
  });
  const c = config.connection;
  // The pg driver also honors libpq's native PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
  if (!c.dsn && !c.host && !c.database && !process.env.PGHOST && !process.env.PGDATABASE) {
    throw new Error(
      "config: no database given — pass --dsn postgres://user@host/db, set DATABASE_URL or POSTGRES_HOST/POSTGRES_USER/POSTGRES_DATABASE (or libpq PG* vars), or use --config",
    );
  }
  await serve(new PostgresAdapter(c, config.guardrails.queryTimeoutMs), config, version);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
