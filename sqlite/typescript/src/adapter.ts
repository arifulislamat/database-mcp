import Database from "better-sqlite3";
import type {
  DatabaseAdapter,
  QueryOptions,
  QueryResult,
  TableSummary,
  TableDescription,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
} from "@database-mcp/core";

/** BIGINTs beyond Number.MAX_SAFE_INTEGER are returned as strings (JSON-safe). */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
      ? Number(value)
      : value.toString();
  }
  return value;
}

export class SqliteAdapter implements DatabaseAdapter {
  engine = "sqlite";
  private db!: Database.Database;

  constructor(private path: string) {}

  async connect({ readOnly }: { readOnly: boolean }): Promise<void> {
    // readonly opens the file read-only at the OS level; query_only makes the
    // session reject writes too. Layer-two enforcement per the tool contract.
    this.db = new Database(this.path, { readonly: readOnly, fileMustExist: true });
    if (readOnly) this.db.pragma("query_only = ON");
    this.db.defaultSafeIntegers(true);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async query(sql: string, { maxRows, timeoutMs }: QueryOptions): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    if (!stmt.reader) {
      const info = stmt.run();
      return { columns: [], rows: [], rowCount: Number(info.changes), truncated: false };
    }
    const columns = stmt.columns().map((c) => c.name);
    const deadline = Date.now() + timeoutMs;
    const rows: Record<string, unknown>[] = [];
    let truncated = false;
    // ponytail: deadline is checked between rows — a single slow aggregate
    // can't be interrupted (better-sqlite3 is sync, no interrupt API); move
    // queries to a worker thread if that ever matters.
    for (const row of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
      if (Date.now() > deadline) {
        throw new Error(`timeout: query exceeded ${timeoutMs}ms`);
      }
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      const out: Record<string, unknown> = {};
      for (const col of columns) out[col] = jsonSafe(row[col]);
      rows.push(out);
    }
    return { columns, rows, rowCount: rows.length, truncated };
  }

  async listTables(): Promise<TableSummary[]> {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    return tables.map(({ name }) => {
      const { n } = this.db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: bigint };
      return { name, estimatedRows: Number(n) };
    });
  }

  async describeTable(table: string): Promise<TableDescription> {
    const cols = this.db.prepare("SELECT * FROM pragma_table_info(?)").all(table) as {
      name: string;
      type: string;
      notnull: bigint;
      dflt_value: string | null;
      pk: bigint;
    }[];
    if (cols.length === 0) throw new Error(`unknown table: ${table}`);

    const columns: ColumnInfo[] = cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: !c.notnull,
      key: c.pk ? "PRI" : null,
      default: c.dflt_value === null ? null : String(c.dflt_value),
    }));

    const indexList = this.db.prepare("SELECT * FROM pragma_index_list(?)").all(table) as {
      name: string;
      unique: bigint;
    }[];
    const indexes: IndexInfo[] = indexList.map((ix) => ({
      name: ix.name,
      columns: (this.db.prepare("SELECT name FROM pragma_index_info(?)").all(ix.name) as { name: string }[]).map(
        (c) => c.name,
      ),
      unique: !!ix.unique,
    }));

    const fkRows = this.db.prepare("SELECT * FROM pragma_foreign_key_list(?)").all(table) as {
      id: bigint;
      table: string;
      from: string;
      to: string;
    }[];
    const fkById = new Map<string, ForeignKeyInfo>();
    for (const fk of fkRows) {
      const key = String(fk.id);
      const entry = fkById.get(key) ?? {
        name: `fk_${table}_${key}`, // SQLite FKs are unnamed; synthesize a stable one
        columns: [],
        referencesTable: fk.table,
        referencesColumns: [],
      };
      entry.columns.push(fk.from);
      entry.referencesColumns.push(fk.to);
      fkById.set(key, entry);
    }

    return { name: table, columns, indexes, foreignKeys: [...fkById.values()] };
  }
}
