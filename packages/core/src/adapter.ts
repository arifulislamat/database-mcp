/**
 * The adapter interface (the seam). Every language defines an equivalent of
 * this interface in its core package. The protocol layer and tools depend
 * ONLY on this interface — never on a concrete database driver.
 *
 * Rules (PRD §7):
 *  - Adapters contain zero MCP types and zero read-only policy (that lives
 *    in the shared SQL guard).
 *  - `query` enforces maxRows and timeoutMs itself (engines differ on how).
 *  - If a requirement turns out to be engine-specific, fix the interface,
 *    never patch around it in a tool.
 */

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string | null;
  default: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencesTable: string;
  referencesColumns: string[];
}

export interface TableSummary {
  name: string;
  estimatedRows: number | null;
}

export interface TableDescription {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface QueryOptions {
  maxRows: number;
  timeoutMs: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

/**
 * Thrown by an adapter when a query exceeds queryTimeoutMs. Tools rely on
 * this type (rather than string sniffing) to build the `timeout:` error.
 */
export class QueryTimeoutError extends Error {
  constructor(message = "query exceeded the configured timeout") {
    super(message);
    this.name = "QueryTimeoutError";
  }
}

/** Thrown by an adapter when describeTable is called with an unknown table. */
export class UnknownTableError extends Error {
  constructor(public readonly table: string) {
    super(`table "${table}" does not exist`);
    this.name = "UnknownTableError";
  }
}

export interface DatabaseAdapter {
  readonly engine: string;

  /** Open the connection/pool; must fail fast on bad credentials. */
  connect(): Promise<void>;

  close(): Promise<void>;

  query(sql: string, options: QueryOptions): Promise<QueryResult>;

  listTables(): Promise<TableSummary[]>;

  describeTable(table: string): Promise<TableDescription>;
}
