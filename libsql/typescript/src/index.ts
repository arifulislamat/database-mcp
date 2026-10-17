#!/usr/bin/env node
import { IsolatedAdapter, loadConfig, serve } from "@database-mcp/core";
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
  const dsn = config.connection.dsn;
  // Local files run synchronously in the driver; a child process is the only
  // way to stop a runaway statement at queryTimeoutMs (issue #38). Remote
  // servers are plain async HTTP and stay in-process with their token.
  const remote = /^(libsql|https?|wss?):/i.test(dsn);
  const adapter = remote
    ? new LibsqlAdapter(dsn, config.connection.password)
    : new IsolatedAdapter("libsql", new URL("./adapter.js", import.meta.url).href, "LibsqlAdapter", [dsn]);
  await serve(adapter, config, version);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
