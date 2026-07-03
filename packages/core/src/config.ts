import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { DEFAULT_GUARDRAILS, type Guardrails } from "./guardrails.js";

/**
 * Abstraction over "how to reach this database". SQLite needs a file path,
 * libSQL needs a URL + auth token, MySQL/Postgres need host/port/user/
 * password (or a DSN string). Rather than a fixed struct, `dsn` carries the
 * primary connection string/path and `options` carries anything
 * engine-specific. Adapters are responsible for interpreting both.
 */
export interface ConnectionConfig {
  dsn?: string;
  options: Record<string, unknown>;
}

export type TransportConfig =
  | { kind: "stdio" }
  | { kind: "http"; port: number };

export interface ServerConfig {
  connection: ConnectionConfig;
  guardrails: Guardrails;
  transport: TransportConfig;
}

interface ConfigFileShape {
  dsn?: string;
  connection?: Record<string, unknown>;
  allowWrite?: boolean;
  maxRows?: number;
  queryTimeoutMs?: number;
  transport?: "stdio" | "http";
  port?: number;
  [key: string]: unknown;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function readConfigFile(path: string | boolean | undefined): ConfigFileShape {
  if (typeof path !== "string") return {};
  const raw = readFileSync(path, "utf8");
  return (parseYaml(raw) as ConfigFileShape) ?? {};
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    // Accept both word ("true"/"false") and numeric ("1"/"0") forms
    // symmetrically; anything else falls back to the default.
    const normalized = value.toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return fallback;
  }
  return fallback;
}

function toInt(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolves configuration from, highest precedence first:
 *   1. Explicit CLI flags
 *   2. `--config <path>` YAML file
 *   3. Environment variables
 *   4. Defaults (DEFAULT_GUARDRAILS, stdio transport)
 */
export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const flags = parseArgs(argv);
  const fileConfig = readConfigFile(flags["config"]);

  const dsn =
    (typeof flags["dsn"] === "string" ? flags["dsn"] : undefined) ??
    fileConfig.dsn ??
    env["DB_MCP_DSN"];

  const allowWrite = toBool(
    flags["allow-write"] ?? fileConfig.allowWrite ?? env["ALLOW_WRITE"],
    !DEFAULT_GUARDRAILS.readOnly,
  );

  const maxRows = toInt(
    flags["max-rows"] ?? fileConfig.maxRows ?? env["MAX_ROWS"],
    DEFAULT_GUARDRAILS.maxRows,
  );

  const queryTimeoutMs = toInt(
    flags["query-timeout-ms"] ?? fileConfig.queryTimeoutMs ?? env["QUERY_TIMEOUT_MS"],
    DEFAULT_GUARDRAILS.queryTimeoutMs,
  );

  const transportKind =
    (typeof flags["transport"] === "string" ? flags["transport"] : undefined) ??
    fileConfig.transport ??
    env["DB_MCP_TRANSPORT"] ??
    "stdio";

  const port = toInt(flags["port"] ?? fileConfig.port ?? env["DB_MCP_PORT"], 3000);

  const transport: TransportConfig =
    transportKind === "http" ? { kind: "http", port } : { kind: "stdio" };

  return {
    connection: {
      dsn,
      options: fileConfig.connection ?? {},
    },
    guardrails: {
      readOnly: !allowWrite,
      maxRows,
      queryTimeoutMs,
    },
    transport,
  };
}
