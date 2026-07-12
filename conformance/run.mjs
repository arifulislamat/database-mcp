#!/usr/bin/env node
// Conformance suite — the definition of done for any database-mcp server.
// Usage: node run.mjs [--engine sqlite|mysql|mariadb] -- <command to launch server> [args...]
//
// Seeds an engine-appropriate fixture (identical tables and rows in every
// dialect), spawns the server over stdio, and asserts the shared cases.json.
// MAX_ROWS is pinned to 3 so the truncation case holds. SQLite-family engines
// seed a temp file; networked engines seed the docker-compose/CI service
// (MYSQL_* env, defaults matching docker-compose.yml).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const sep = process.argv.indexOf("--");
const engineIdx = process.argv.indexOf("--engine");
const engine = engineIdx >= 0 ? process.argv[engineIdx + 1] : "sqlite";
const [command, ...args] = process.argv.slice(sep + 1);
if (sep === -1 || !command) {
  console.error("usage: node run.mjs [--engine sqlite|mysql|mariadb] -- <command> [args...]");
  process.exit(2);
}

let serverEnv = {};
let cleanup = () => {};

if (engine === "mysql" || engine === "mariadb") {
  // Same family, same dialect, same seed file; MariaDB defaults to port 3307
  // to coexist with MySQL in docker-compose.
  const P = engine.toUpperCase();
  const cfg = {
    host: process.env[`${P}_HOST`] ?? "127.0.0.1",
    port: Number(process.env[`${P}_PORT`] ?? (engine === "mariadb" ? 3307 : 3306)),
    user: process.env[`${P}_USER`] ?? "mcp",
    password: process.env[`${P}_PASSWORD`] ?? "mcp-password",
    database: process.env[`${P}_DATABASE`] ?? "conformance",
  };
  const { default: mysql } = await import("mysql2/promise");
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  await conn.query("DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS users;");
  await conn.query(readFileSync(join(here, "fixtures", "seed.mysql.sql"), "utf8"));
  await conn.end();
  serverEnv = {
    [`${P}_HOST`]: cfg.host,
    [`${P}_PORT`]: String(cfg.port),
    [`${P}_USER`]: cfg.user,
    [`${P}_PASSWORD`]: cfg.password,
    [`${P}_DATABASE`]: cfg.database,
  };
} else if (engine === "postgres") {
  const cfg = {
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "mcp",
    password: process.env.POSTGRES_PASSWORD ?? "mcp-password",
    database: process.env.POSTGRES_DATABASE ?? "conformance",
  };
  const { default: pg } = await import("pg");
  const client = new pg.Client(cfg);
  await client.connect();
  await client.query("DROP TABLE IF EXISTS orders, users CASCADE");
  await client.query(readFileSync(join(here, "fixtures", "seed.postgres.sql"), "utf8"));
  await client.end();
  serverEnv = {
    POSTGRES_HOST: cfg.host,
    POSTGRES_PORT: String(cfg.port),
    POSTGRES_USER: cfg.user,
    POSTGRES_PASSWORD: cfg.password,
    POSTGRES_DATABASE: cfg.database,
  };
} else {
  const { default: Database } = await import("better-sqlite3");
  const dir = mkdtempSync(join(tmpdir(), "database-mcp-conformance-"));
  const dbPath = join(dir, "fixture.db");
  const seed = new Database(dbPath);
  seed.exec(readFileSync(join(here, "fixtures", "seed.sqlite.sql"), "utf8"));
  seed.close();
  // Both SQLite-family env vars point at the fixture; each engine reads its own.
  serverEnv = { SQLITE_PATH: dbPath, LIBSQL_URL: `file:${dbPath}` };
  cleanup = () => rmSync(dir, { recursive: true, force: true });
}

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const client = new Client({ name: "conformance", version: "0.0.0" });
let failures = 0;

try {
  await client.connect(
    new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...serverEnv, MAX_ROWS: "3" },
      stderr: "inherit",
    }),
  );

  for (const c of cases) {
    const problems = [];
    // An engine-specific override replaces the whole expectation (see cases.json notes).
    const expect = c.overrides?.[engine] ?? c.expect;
    try {
      const result = await client.callTool({ name: c.tool, arguments: c.args });
      const text = (result.content ?? []).map((b) => b.text ?? "").join("\n");
      const isError = !!result.isError;

      if (expect.isError !== undefined && isError !== expect.isError) {
        problems.push(`isError: expected ${expect.isError}, got ${isError} — ${text.slice(0, 120)}`);
      }
      if (expect.textPrefix && !text.startsWith(expect.textPrefix)) {
        problems.push(`prefix: expected '${expect.textPrefix}', got '${text.slice(0, 60)}'`);
      }
      if (expect.summaryLine && text.split("\n")[0] !== expect.summaryLine) {
        problems.push(`summary: expected '${expect.summaryLine}', got '${text.split("\n")[0]}'`);
      }
      for (const needle of expect.textContains ?? []) {
        if (!text.includes(needle)) problems.push(`missing '${needle}' in output`);
      }
    } catch (e) {
      problems.push(`threw: ${e.message}`);
    }

    if (problems.length === 0) {
      console.log(`  ok   ${c.name}`);
    } else {
      failures++;
      console.log(`  FAIL ${c.name}`);
      for (const p of problems) console.log(`       ${p}`);
    }
  }
} finally {
  await client.close().catch(() => {});
  cleanup();
}

console.log(failures === 0 ? `\nconformance: all ${cases.length} cases passed` : `\nconformance: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
