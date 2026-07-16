#!/usr/bin/env node
// Single source of truth for a package's version is its manifest
// (package.json for TypeScript, pyproject.toml for Python). This script
// keeps every derived reference in sync, and --check makes CI fail when
// anything drifts.
//
//   node scripts/bump-version.mjs <core|sqlite|libsql|mysql|mariadb|postgres> <version> [--lang ts|py]
//     Sets the manifest version (default ts), syncs server.json (ts
//     engines), verifies the CHANGELOG has a matching heading, and prints
//     the release tag command.
//
//   node scripts/bump-version.mjs --check
//     Verifies server.json versions match package.json for every engine.
//     Run by CI; exits 1 on drift.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENGINES = ["sqlite", "libsql", "mysql", "mariadb", "postgres"];
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");

const pyVersion = (pkg) => readFileSync(`${pkg}/python/pyproject.toml`, "utf8").match(/^version = "([^"]+)"$/m)?.[1];

if (process.argv[2] === "--check") {
  let drift = 0;
  for (const e of ENGINES) {
    const pkg = read(`${e}/typescript/package.json`).version;
    const server = read(`${e}/server.json`);
    const npmVersions = server.packages.filter((p) => p.registryType === "npm").map((p) => p.version);
    const bad = [server.version, ...npmVersions].filter((v) => v !== pkg);
    if (bad.length) {
      drift++;
      console.error(`DRIFT ${e}: package.json=${pkg} server.json=${server.version}/${npmVersions}`);
    }
    const py = existsSync(`${e}/python/pyproject.toml`) ? pyVersion(e) : undefined;
    for (const p of server.packages.filter((p) => p.registryType === "pypi")) {
      if (p.version !== py) {
        drift++;
        console.error(`DRIFT ${e}: pyproject.toml=${py} server.json pypi entry=${p.version}`);
      }
    }
  }
  console.log(drift === 0 ? "version check: all server.json in sync with package.json" : `version check: ${drift} package(s) drifted`);
  process.exit(drift === 0 ? 0 : 1);
}

const args = process.argv.slice(2);
const langIdx = args.indexOf("--lang");
const lang = langIdx >= 0 ? args.splice(langIdx, 2)[1] : "ts";
const [pkg, version] = args;
if (
  !pkg ||
  !/^\d+\.\d+\.\d+$/.test(version ?? "") ||
  (pkg !== "core" && !ENGINES.includes(pkg)) ||
  !["ts", "py"].includes(lang)
) {
  console.error("usage: node scripts/bump-version.mjs <core|" + ENGINES.join("|") + "> <x.y.z> [--lang ts|py]  |  --check");
  process.exit(2);
}

if (lang === "py") {
  const pyPath = `${pkg}/python/pyproject.toml`;
  const toml = readFileSync(pyPath, "utf8");
  const updated = toml.replace(/^version = "[^"]+"$/m, `version = "${version}"`);
  if (updated === toml && !toml.includes(`version = "${version}"`)) {
    console.error(`ERROR: could not find a version line in ${pyPath}`);
    process.exit(1);
  }
  writeFileSync(pyPath, updated);
  console.log(`${pyPath}: version -> ${version}`);

  const serverPath = `${pkg}/server.json`;
  if (existsSync(serverPath)) {
    const server = read(serverPath);
    for (const p of server.packages.filter((p) => p.registryType === "pypi")) p.version = version;
    write(serverPath, server);
    console.log(`${serverPath}: pypi entry -> ${version}`);
  }

  const changelog = readFileSync(`${pkg}/python/CHANGELOG.md`, "utf8");
  if (!changelog.includes(`## ${version}`)) {
    console.error(`WARNING: ${pkg}/python/CHANGELOG.md has no "## ${version}" section yet, add it before tagging.`);
  }

  console.log(`\nnext: uv sync && uv run pytest core/python/tests && node conformance/run.mjs -- uv run database-mcp-${pkg === "core" ? "sqlite" : pkg}`);
  console.log(`tag:  git tag -s ${pkg}-py-v${version} -m "database-mcp-${pkg} ${version}" && git push origin ${pkg}-py-v${version}`);
  process.exit(0);
}

const pkgPath = `${pkg}/typescript/package.json`;
const manifest = read(pkgPath);
manifest.version = version;
write(pkgPath, manifest);
console.log(`${pkgPath}: version -> ${version}`);

const serverPath = `${pkg}/server.json`;
if (existsSync(serverPath)) {
  const server = read(serverPath);
  server.version = version;
  for (const p of server.packages.filter((p) => p.registryType === "npm")) p.version = version;
  write(serverPath, server);
  console.log(`${serverPath}: version -> ${version}`);
}

const changelog = readFileSync(`${pkg}/typescript/CHANGELOG.md`, "utf8");
if (!changelog.includes(`## ${version}`)) {
  console.error(`WARNING: ${pkg}/typescript/CHANGELOG.md has no "## ${version}" section yet — add it before tagging.`);
}

console.log(`\nnext: npm install && npm run build && npm test && npm run conformance`);
console.log(`tag:  git tag -s ${pkg}-ts-v${version} -m "@database-mcp/${pkg} ${version}" && git push origin ${pkg}-ts-v${version}`);
console.log(`then: mcp-publisher publish (from ${pkg}/) to update the MCP Registry`);
