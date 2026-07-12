#!/usr/bin/env node
// PRD §8a acceptance for the MySQL password: configure the secret by every
// supported method and assert the literal never appears in server output.
// The canary is used as the actual password, so against a live server this
// exercises the auth-denied error path (where drivers echo credentials), and
// without one it exercises the connection-refused path. Both must stay clean.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "mysql", "typescript", "dist", "index.js");
const SECRET = "mysql-leak-canary-4e9d21c7b3";
const HOST = process.env.MYSQL_HOST ?? "127.0.0.1";

const dir = mkdtempSync(join(tmpdir(), "database-mcp-leak-"));
const pwFile = join(dir, "pw");
writeFileSync(pwFile, `${SECRET}\n`, { mode: 0o600 });
const yamlFile = join(dir, "config.yaml");
writeFileSync(
  yamlFile,
  `connection:\n  host: ${HOST}\n  user: mcp\n  database: conformance\n  password: \${LEAK_TEST_PW}\n`,
);

const base = { MYSQL_HOST: HOST, MYSQL_USER: "mcp", MYSQL_DATABASE: "conformance" };
const scenarios = [
  { name: "env var", env: { ...base, MYSQL_PASSWORD: SECRET } },
  { name: "*_FILE", env: { ...base, MYSQL_PASSWORD_FILE: pwFile } },
  { name: "yaml ${VAR}", env: { LEAK_TEST_PW: SECRET, DB_MCP_CONFIG: yamlFile } },
  { name: "inline DSN", env: { MYSQL_DSN: `mysql://mcp:${SECRET}@${HOST}:3306/conformance` } },
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

console.log(failures === 0 ? "\nleak-check (mysql): all scenarios clean" : `\nleak-check (mysql): ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
