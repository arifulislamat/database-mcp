#!/usr/bin/env node
// Single source of truth for a package's version is its package.json.
// This script keeps every derived reference in sync, and --check makes CI
// fail when anything drifts.
//
//   node scripts/bump-version.mjs <core|sqlite|libsql|mysql|mariadb|postgres> <version>
//     Sets package.json version, syncs server.json (engines), verifies the
//     CHANGELOG has a matching heading, and prints the release tag command.
//
//   node scripts/bump-version.mjs --check
//     Verifies server.json versions match package.json for every engine.
//     Run by CI; exits 1 on drift.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENGINES = ["sqlite", "libsql", "mysql", "mariadb", "postgres"];
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");

if (process.argv[2] === "--check") {
  let drift = 0;
  for (const e of ENGINES) {
    const pkg = read(`${e}/typescript/package.json`).version;
    const server = read(`${e}/typescript/server.json`);
    const bad = [server.version, server.packages?.[0]?.version].filter((v) => v !== pkg);
    if (bad.length) {
      drift++;
      console.error(`DRIFT ${e}: package.json=${pkg} server.json=${server.version}/${server.packages?.[0]?.version}`);
    }
  }
  console.log(drift === 0 ? "version check: all server.json in sync with package.json" : `version check: ${drift} package(s) drifted`);
  process.exit(drift === 0 ? 0 : 1);
}

const [pkg, version] = process.argv.slice(2);
if (!pkg || !/^\d+\.\d+\.\d+$/.test(version ?? "") || (pkg !== "core" && !ENGINES.includes(pkg))) {
  console.error("usage: node scripts/bump-version.mjs <core|" + ENGINES.join("|") + "> <x.y.z>  |  --check");
  process.exit(2);
}

const pkgPath = `${pkg}/typescript/package.json`;
const manifest = read(pkgPath);
manifest.version = version;
write(pkgPath, manifest);
console.log(`${pkgPath}: version -> ${version}`);

const serverPath = `${pkg}/typescript/server.json`;
if (existsSync(serverPath)) {
  const server = read(serverPath);
  server.version = version;
  if (server.packages?.[0]) server.packages[0].version = version;
  write(serverPath, server);
  console.log(`${serverPath}: version -> ${version}`);
}

const changelog = readFileSync(`${pkg}/typescript/CHANGELOG.md`, "utf8");
if (!changelog.includes(`## ${version}`)) {
  console.error(`WARNING: ${pkg}/typescript/CHANGELOG.md has no "## ${version}" section yet — add it before tagging.`);
}

console.log(`\nnext: npm install && npm run build && npm test && npm run conformance`);
console.log(`tag:  git tag -s ${pkg}-ts-v${version} -m "@database-mcp/${pkg} ${version}" && git push origin ${pkg}-ts-v${version}`);
console.log(`then: mcp-publisher publish (from ${pkg}/typescript) to update the MCP Registry`);
