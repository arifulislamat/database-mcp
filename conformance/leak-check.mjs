#!/usr/bin/env node
// Secret-leak check (PRD section 8a acceptance).
// Usage: node leak-check.mjs --secret <literal> -- <command to launch server> [args...]
//
// Spawns the server with the environment it was given, captures ALL stdout +
// stderr through startup (and connection failure, if the target is down),
// then greps the combined output for the literal secret. Exit 1 on any hit.
//
// Engines wire scenarios (inline DSN, ${VAR} in YAML, *_FILE) by launching
// this once per configuration method. First credentialed engine: libSQL (M2).

import { spawn } from "node:child_process";

const sep = process.argv.indexOf("--");
const secretIdx = process.argv.indexOf("--secret");
const secret = secretIdx >= 0 ? process.argv[secretIdx + 1] : undefined;
const [command, ...args] = process.argv.slice(sep + 1);
if (sep === -1 || !command || !secret) {
  console.error("usage: node leak-check.mjs --secret <literal> -- <command> [args...]");
  process.exit(2);
}

const child = spawn(command, args, { env: process.env });
let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));

// Startup window: enough for connect + fail-fast; then stop the server.
await new Promise((resolve) => {
  const t = setTimeout(() => {
    child.kill("SIGTERM");
    resolve();
  }, 4000);
  child.on("exit", () => {
    clearTimeout(t);
    resolve();
  });
});

if (output.includes(secret)) {
  console.error("leak-check: FAIL — the literal secret appeared in server output");
  process.exit(1);
}
console.log("leak-check: ok (secret never appeared in output)");
