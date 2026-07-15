import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { Secret, redact, registerSecret } from "./secret.js";

export interface Guardrails {
  readOnly: boolean;
  maxRows: number;
  queryTimeoutMs: number;
}

/** General enough for a SQLite file path AND a networked engine. */
export interface Connection {
  /** Engine URI or file path. Inline credentials are discouraged. */
  dsn?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: Secret;
  database?: string;
}

export interface TransportConfig {
  type: "stdio" | "http";
  /** http only; the server binds 127.0.0.1. */
  port: number;
}

export interface Config {
  connection: Connection;
  guardrails: Guardrails;
  transport: TransportConfig;
}

export interface ConfigOptions {
  /** Discrete env var prefix: "MYSQL" reads MYSQL_HOST, MYSQL_PASSWORD, ... */
  envPrefix: string;
  /** Engine-specific env var for the connection target, e.g. SQLITE_PATH. */
  dsnEnvVar?: string;
  /**
   * Env var for the secret when the engine doesn't call it a password,
   * e.g. LIBSQL_AUTH_TOKEN. Defaults to <envPrefix>_PASSWORD. The *_FILE
   * variant is derived from it either way.
   */
  passwordEnvVar?: string;
}

/** ${VAR} in YAML string values resolves from the environment at load time. */
function expand(value: string, env: NodeJS.ProcessEnv, path: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const v = env[name];
    if (v === undefined) {
      throw new Error(`config: \${${name}} referenced at '${path}' but the environment variable is not set`);
    }
    return v;
  });
}

function expandDeep(node: unknown, env: NodeJS.ProcessEnv, path = ""): unknown {
  if (typeof node === "string") return expand(node, env, path);
  if (Array.isArray(node)) return node.map((v, i) => expandDeep(v, env, `${path}[${i}]`));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, expandDeep(v, env, path ? `${path}.${k}` : k)]),
    );
  }
  return node;
}

/**
 * Multi-source resolution, highest precedence first:
 *   1. flags (--dsn, --allow-write, --max-rows, --query-timeout-ms)
 *   2. --config <path.yaml> (or DB_MCP_CONFIG), with ${VAR} expansion
 *   3. discrete env vars (<PREFIX>_HOST, ..., plus *_FILE variants)
 *   4. defaults
 * Password specifically: password_file / *_PASSWORD_FILE > password / *_PASSWORD.
 * The password is a Secret the moment it is read.
 */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv, opts: ConfigOptions): Config {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const configPath = flag("--config") ?? env.DB_MCP_CONFIG;
  const file = configPath
    ? (expandDeep(parseYaml(readFileSync(configPath, "utf8")), env) as Record<string, Record<string, unknown>>)
    : {};
  const fc = (file.connection ?? {}) as Record<string, string | number | undefined>;
  const fg = (file.guardrails ?? {}) as Record<string, unknown>;
  const ft = (file.transport ?? {}) as Record<string, string | number | undefined>;
  const P = opts.envPrefix;

  const pwVar = opts.passwordEnvVar ?? `${P}_PASSWORD`;
  const passwordFile = (fc.password_file as string | undefined) ?? env[`${pwVar}_FILE`];
  const rawPassword = passwordFile
    ? readFileSync(passwordFile, "utf8").trim()
    : ((fc.password as string | undefined) ?? env[pwVar]);

  const dsn = flag("--dsn") ?? (fc.dsn as string | undefined) ?? (opts.dsnEnvVar ? env[opts.dsnEnvVar] : undefined) ?? env[`${P}_DSN`];
  // Inline DSN credentials are discouraged but must never leak: register them.
  if (dsn) {
    try {
      const parsed = new URL(dsn);
      if (parsed.password) registerSecret(decodeURIComponent(parsed.password));
    } catch {
      /* not a URL (e.g. a file path) */
    }
  }

  const num = (v: unknown): number | undefined => (v === undefined ? undefined : Number(v));

  const config: Config = {
    connection: {
      dsn,
      host: (fc.host as string | undefined) ?? env[`${P}_HOST`],
      port: num(fc.port ?? env[`${P}_PORT`]),
      user: (fc.user as string | undefined) ?? env[`${P}_USER`],
      password: rawPassword ? new Secret(rawPassword) : undefined,
      database: (fc.database as string | undefined) ?? env[`${P}_DATABASE`],
    },
    guardrails: {
      readOnly: argv.includes("--allow-write")
        ? false
        : typeof fg.readOnly === "boolean"
          ? fg.readOnly
          : env.ALLOW_WRITE !== undefined
            ? env.ALLOW_WRITE !== "true"
            : true,
      maxRows: Number(flag("--max-rows") ?? fg.maxRows ?? env.MAX_ROWS ?? 1000),
      queryTimeoutMs: Number(flag("--query-timeout-ms") ?? fg.queryTimeoutMs ?? env.QUERY_TIMEOUT_MS ?? 30000),
    },
    transport: {
      type: (flag("--transport") ?? ft.type ?? "stdio") as "stdio" | "http",
      port: Number(flag("--port") ?? ft.port ?? 8080),
    },
  };

  // Debug aid. Secret.toJSON handles the password field; redact() masks
  // DSN-embedded credentials, which are plain strings (issue #18) — this
  // print happens before serve() installs the stderr filter, and goes to
  // stdout anyway.
  if (argv.includes("--print-config")) {
    console.log(redact(JSON.stringify(config, null, 2)));
    process.exit(0);
  }

  return config;
}
