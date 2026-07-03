#!/usr/bin/env node
/**
 * db-mcp conformance suite (PRD §10).
 *
 * Connects to a server-under-test over stdio and runs the shared
 * `cases.json`, plus a small hard-coded read/write fixture roundtrip that
 * needs setup/teardown logic (not expressible as pure data).
 *
 * Invocation:
 *   node run.mjs -- <command> [args...]
 *
 * Example:
 *   node run.mjs -- node ../packages/sqlite/dist/cli.js --allow-write --dsn :memory:
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgv(argv) {
  const sepIdx = argv.indexOf("--");
  if (sepIdx === -1 || sepIdx === argv.length - 1) {
    throw new Error("usage: node run.mjs -- <command> [args...]");
  }
  const [command, ...args] = argv.slice(sepIdx + 1);
  return { command, args };
}

/** Parses a tool result's text content into { summary, json }. */
function parseToolText(text) {
  const newlineIdx = text.indexOf("\n");
  if (newlineIdx === -1) {
    try {
      return { summary: null, json: JSON.parse(text) };
    } catch {
      return { summary: text, json: undefined };
    }
  }
  const summary = text.slice(0, newlineIdx);
  const rest = text.slice(newlineIdx + 1);
  try {
    return { summary, json: JSON.parse(rest) };
  } catch {
    return { summary, json: undefined };
  }
}

/**
 * Structural equality via JSON serialization. Sufficient for this suite's
 * fixtures (plain objects/arrays with primitive values and stable key
 * insertion order from `JSON.parse`), but note it is order-sensitive for
 * object keys and cannot distinguish a missing key from one explicitly set
 * to `undefined` (both serialize away). Do not reuse for arbitrary payloads.
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

class Reporter {
  constructor() {
    this.results = [];
  }
  record(id, description, ok, detail) {
    this.results.push({ id, description, ok, detail });
    const status = ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${id} — ${description}${detail ? `\n       ${detail}` : ""}`);
  }
  summarize() {
    const failed = this.results.filter((r) => !r.ok);
    console.log(`\n${this.results.length - failed.length}/${this.results.length} cases passed.`);
    return failed.length === 0;
  }
}

async function callTool(client, name, args) {
  return client.callTool({ name, arguments: args });
}

function assertToolResult(reporter, id, description, result, expect) {
  const problems = [];

  if (typeof expect.isError === "boolean" && Boolean(result.isError) !== expect.isError) {
    problems.push(`expected isError=${expect.isError}, got ${Boolean(result.isError)}`);
  }

  const text = result.content?.[0]?.text ?? "";
  const { json } = parseToolText(text);

  if (expect.textStartsWith && !text.startsWith(expect.textStartsWith)) {
    problems.push(`expected text to start with "${expect.textStartsWith}", got "${text}"`);
  }

  if (expect.textIncludes) {
    for (const fragment of expect.textIncludes) {
      if (!text.includes(fragment)) {
        problems.push(`expected text to include "${fragment}", got "${text}"`);
      }
    }
  }

  if (expect.jsonEquals && !deepEqual(json, expect.jsonEquals)) {
    problems.push(`expected JSON ${JSON.stringify(expect.jsonEquals)}, got ${JSON.stringify(json)}`);
  }

  if (expect.jsonHasKey && (!json || !(expect.jsonHasKey in json))) {
    problems.push(`expected JSON to have key "${expect.jsonHasKey}", got ${JSON.stringify(json)}`);
  }

  reporter.record(id, description, problems.length === 0, problems.join("; "));
}

async function runDataDrivenCases(client, reporter) {
  const cases = JSON.parse(await readFile(path.join(__dirname, "cases.json"), "utf8"));

  for (const testCase of cases) {
    if (testCase.type === "listTools") {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      const expected = [...testCase.expect.toolNames].sort();
      const ok = deepEqual(names, expected);
      reporter.record(
        testCase.id,
        testCase.description,
        ok,
        ok ? undefined : `expected tools ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`,
      );
      continue;
    }

    if (testCase.type === "callTool") {
      const result = await callTool(client, testCase.tool, testCase.arguments ?? {});
      assertToolResult(reporter, testCase.id, testCase.description, result, testCase.expect);
      continue;
    }

    reporter.record(testCase.id, testCase.description, false, `unknown case type "${testCase.type}"`);
  }
}

/**
 * Probes whether the server is running in read-only mode, then either
 * verifies the write-rejection error (read-only mode) or runs a full
 * create/insert/select/describe/drop fixture roundtrip (write mode).
 */
async function runReadWriteFixture(client, reporter) {
  const table = "__db_mcp_conformance_fixture__";

  const createAttempt = await callTool(client, "execute_sql", {
    sql: `CREATE TABLE ${table} (id INTEGER, label TEXT)`,
  });
  const createText = createAttempt.content?.[0]?.text ?? "";

  if (createAttempt.isError && createText.startsWith("read-only:")) {
    reporter.record(
      "read-only-write-rejected",
      "In read-only mode, a CREATE TABLE is rejected with the mandated prefix (PRD §6.1)",
      true,
    );
    reporter.record(
      "read-write-fixture-roundtrip",
      "Skipped: server is running in read-only mode (pass --allow-write to exercise writes)",
      true,
    );
    return;
  }

  reporter.record(
    "read-write-fixture-setup",
    "CREATE TABLE succeeds when write mode is enabled",
    !createAttempt.isError,
    createAttempt.isError ? createText : undefined,
  );

  try {
    const insert = await callTool(client, "execute_sql", {
      sql: `INSERT INTO ${table} (id, label) VALUES (1, 'a'), (2, 'b')`,
    });
    reporter.record(
      "read-write-fixture-insert",
      "INSERT succeeds and reports affected rows",
      !insert.isError,
      insert.isError ? insert.content?.[0]?.text : undefined,
    );

    const select = await callTool(client, "execute_sql", { sql: `SELECT * FROM ${table} ORDER BY id` });
    const { json: selectJson } = parseToolText(select.content?.[0]?.text ?? "");
    reporter.record(
      "read-write-fixture-select",
      "SELECT returns the inserted rows",
      !select.isError && deepEqual(selectJson?.rows, [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ]),
      select.isError ? select.content?.[0]?.text : JSON.stringify(selectJson),
    );

    const describe = await callTool(client, "search_objects", { table });
    const { json: describeJson } = parseToolText(describe.content?.[0]?.text ?? "");
    const columnNames = (describeJson?.columns ?? []).map((c) => c.name).sort();
    reporter.record(
      "read-write-fixture-describe",
      "search_objects describes the fixture table's columns",
      !describe.isError && deepEqual(columnNames, ["id", "label"]),
      describe.isError ? describe.content?.[0]?.text : JSON.stringify(describeJson),
    );
  } finally {
    await callTool(client, "execute_sql", { sql: `DROP TABLE ${table}` });
  }
}

async function main() {
  const { command, args } = parseArgv(process.argv);
  const reporter = new Reporter();

  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: "db-mcp-conformance", version: "0.1.0" });
  await client.connect(transport);

  try {
    await runDataDrivenCases(client, reporter);
    await runReadWriteFixture(client, reporter);
  } finally {
    await client.close();
  }

  const ok = reporter.summarize();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
