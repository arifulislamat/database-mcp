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

export interface TableSummary {
  name: string;
  estimatedRows: number;
}

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

export interface TableDescription {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

/**
 * The seam between the engine-agnostic protocol layer and a database driver.
 * Adapters contain zero MCP types. When readOnly is set, the adapter must
 * enforce it at the connection/session level (the SQL guard is only layer one).
 */
export interface DatabaseAdapter {
  engine: string;
  connect(opts: { readOnly: boolean }): Promise<void>;
  close(): Promise<void>;
  query(sql: string, opts: QueryOptions): Promise<QueryResult>;
  listTables(): Promise<TableSummary[]>;
  describeTable(table: string): Promise<TableDescription>;
}
