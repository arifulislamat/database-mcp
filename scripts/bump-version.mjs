#!/usr/bin/env node
// Single source of truth for a package's version is its manifest
// (package.json for TypeScript, pyproject.toml for Python, Cargo.toml for
// Rust). This script
// keeps every derived reference in sync, and --check makes CI fail when
// anything drifts.
//
//   node scripts/bump-version.mjs <core|sqlite|libsql|mysql|mariadb|postgres> <version> [--lang ts|py|rs]
//     Sets the manifest version (default ts), syncs server.json (ts
//     engines), verifies the CHANGELOG has a matching heading, and prints
//     the release tag command. For rs it also syncs the server.json cargo
//     entry and updates every Rust crate's version requirement on the bumped
//     crate (engines pin core; mariadb pins mysql).
//
//   node scripts/bump-version.mjs --check
//     Verifies server.json versions match package.json, pyproject.toml and
//     Cargo.toml for every engine, and that Rust crates' requirements on each
//     other match their versions.
//     Run by CI; exits 1 on drift.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENGINES = ["sqlite", "libsql", "mysql", "mariadb", "postgres"];
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, obj) => writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");

const RUST_CRATES = ["core", ...ENGINES];
const rsPath = (pkg) => `${pkg}/rust/Cargo.toml`;
const rsVersion = (pkg) => readFileSync(rsPath(pkg), "utf8").match(/^version = "([^"]+)"$/m)?.[1];
// database-mcp-rs-<dep> = { version = "x.y.z", path = ... }
const rsRequirement = (dep) => new RegExp(`^(database-mcp-rs-${dep} = \\{ version = ")([^"]+)(")`, "m");

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
    const rs = existsSync(rsPath(e)) ? rsVersion(e) : undefined;
    for (const p of server.packages.filter((p) => p.registryType === "cargo")) {
      if (p.version !== rs) {
        drift++;
        console.error(`DRIFT ${e}: Cargo.toml=${rs} server.json cargo entry=${p.version}`);
      }
    }
  }
  for (const crate of RUST_CRATES.filter((c) => existsSync(rsPath(c)))) {
    const toml = readFileSync(rsPath(crate), "utf8");
    for (const dep of RUST_CRATES) {
      const req = toml.match(rsRequirement(dep))?.[2];
      if (req && req !== rsVersion(dep)) {
        drift++;
        console.error(`DRIFT ${crate}/rust: requires database-mcp-rs-${dep} ${req}, but ${dep}/rust/Cargo.toml is ${rsVersion(dep)}`);
      }
    }
  }
  console.log(drift === 0 ? "version check: all server.json in sync with package.json, pyproject.toml and Cargo.toml" : `version check: ${drift} package(s) drifted`);
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
  !["ts", "py", "rs"].includes(lang)
) {
  console.error("usage: node scripts/bump-version.mjs <core|" + ENGINES.join("|") + "> <x.y.z> [--lang ts|py|rs]  |  --check");
  process.exit(2);
}

if (lang === "rs") {
  // The first version line in Cargo.toml is [package]'s; dependency
  // versions live inside inline tables, never at line start.
  const path = rsPath(pkg);
  const toml = readFileSync(path, "utf8");
  if (!/^version = "[^"]+"$/m.test(toml)) {
    console.error(`ERROR: could not find a version line in ${path}`);
    process.exit(1);
  }
  writeFileSync(path, toml.replace(/^version = "[^"]+"$/m, `version = "${version}"`));
  console.log(`${path}: version -> ${version}`);

  const serverPath = `${pkg}/server.json`;
  if (existsSync(serverPath)) {
    const server = read(serverPath);
    for (const p of server.packages.filter((p) => p.registryType === "cargo")) p.version = version;
    write(serverPath, server);
    console.log(`${serverPath}: cargo entry -> ${version}`);
  }

  for (const crate of RUST_CRATES.filter((c) => c !== pkg && existsSync(rsPath(c)))) {
    const dependent = readFileSync(rsPath(crate), "utf8");
    if (rsRequirement(pkg).test(dependent)) {
      writeFileSync(rsPath(crate), dependent.replace(rsRequirement(pkg), `$1${version}$3`));
      console.log(`${rsPath(crate)}: requires database-mcp-rs-${pkg} ${version}`);
    }
  }

  const changelog = readFileSync(`${pkg}/rust/CHANGELOG.md`, "utf8");
  if (!changelog.includes(`## ${version}`)) {
    console.error(`WARNING: ${pkg}/rust/CHANGELOG.md has no "## ${version}" section yet, add it before tagging.`);
  }

  console.log(`\nnext: cargo test --workspace && cargo build --workspace (updates Cargo.lock) && node conformance/run.mjs -- target/debug/database-mcp-sqlite`);
  console.log(`tag:  git tag -s ${pkg}-rs-v${version} -m "database-mcp-rs-${pkg} ${version}" && git push origin ${pkg}-rs-v${version}`);
  if (pkg === "core" || pkg === "mysql") {
    console.log(`note: crates that depend on database-mcp-rs-${pkg} now require ${version}; release them after it.`);
  }
  process.exit(0);
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
