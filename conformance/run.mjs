#!/usr/bin/env node
// Conformance suite — the definition of done for any database-mcp server.
// Usage: node run.mjs -- <command to launch server> [args...]
// Spawns the server over stdio with a seeded fixture database and asserts
// the shared cases.json. MAX_ROWS is pinned to 3 so the truncation case holds.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const sep = process.argv.indexOf("--");
const [command, ...args] = process.argv.slice(sep + 1);
if (sep === -1 || !command) {
  console.error("usage: node run.mjs -- <command to launch server> [args...]");
  process.exit(2);
}

// Seed a throwaway SQLite database. Networked engines get a docker-compose
// seeding path when they land (M3); the fixture shape stays identical.
const { default: Database } = await import("better-sqlite3");
const dir = mkdtempSync(join(tmpdir(), "database-mcp-conformance-"));
const dbPath = join(dir, "fixture.db");
const seed = new Database(dbPath);
seed.exec(readFileSync(join(here, "fixtures", "seed.sqlite.sql"), "utf8"));
seed.close();

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const client = new Client({ name: "conformance", version: "0.0.0" });
let failures = 0;

try {
  await client.connect(
    new StdioClientTransport({
      command,
      args,
      env: { ...process.env, SQLITE_PATH: dbPath, MAX_ROWS: "3" },
      stderr: "inherit",
    }),
  );

  for (const c of cases) {
    const problems = [];
    try {
      const result = await client.callTool({ name: c.tool, arguments: c.args });
      const text = (result.content ?? []).map((b) => b.text ?? "").join("\n");
      const isError = !!result.isError;

      if (c.expect.isError !== undefined && isError !== c.expect.isError) {
        problems.push(`isError: expected ${c.expect.isError}, got ${isError} — ${text.slice(0, 120)}`);
      }
      if (c.expect.textPrefix && !text.startsWith(c.expect.textPrefix)) {
        problems.push(`prefix: expected '${c.expect.textPrefix}', got '${text.slice(0, 60)}'`);
      }
      if (c.expect.summaryLine && text.split("\n")[0] !== c.expect.summaryLine) {
        problems.push(`summary: expected '${c.expect.summaryLine}', got '${text.split("\n")[0]}'`);
      }
      for (const needle of c.expect.textContains ?? []) {
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
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? `\nconformance: all ${cases.length} cases passed` : `\nconformance: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
