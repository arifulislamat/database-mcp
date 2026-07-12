import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret, redact, sanitizeDsn, loadConfig, guardSql } from "../dist/index.js";

test("Secret never prints through any render path", () => {
  const s = new Secret("hunter2");
  assert.equal(String(s), "***");
  assert.equal(`${s}`, "***");
  assert.equal(JSON.stringify({ password: s }), '{"password":"***"}');
  assert.equal(inspect(s), "***");
  assert.equal(s.reveal(), "hunter2");
});

test("redact masks registered secrets and URI credentials", () => {
  new Secret("s3cr3t-value"); // constructor registers
  assert.equal(redact("oops: s3cr3t-value leaked"), "oops: *** leaked");
  assert.equal(
    redact("connecting to mysql://root:p4ss@db.example.com:3306/app"),
    "connecting to mysql://root:***@db.example.com:3306/app",
  );
});

test("sanitizeDsn strips the password, keeps the rest", () => {
  assert.equal(sanitizeDsn("mysql://user:pw@host:3306/db"), "mysql://user@host:3306/db");
  assert.equal(sanitizeDsn("/plain/file/path.db"), "/plain/file/path.db");
});

test("config: YAML + ${VAR} expansion + password becomes a Secret", () => {
  const dir = mkdtempSync(join(tmpdir(), "dbmcp-test-"));
  const yamlPath = join(dir, "c.yaml");
  writeFileSync(
    yamlPath,
    "connection:\n  host: db.local\n  user: app\n  password: ${TEST_DB_PW}\nguardrails:\n  maxRows: 7\n",
  );
  const config = loadConfig(["--config", yamlPath], { TEST_DB_PW: "from-env-9" }, { envPrefix: "X" });
  assert.equal(config.connection.host, "db.local");
  assert.equal(config.connection.password.reveal(), "from-env-9");
  assert.equal(String(config.connection.password), "***");
  assert.equal(config.guardrails.maxRows, 7);
  assert.equal(config.guardrails.readOnly, true);
  rmSync(dir, { recursive: true, force: true });
});

test("config: missing ${VAR} is a hard error naming the variable", () => {
  const dir = mkdtempSync(join(tmpdir(), "dbmcp-test-"));
  const yamlPath = join(dir, "c.yaml");
  writeFileSync(yamlPath, "connection:\n  password: ${NOT_SET_ANYWHERE}\n");
  assert.throws(() => loadConfig(["--config", yamlPath], {}, { envPrefix: "X" }), /NOT_SET_ANYWHERE/);
  rmSync(dir, { recursive: true, force: true });
});

test("config: password_file wins over env password", () => {
  const dir = mkdtempSync(join(tmpdir(), "dbmcp-test-"));
  const pwPath = join(dir, "pw");
  writeFileSync(pwPath, "file-pw\n");
  const config = loadConfig([], { MYSQL_PASSWORD: "env-pw", MYSQL_PASSWORD_FILE: pwPath }, { envPrefix: "MYSQL" });
  assert.equal(config.connection.password.reveal(), "file-pw");
  rmSync(dir, { recursive: true, force: true });
});

test("config: flag beats file beats env", () => {
  const config = loadConfig(["--dsn", "/from/flag.db"], { SQLITE_PATH: "/from/env.db" }, { envPrefix: "SQLITE", dsnEnvVar: "SQLITE_PATH" });
  assert.equal(config.connection.dsn, "/from/flag.db");
  const config2 = loadConfig([], { SQLITE_PATH: "/from/env.db" }, { envPrefix: "SQLITE", dsnEnvVar: "SQLITE_PATH" });
  assert.equal(config2.connection.dsn, "/from/env.db");
});

test("config: inline DSN password gets registered for redaction", () => {
  loadConfig(["--dsn", "postgres://u:dsn-inline-pw@h/db"], {}, { envPrefix: "PG" });
  assert.equal(redact("log with dsn-inline-pw inside"), "log with *** inside");
});

test("config: transport defaults to stdio, flags select http", () => {
  const a = loadConfig(["--dsn", "/x.db"], {}, { envPrefix: "SQLITE" });
  assert.deepEqual(a.transport, { type: "stdio", port: 8080 });
  const b = loadConfig(["--dsn", "/x.db", "--transport", "http", "--port", "9090"], {}, { envPrefix: "SQLITE" });
  assert.deepEqual(b.transport, { type: "http", port: 9090 });
});

test("sql-guard: read-only and multi-statement classification", () => {
  assert.equal(guardSql("SELECT 1", true), null);
  assert.equal(guardSql("  -- comment\n  select * from t", true), null);
  assert.match(guardSql("DELETE FROM t", true), /^read-only:/);
  assert.match(guardSql("SELECT 1; SELECT 2", true), /^multi-statement:/);
  assert.equal(guardSql("SELECT 'a;b' FROM t", true), null);
  assert.equal(guardSql("DELETE FROM t", false), null);
});
