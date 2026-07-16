"""MySQL adapter over PyMySQL. Zero MCP types.

MariaDB shares the wire protocol and this adapter; database-mcp-mariadb
subclasses MysqlAdapter and overrides only the engine label.
"""

import datetime
from decimal import Decimal
from typing import Any
from urllib.parse import unquote, urlsplit

import pymysql
import pymysql.cursors

from database_mcp_core import Connection

_JS_SAFE_MAX = 2**53 - 1


def _json_safe(value: Any) -> Any:
    """BIGINT/DECIMAL beyond JS safe range and temporal types become strings."""
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > _JS_SAFE_MAX:
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, (datetime.timedelta, bytes)):
        return str(value)
    return value


class MysqlAdapter:
    engine = "mysql"

    def __init__(self, connection: Connection, query_timeout_ms: int) -> None:
        self._connection = connection
        self._timeout_ms = query_timeout_ms
        self._db: pymysql.Connection | None = None

    def connect(self, *, read_only: bool) -> None:
        c = self._connection
        if c.dsn:
            u = urlsplit(c.dsn)
            kwargs: dict[str, Any] = {
                "host": u.hostname or "127.0.0.1",
                "port": u.port or 3306,
                "user": unquote(u.username) if u.username else None,
                "password": unquote(u.password) if u.password else "",
                "database": u.path.lstrip("/") or None,
            }
        else:
            kwargs = {
                "host": c.host or "127.0.0.1",
                "port": c.port or 3306,
                "user": c.user,
                "password": c.password.reveal() if c.password else "",
                "database": c.database,
            }
        # ponytail: one connection, queries serialized; read_timeout is the
        # whole-query deadline (PyMySQL has no per-query timeout). Pool +
        # per-query timeouts if concurrency ever matters.
        self._db = pymysql.connect(
            **kwargs,
            autocommit=True,
            read_timeout=max(1, round(self._timeout_ms / 1000)),
            cursorclass=pymysql.cursors.DictCursor,
        )
        if read_only:
            # Layer two: the session rejects writes at the server, catching
            # what the SQL guard can't see (CTE-smuggled writes etc.).
            self._db.query("SET SESSION TRANSACTION READ ONLY")

    def close(self) -> None:
        if self._db is not None:
            self._db.close()

    def _all(self, sql: str, args: tuple = ()) -> list[dict[str, Any]]:
        assert self._db is not None
        with self._db.cursor() as cur:
            cur.execute(sql, args or None)
            return cur.fetchall()

    def query(self, sql: str, *, max_rows: int, timeout_ms: int) -> dict[str, Any]:
        assert self._db is not None
        with self._db.cursor() as cur:
            cur.execute(sql)
            if cur.description is None:
                return {"columns": [], "rows": [], "rowCount": max(cur.rowcount, 0), "truncated": False}
            columns = [d[0] for d in cur.description]
            # ponytail: rows are fetched then capped; a SELECT over a huge
            # table buffers before slicing. SSCursor streaming if it matters.
            fetched = cur.fetchmany(max_rows + 1)
            truncated = len(fetched) > max_rows
            rows = [{k: _json_safe(v) for k, v in r.items()} for r in fetched[:max_rows]]
            return {"columns": columns, "rows": rows, "rowCount": len(rows), "truncated": truncated}

    def list_tables(self) -> list[dict[str, Any]]:
        rows = self._all(
            """SELECT TABLE_NAME AS name, TABLE_ROWS AS estimatedRows
                 FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME"""
        )
        return [{"name": r["name"], "estimatedRows": int(r["estimatedRows"] or 0)} for r in rows]

    def describe_table(self, table: str) -> dict[str, Any]:
        cols = self._all(
            """SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
                 FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION""",
            (table,),
        )
        if not cols:
            raise LookupError(f"unknown table: {table}")

        columns = [
            {
                "name": c["COLUMN_NAME"],
                "type": _json_safe(c["COLUMN_TYPE"]),
                "nullable": c["IS_NULLABLE"] == "YES",
                "key": c["COLUMN_KEY"] or None,
                "default": None if c["COLUMN_DEFAULT"] is None else str(c["COLUMN_DEFAULT"]),
            }
            for c in cols
        ]

        by_index: dict[str, dict[str, Any]] = {}
        for r in self._all(
            """SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
                 FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
                ORDER BY INDEX_NAME, SEQ_IN_INDEX""",
            (table,),
        ):
            entry = by_index.setdefault(
                r["INDEX_NAME"], {"name": r["INDEX_NAME"], "columns": [], "unique": not r["NON_UNIQUE"]}
            )
            entry["columns"].append(r["COLUMN_NAME"])

        by_fk: dict[str, dict[str, Any]] = {}
        for r in self._all(
            """SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                 FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
                  AND REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION""",
            (table,),
        ):
            entry = by_fk.setdefault(
                r["CONSTRAINT_NAME"],
                {
                    "name": r["CONSTRAINT_NAME"],
                    "columns": [],
                    "referencesTable": r["REFERENCED_TABLE_NAME"],
                    "referencesColumns": [],
                },
            )
            entry["columns"].append(r["COLUMN_NAME"])
            entry["referencesColumns"].append(r["REFERENCED_COLUMN_NAME"])

        return {
            "name": table,
            "columns": columns,
            "indexes": list(by_index.values()),
            "foreignKeys": list(by_fk.values()),
        }
