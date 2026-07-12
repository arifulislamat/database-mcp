#!/usr/bin/env node
import { loadConfig, serve } from "@database-mcp/core";
import { createRequire } from "node:module";
import { LibsqlAdapter } from "./adapter.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

try {
  const config = loadConfig(process.argv.slice(2), process.env, {
    envPrefix: "LIBSQL",
    dsnEnvVar: "LIBSQL_URL",
    passwordEnvVar: "LIBSQL_AUTH_TOKEN",
  });
  if (!config.connection.dsn) {
    throw new Error(
      "config: no database given — pass --dsn <file-or-libsql-url>, set LIBSQL_URL, or use --config",
    );
  }
  await serve(new LibsqlAdapter(config.connection.dsn, config.connection.password), config, version);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
