export interface Guardrails {
  readOnly: boolean;
  maxRows: number;
  queryTimeoutMs: number;
}

export interface Config {
  /** How to reach the database: a file path (SQLite), URL, or DSN. */
  dsn: string;
  guardrails: Guardrails;
}

export interface ConfigOptions {
  /** Engine-specific env var for the connection target, e.g. SQLITE_PATH. */
  dsnEnvVar: string;
}

/**
 * M1 config: flags > env > defaults. The full multi-source resolution
 * (--config YAML, ${VAR} expansion, *_FILE secrets) lands at M1.5.
 */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv, opts: ConfigOptions): Config {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const dsn = flag("--dsn") ?? env[opts.dsnEnvVar];
  if (!dsn) {
    throw new Error(`config: no database given — pass --dsn <target> or set ${opts.dsnEnvVar}`);
  }

  return {
    dsn,
    guardrails: {
      readOnly: !(argv.includes("--allow-write") || env.ALLOW_WRITE === "true"),
      maxRows: Number(flag("--max-rows") ?? env.MAX_ROWS ?? 1000),
      queryTimeoutMs: Number(flag("--query-timeout-ms") ?? env.QUERY_TIMEOUT_MS ?? 30000),
    },
  };
}
