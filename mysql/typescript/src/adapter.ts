import mysql from "mysql2/promise";
import type {
  DatabaseAdapter,
  QueryOptions,
  QueryResult,
  TableSummary,
  TableDescription,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  Connection,
} from "@database-mcp/core";

export class MysqlAdapter implements DatabaseAdapter {
  engine = "mysql";
  private pool!: mysql.Pool;

  constructor(private connection: Connection) {}

  async connect({ readOnly }: { readOnly: boolean }): Promise<void> {
    const c = this.connection;
    const common = {
      connectionLimit: 4,
      // BIGINT/DECIMAL beyond JS safe range arrive as strings (JSON-safe).
      supportBigNumbers: true,
      bigNumberStrings: false,
    };
    this.pool = c.dsn
      ? mysql.createPool({ uri: c.dsn, ...common })
      : mysql.createPool({
          host: c.host ?? "127.0.0.1",
          port: c.port ?? 3306,
          user: c.user,
          password: c.password?.reveal(),
          database: c.database,
          ...common,
        });
    if (readOnly) {
      // Layer two: every pooled session rejects writes at the server,
      // catching what the SQL guard can't see (CTE-smuggled writes etc.).
      this.pool.on("connection", (conn) => {
        conn.query("SET SESSION TRANSACTION READ ONLY");
      });
    }
    await this.pool.query("SELECT 1"); // fail fast on bad host/credentials
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query(sql: string, { maxRows, timeoutMs }: QueryOptions): Promise<QueryResult> {
    // ponytail: rows are fetched then capped — a SELECT over a huge table
    // buffers before slicing; switch to mysql2's .stream() if it matters.
    const [result, fields] = await this.pool.query({ sql, timeout: timeoutMs });
    if (!Array.isArray(result)) {
      return { columns: [], rows: [], rowCount: result.affectedRows ?? 0, truncated: false };
    }
    const columns = (fields ?? []).map((f) => f.name);
    const truncated = result.length > maxRows;
    const rows = (result as Record<string, unknown>[]).slice(0, maxRows);
    return { columns, rows, rowCount: rows.length, truncated };
  }

  async listTables(): Promise<TableSummary[]> {
    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS estimatedRows
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME`,
    );
    return (rows as { name: string; estimatedRows: unknown }[]).map((r) => ({
      name: r.name,
      estimatedRows: Number(r.estimatedRows ?? 0),
    }));
  }

  async describeTable(table: string): Promise<TableDescription> {
    const [cols] = await this.pool.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [table],
    );
    const colRows = cols as {
      COLUMN_NAME: string;
      COLUMN_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_KEY: string;
      COLUMN_DEFAULT: string | null;
    }[];
    if (colRows.length === 0) throw new Error(`unknown table: ${table}`);

    const columns: ColumnInfo[] = colRows.map((c) => ({
      name: c.COLUMN_NAME,
      type: c.COLUMN_TYPE,
      nullable: c.IS_NULLABLE === "YES",
      key: c.COLUMN_KEY || null,
      default: c.COLUMN_DEFAULT,
    }));

    const [idx] = await this.pool.query(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [table],
    );
    const byIndex = new Map<string, IndexInfo>();
    for (const r of idx as { INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number }[]) {
      const entry = byIndex.get(r.INDEX_NAME) ?? { name: r.INDEX_NAME, columns: [], unique: !r.NON_UNIQUE };
      entry.columns.push(r.COLUMN_NAME);
      byIndex.set(r.INDEX_NAME, entry);
    }

    const [fks] = await this.pool.query(
      `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
      [table],
    );
    const byFk = new Map<string, ForeignKeyInfo>();
    for (const r of fks as {
      CONSTRAINT_NAME: string;
      COLUMN_NAME: string;
      REFERENCED_TABLE_NAME: string;
      REFERENCED_COLUMN_NAME: string;
    }[]) {
      const entry = byFk.get(r.CONSTRAINT_NAME) ?? {
        name: r.CONSTRAINT_NAME,
        columns: [],
        referencesTable: r.REFERENCED_TABLE_NAME,
        referencesColumns: [],
      };
      entry.columns.push(r.COLUMN_NAME);
      entry.referencesColumns.push(r.REFERENCED_COLUMN_NAME);
      byFk.set(r.CONSTRAINT_NAME, entry);
    }

    return { name: table, columns, indexes: [...byIndex.values()], foreignKeys: [...byFk.values()] };
  }
}
