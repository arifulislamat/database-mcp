#!/usr/bin/env node
// PRD §8a acceptance for the Postgres password — same drill as leak-mysql.mjs:
// canary as the actual password, all config methods, output must stay clean
// through the auth-denied (live server) or connection-refused path.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "postgres", "typescript", "dist", "index.js");
const SECRET = "pg-leak-canary-7c31f8a2d9";
const HOST = process.env.POSTGRES_HOST ?? "127.0.0.1";

const dir = mkdtempSync(join(tmpdir(), "database-mcp-leak-"));
const pwFile = join(dir, "pw");
writeFileSync(pwFile, `${SECRET}\n`, { mode: 0o600 });
const yamlFile = join(dir, "config.yaml");
writeFileSync(
  yamlFile,
  `connection:\n  host: ${HOST}\n  user: mcp\n  database: conformance\n  password: \${LEAK_TEST_PW}\n`,
);

const base = { POSTGRES_HOST: HOST, POSTGRES_USER: "mcp", POSTGRES_DATABASE: "conformance" };
const scenarios = [
  { name: "env var", env: { ...base, POSTGRES_PASSWORD: SECRET } },
  { name: "*_FILE", env: { ...base, POSTGRES_PASSWORD_FILE: pwFile } },
  { name: "yaml ${VAR}", env: { LEAK_TEST_PW: SECRET, DB_MCP_CONFIG: yamlFile } },
  { name: "inline DSN", env: { DATABASE_URL: `postgres://mcp:${SECRET}@${HOST}:5432/conformance` } },
];

let failures = 0;
for (const s of scenarios) {
  const r = spawnSync(
    "node",
    [join(here, "leak-check.mjs"), "--secret", SECRET, "--", "node", server],
    { env: { ...process.env, ...s.env }, encoding: "utf8" },
  );
  const ok = r.status === 0;
  console.log(`  ${ok ? "ok  " : "FAIL"} password via ${s.name}`);
  if (!ok) {
    failures++;
    process.stderr.write(r.stdout + r.stderr);
  }
}
rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nleak-check (postgres): all scenarios clean" : `\nleak-check (postgres): ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
