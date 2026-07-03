import Database from "better-sqlite3";
import {
  QueryTimeoutError,
  UnknownTableError,
  type ColumnInfo,
  type DatabaseAdapter,
  type ForeignKeyInfo,
  type IndexInfo,
  type QueryOptions,
  type QueryResult,
  type TableDescription,
  type TableSummary,
} from "@db-mcp/core";

export interface SqliteAdapterOptions {
  /** File path to the SQLite database, or ":memory:" for an in-memory DB. */
  file: string;
}

/**
 * SQLite family adapter (PRD §7). SQLite is embedded — there is no
 * host/port/user/password, only a file path. Introspection uses
 * `sqlite_master` and `PRAGMA`, never `information_schema`.
 *
 * Note on `timeoutMs`: better-sqlite3 executes statements synchronously and
 * does not expose a way to preempt an in-flight statement. Timeouts are
 * therefore enforced on a best-effort basis: elapsed wall-clock time is
 * checked after the statement completes and a `QueryTimeoutError` is thrown
 * if it was exceeded. This is a known, documented limitation of the
 * synchronous embedded driver, not a gap in the adapter contract.
 */
export class SqliteAdapter implements DatabaseAdapter {
  readonly engine = "sqlite";
  private db: Database.Database | undefined;

  constructor(private readonly options: SqliteAdapterOptions) {}

  async connect(): Promise<void> {
    // Fail fast on bad paths/permissions by opening eagerly.
    this.db = new Database(this.options.file);
    this.db.pragma("journal_mode = WAL");
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  private requireDb(): Database.Database {
    if (!this.db) {
      throw new Error("adapter is not connected; call connect() first");
    }
    return this.db;
  }

  async query(sql: string, options: QueryOptions): Promise<QueryResult> {
    const db = this.requireDb();
    const startedAt = Date.now();

    const stmt = db.prepare(sql);

    let result: QueryResult;
    if (stmt.reader) {
      const rows: Record<string, unknown>[] = [];
      let truncated = false;
      for (const row of stmt.iterate()) {
        if (rows.length >= options.maxRows) {
          truncated = true;
          break;
        }
        rows.push(row as Record<string, unknown>);
      }
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : (stmt.columns?.() ?? []).map((c) => c.name);
      result = { columns, rows, rowCount: rows.length, truncated };
    } else {
      const info = stmt.run();
      result = { columns: [], rows: [], rowCount: info.changes, truncated: false };
    }

    if (Date.now() - startedAt > options.timeoutMs) {
      throw new QueryTimeoutError(`query exceeded ${options.timeoutMs}ms`);
    }

    return result;
  }

  async listTables(): Promise<TableSummary[]> {
    const db = this.requireDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    return tables.map(({ name }) => {
      let estimatedRows: number | null = null;
      try {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as
          | { count: number }
          | undefined;
        estimatedRows = row?.count ?? null;
      } catch {
        estimatedRows = null;
      }
      return { name, estimatedRows };
    });
  }

  async describeTable(table: string): Promise<TableDescription> {
    const db = this.requireDb();

    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!exists) {
      throw new UnknownTableError(table);
    }

    const columnRows = db.prepare(`PRAGMA table_info("${table}")`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];

    const columns: ColumnInfo[] = columnRows.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.notnull === 0,
      key: c.pk > 0 ? "PRIMARY KEY" : null,
      default: c.dflt_value,
    }));

    const indexListRows = db.prepare(`PRAGMA index_list("${table}")`).all() as {
      name: string;
      unique: number;
    }[];

    const indexes: IndexInfo[] = indexListRows.map((idx) => {
      const indexInfoRows = db.prepare(`PRAGMA index_info("${idx.name}")`).all() as {
        name: string;
      }[];
      return {
        name: idx.name,
        columns: indexInfoRows.map((r) => r.name),
        unique: idx.unique === 1,
      };
    });

    const foreignKeyRows = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as {
      id: number;
      table: string;
      from: string;
      to: string;
    }[];

    const foreignKeysById = new Map<number, ForeignKeyInfo & { id: number }>();
    for (const fk of foreignKeyRows) {
      const existing = foreignKeysById.get(fk.id);
      if (existing) {
        existing.columns.push(fk.from);
        existing.referencesColumns.push(fk.to);
      } else {
        foreignKeysById.set(fk.id, {
          id: fk.id,
          name: `fk_${table}_${fk.id}`,
          columns: [fk.from],
          referencesTable: fk.table,
          referencesColumns: [fk.to],
        });
      }
    }

    return {
      name: table,
      columns,
      indexes,
      foreignKeys: [...foreignKeysById.values()].map(({ id, ...fk }) => fk),
    };
  }
}
