#!/usr/bin/env node
// PRD §8a acceptance for the libSQL auth token: configure the secret by every
// supported method, capture all server output through startup + a failed
// remote connection, and assert the literal never appears. No live server
// needed — the failure path is exactly where drivers tend to leak.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "libsql", "typescript", "dist", "index.js");
const SECRET = "leak-canary-6b2f0d5e8a";
const URL = "http://127.0.0.1:9"; // discard port: fails fast, exercises the error path

const dir = mkdtempSync(join(tmpdir(), "database-mcp-leak-"));
const tokenFile = join(dir, "token");
writeFileSync(tokenFile, `${SECRET}\n`, { mode: 0o600 });
const yamlFile = join(dir, "config.yaml");
writeFileSync(yamlFile, `connection:\n  dsn: ${URL}\n  password: \${LEAK_TEST_TOKEN}\n`);

const scenarios = [
  { name: "env var", env: { LIBSQL_URL: URL, LIBSQL_AUTH_TOKEN: SECRET } },
  { name: "*_FILE", env: { LIBSQL_URL: URL, LIBSQL_AUTH_TOKEN_FILE: tokenFile } },
  { name: "yaml ${VAR}", env: { LEAK_TEST_TOKEN: SECRET, DB_MCP_CONFIG: yamlFile } },
];

let failures = 0;
for (const s of scenarios) {
  const r = spawnSync(
    "node",
    [join(here, "leak-check.mjs"), "--secret", SECRET, "--", "node", server],
    { env: { ...process.env, ...s.env }, encoding: "utf8" },
  );
  const ok = r.status === 0;
  console.log(`  ${ok ? "ok  " : "FAIL"} token via ${s.name}`);
  if (!ok) {
    failures++;
    process.stderr.write(r.stdout + r.stderr);
  }
}
rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nleak-check: all scenarios clean" : `\nleak-check: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
