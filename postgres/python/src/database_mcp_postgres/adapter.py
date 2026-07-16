"""PostgreSQL adapter over psycopg. Zero MCP types."""

import datetime
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

from database_mcp_core import Connection

_JS_SAFE_MAX = 2**53 - 1


def _json_safe(value: Any) -> Any:
    """BIGINT/NUMERIC beyond JS safe range and temporal types become strings."""
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > _JS_SAFE_MAX:
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, (datetime.timedelta, bytes)):
        return str(value)
    return value


class PostgresAdapter:
    engine = "postgres"

    def __init__(self, connection: Connection, query_timeout_ms: int) -> None:
        self._connection = connection
        self._timeout_ms = query_timeout_ms
        self._db: psycopg.Connection | None = None

    def connect(self, *, read_only: bool) -> None:
        c = self._connection
        # Server-side per-statement timeout is the timeout guardrail. Layer
        # two: a startup parameter makes the session read-only at the server,
        # catching what the SQL guard can't see (CTE-smuggled writes).
        # Startup param instead of a SET on connect: no race, applies before
        # the first query.
        options = f"-c statement_timeout={self._timeout_ms}"
        if read_only:
            options += " -c default_transaction_read_only=on"
        kwargs: dict[str, Any] = {"options": options, "autocommit": True, "row_factory": dict_row}
        if c.dsn:
            self._db = psycopg.connect(c.dsn, **kwargs)
        else:
            # psycopg also honors libpq's native PGHOST/PGUSER/... env vars
            # for anything not given explicitly.
            self._db = psycopg.connect(
                host=c.host,
                port=c.port,
                user=c.user,
                password=c.password.reveal() if c.password else None,
                dbname=c.database,
                **kwargs,
            )
        # ponytail: one connection, queries serialized; a pool if it matters.
        self._db.execute("SELECT 1")  # fail fast on bad host/credentials

    def close(self) -> None:
        if self._db is not None:
            self._db.close()

    def _all(self, sql: str, args: tuple = ()) -> list[dict[str, Any]]:
        assert self._db is not None
        return self._db.execute(sql, args or None).fetchall()

    def query(self, sql: str, *, max_rows: int, timeout_ms: int) -> dict[str, Any]:
        assert self._db is not None
        cur = self._db.execute(sql)
        if cur.description is None:
            return {"columns": [], "rows": [], "rowCount": max(cur.rowcount, 0), "truncated": False}
        columns = [d.name for d in cur.description]
        # ponytail: rows buffer before the cap; server-side cursors if huge
        # tables matter.
        fetched = cur.fetchmany(max_rows + 1)
        truncated = len(fetched) > max_rows
        rows = [{k: _json_safe(v) for k, v in r.items()} for r in fetched[:max_rows]]
        return {"columns": columns, "rows": rows, "rowCount": len(rows), "truncated": truncated}

    def list_tables(self) -> list[dict[str, Any]]:
        rows = self._all(
            """SELECT c.relname AS name, c.reltuples::bigint AS estimated
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'r' AND n.nspname = current_schema()
                ORDER BY c.relname"""
        )
        # reltuples is -1 before the first VACUUM/ANALYZE.
        return [{"name": r["name"], "estimatedRows": max(0, r["estimated"])} for r in rows]

    def describe_table(self, table: str) -> dict[str, Any]:
        cols = self._all(
            """SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
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
                WHERE c.table_schema = current_schema() AND c.table_name = %s
                ORDER BY c.ordinal_position""",
            (table,),
        )
        if not cols:
            raise LookupError(f"unknown table: {table}")

        columns = [
            {
                "name": c["column_name"],
                "type": c["data_type"],
                "nullable": c["is_nullable"] == "YES",
                "key": "PRI" if c["is_pk"] else None,
                "default": c["column_default"],
            }
            for c in cols
        ]

        by_index: dict[str, dict[str, Any]] = {}
        for r in self._all(
            """SELECT i.relname AS name, ix.indisunique AS is_unique, a.attname AS col
                 FROM pg_class t
                 JOIN pg_index ix ON t.oid = ix.indrelid
                 JOIN pg_class i ON i.oid = ix.indexrelid
                 JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                WHERE t.relname = %s
                  AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
                ORDER BY i.relname, k.ord""",
            (table,),
        ):
            entry = by_index.setdefault(r["name"], {"name": r["name"], "columns": [], "unique": r["is_unique"]})
            entry["columns"].append(r["col"])

        by_fk: dict[str, dict[str, Any]] = {}
        for r in self._all(
            """SELECT tc.constraint_name, kcu.column_name,
                      ccu.table_name AS ref_table, ccu.column_name AS ref_column
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
                 JOIN information_schema.constraint_column_usage ccu
                   ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_schema = current_schema() AND tc.table_name = %s
                ORDER BY tc.constraint_name, kcu.ordinal_position""",
            (table,),
        ):
            entry = by_fk.setdefault(
                r["constraint_name"],
                {
                    "name": r["constraint_name"],
                    "columns": [],
                    "referencesTable": r["ref_table"],
                    "referencesColumns": [],
                },
            )
            entry["columns"].append(r["column_name"])
            entry["referencesColumns"].append(r["ref_column"])

        return {
            "name": table,
            "columns": columns,
            "indexes": list(by_index.values()),
            "foreignKeys": list(by_fk.values()),
        }
