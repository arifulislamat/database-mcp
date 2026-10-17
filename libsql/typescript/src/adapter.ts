import { createClient, type Client, type Row } from "@libsql/client";
import type {
  DatabaseAdapter,
  QueryOptions,
  QueryResult,
  TableSummary,
  TableDescription,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  Secret,
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

/**
 * libSQL is a SQLite fork: catalog queries are identical to the SQLite
 * adapter's. What differs is the transport — @libsql/client speaks to local
 * files (file:) and remote servers (libsql:/https:) with an auth token.
 */
export class LibsqlAdapter implements DatabaseAdapter {
  engine = "libsql";
  private client!: Client;
  private remoteReadOnly = false;

  constructor(
    private url: string,
    private authToken?: Secret,
  ) {}

  async connect({ readOnly }: { readOnly: boolean }): Promise<void> {
    // A plain filesystem path is accepted for parity with @database-mcp/sqlite.
    const url = /^[a-z][a-z0-9+.-]*:/i.test(this.url) ? this.url : `file:${this.url}`;
    this.client = createClient({
      url,
      authToken: this.authToken?.reveal(),
      intMode: "bigint",
    });
    // Remote: every execute() opens and closes its own stream, so a session
    // pragma never reaches the next query. Each query runs in a read-only
    // transaction instead (see query()).
    this.remoteReadOnly = readOnly && !url.startsWith("file:");
    if (readOnly && !this.remoteReadOnly) await this.client.execute("PRAGMA query_only = ON");
    // Fail fast on bad URL/credentials.
    await this.client.execute("SELECT 1");
  }

  async close(): Promise<void> {
    this.client.close();
  }

  async query(sql: string, { maxRows, timeoutMs }: QueryOptions): Promise<QueryResult> {
    // Remote: deadline via Promise.race; the HTTP request is abandoned, not
    // cancelled (per-request AbortSignal if it ever matters). Local files run
    // under IsolatedAdapter instead, since a synchronous statement blocks
    // this timer (issue #38).
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: query exceeded ${timeoutMs}ms`)), timeoutMs).unref(),
    );
    const run = this.remoteReadOnly
      ? this.client.batch([sql], "read").then(([rs]) => rs)
      : this.client.execute(sql);
    const rs = await Promise.race([run, timeout]);

    if (rs.columns.length === 0) {
      return { columns: [], rows: [], rowCount: Number(rs.rowsAffected), truncated: false };
    }
    const truncated = rs.rows.length > maxRows;
    const rows = rs.rows.slice(0, maxRows).map((row: Row) => {
      const out: Record<string, unknown> = {};
      for (const col of rs.columns) out[col] = jsonSafe(row[col]);
      return out;
    });
    return { columns: [...rs.columns], rows, rowCount: rows.length, truncated };
  }

  async listTables(): Promise<TableSummary[]> {
    const tables = await this.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const out: TableSummary[] = [];
    for (const row of tables.rows) {
      const name = String(row.name);
      const count = await this.client.execute(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`);
      out.push({ name, estimatedRows: Number(count.rows[0].n) });
    }
    return out;
  }

  async describeTable(table: string): Promise<TableDescription> {
    const cols = await this.client.execute({ sql: "SELECT * FROM pragma_table_info(?)", args: [table] });
    if (cols.rows.length === 0) throw new Error(`unknown table: ${table}`);

    const columns: ColumnInfo[] = cols.rows.map((c) => ({
      name: String(c.name),
      type: String(c.type),
      nullable: !Number(c.notnull),
      key: Number(c.pk) ? "PRI" : null,
      default: c.dflt_value === null ? null : String(c.dflt_value),
    }));

    const indexList = await this.client.execute({ sql: "SELECT * FROM pragma_index_list(?)", args: [table] });
    const indexes: IndexInfo[] = [];
    for (const ix of indexList.rows) {
      const info = await this.client.execute({ sql: "SELECT name FROM pragma_index_info(?)", args: [String(ix.name)] });
      indexes.push({
        name: String(ix.name),
        columns: info.rows.map((c) => String(c.name)),
        unique: !!Number(ix.unique),
      });
    }

    const fkRows = await this.client.execute({ sql: "SELECT * FROM pragma_foreign_key_list(?)", args: [table] });
    const fkById = new Map<string, ForeignKeyInfo>();
    for (const fk of fkRows.rows) {
      const key = String(fk.id);
      const entry = fkById.get(key) ?? {
        name: `fk_${table}_${key}`, // SQLite-family FKs are unnamed; synthesize a stable one
        columns: [],
        referencesTable: String(fk.table),
        referencesColumns: [],
      };
      entry.columns.push(String(fk.from));
      entry.referencesColumns.push(String(fk.to));
      fkById.set(key, entry);
    }

    return { name: table, columns, indexes, foreignKeys: [...fkById.values()] };
  }
}
