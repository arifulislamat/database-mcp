import pg from "pg";
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

export class PostgresAdapter implements DatabaseAdapter {
  engine = "postgres";
  private pool!: pg.Pool;

  constructor(
    private connection: Connection,
    private queryTimeoutMs: number,
  ) {}

  async connect({ readOnly }: { readOnly: boolean }): Promise<void> {
    const c = this.connection;
    this.pool = new pg.Pool({
      ...(c.dsn ? { connectionString: c.dsn } : {}),
      host: c.dsn ? undefined : c.host,
      port: c.dsn ? undefined : c.port,
      user: c.dsn ? undefined : c.user,
      password: c.dsn ? undefined : c.password?.reveal(),
      database: c.dsn ? undefined : c.database,
      max: 4,
      // Server-side per-statement timeout — the timeout guardrail.
      statement_timeout: this.queryTimeoutMs,
      // Layer two: a startup parameter makes every session read-only at the
      // server, catching what the SQL guard can't see (CTE-smuggled writes).
      // Startup param instead of a SET on connect: no race, applies before
      // the first query.
      ...(readOnly ? { options: "-c default_transaction_read_only=on" } : {}),
    });
    await this.pool.query("SELECT 1"); // fail fast on bad host/credentials
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query(sql: string, { maxRows }: QueryOptions): Promise<QueryResult> {
    // pg returns BIGINT/NUMERIC as strings by default — already JSON-safe.
    // ponytail: rows buffer before the cap; pg-cursor if huge tables matter.
    const result = await this.pool.query(sql);
    if (!result.fields?.length) {
      return { columns: [], rows: [], rowCount: result.rowCount ?? 0, truncated: false };
    }
    const columns = result.fields.map((f) => f.name);
    const truncated = result.rows.length > maxRows;
    const rows = (result.rows as Record<string, unknown>[]).slice(0, maxRows);
    return { columns, rows, rowCount: rows.length, truncated };
  }

  async listTables(): Promise<TableSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT c.relname AS name, c.reltuples::bigint AS estimated
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = current_schema()
        ORDER BY c.relname`,
    );
    // reltuples is -1 before the first VACUUM/ANALYZE.
    return rows.map((r: { name: string; estimated: string }) => ({
      name: r.name,
      estimatedRows: Math.max(0, Number(r.estimated)),
    }));
  }

  async describeTable(table: string): Promise<TableDescription> {
    const { rows: cols } = await this.pool.query(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
              EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu
                    ON kcu.constraint_name = tc.constraint_name
                   AND kcu.table_schema = tc.table_schema
                 WHERE tc.constraint_type = 'PRIMARY KEY'
                   AND tc.table_schema = c.table_schema
                   AND tc.table_name = c.table_name
                   AND kcu.column_name = c.column_name
              ) AS is_pk
         FROM information_schema.columns c
        WHERE c.table_schema = current_schema() AND c.table_name = $1
        ORDER BY c.ordinal_position`,
      [table],
    );
    if (cols.length === 0) throw new Error(`unknown table: ${table}`);

    const columns: ColumnInfo[] = cols.map(
      (c: { column_name: string; data_type: string; is_nullable: string; column_default: string | null; is_pk: boolean }) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === "YES",
        key: c.is_pk ? "PRI" : null,
        default: c.column_default,
      }),
    );

    const { rows: idx } = await this.pool.query(
      `SELECT i.relname AS name, ix.indisunique AS is_unique, a.attname AS col
         FROM pg_class t
         JOIN pg_index ix ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE t.relname = $1
          AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
        ORDER BY i.relname, k.ord`,
      [table],
    );
    const byIndex = new Map<string, IndexInfo>();
    for (const r of idx as { name: string; is_unique: boolean; col: string }[]) {
      const entry = byIndex.get(r.name) ?? { name: r.name, columns: [], unique: r.is_unique };
      entry.columns.push(r.col);
      byIndex.set(r.name, entry);
    }

    const { rows: fks } = await this.pool.query(
      `SELECT tc.constraint_name, kcu.column_name,
              ccu.table_name AS ref_table, ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = current_schema() AND tc.table_name = $1
        ORDER BY tc.constraint_name, kcu.ordinal_position`,
      [table],
    );
    const byFk = new Map<string, ForeignKeyInfo>();
    for (const r of fks as { constraint_name: string; column_name: string; ref_table: string; ref_column: string }[]) {
      const entry = byFk.get(r.constraint_name) ?? {
        name: r.constraint_name,
        columns: [],
        referencesTable: r.ref_table,
        referencesColumns: [],
      };
      entry.columns.push(r.column_name);
      entry.referencesColumns.push(r.ref_column);
      byFk.set(r.constraint_name, entry);
    }

    return { name: table, columns, indexes: [...byIndex.values()], foreignKeys: [...byFk.values()] };
  }
}
