export interface Guardrails {
  readOnly: boolean;
  maxRows: number;
  queryTimeoutMs: number;
}

export interface Config {
  /** SQLite: filesystem path to the database. Generalizes per engine. */
  dsn: string;
  guardrails: Guardrails;
}

/**
 * M0.5 config: flags > env > defaults. The full multi-source resolution
 * (--config YAML, ${VAR} expansion, *_FILE secrets) lands in core at M1.5.
 */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const dsn = flag("--dsn") ?? env.SQLITE_PATH;
  if (!dsn) {
    throw new Error("config: no database given — pass --dsn /path/to.db or set SQLITE_PATH");
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
