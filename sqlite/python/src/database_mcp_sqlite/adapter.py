"""SQLite adapter over the stdlib sqlite3 driver. Zero MCP types."""

import sqlite3
import time
from typing import Any
from urllib.parse import quote

_JS_SAFE_MAX = 2**53 - 1


def _json_safe(value: Any) -> Any:
    """Integers beyond the JS safe range are returned as strings (JSON-safe)."""
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > _JS_SAFE_MAX:
        return str(value)
    return value


class SqliteAdapter:
    engine = "sqlite"

    def __init__(self, path: str) -> None:
        self._path = path
        self._db: sqlite3.Connection | None = None

    def connect(self, *, read_only: bool) -> None:
        # mode=ro opens the file read-only at the OS level; query_only makes
        # the session reject writes too. Layer-two enforcement per the tool
        # contract. mode=rw (not rwc) mirrors fileMustExist in the TS line.
        mode = "ro" if read_only else "rw"
        self._db = sqlite3.connect(
            f"file:{quote(self._path)}?mode={mode}", uri=True, check_same_thread=False
        )
        self._db.row_factory = sqlite3.Row
        if read_only:
            self._db.execute("PRAGMA query_only = ON")

    def close(self) -> None:
        if self._db is not None:
            self._db.close()

    def query(self, sql: str, *, max_rows: int, timeout_ms: int) -> dict[str, Any]:
        assert self._db is not None
        cur = self._db.execute(sql)
        if cur.description is None:
            self._db.commit()
            return {"columns": [], "rows": [], "rowCount": max(cur.rowcount, 0), "truncated": False}
        columns = [d[0] for d in cur.description]
        deadline = time.monotonic() + timeout_ms / 1000
        rows: list[dict[str, Any]] = []
        truncated = False
        # ponytail: deadline is checked between rows; a single slow aggregate
        # can't be interrupted this way. set_progress_handler is the upgrade
        # path if that ever matters.
        for raw in cur:
            if time.monotonic() > deadline:
                raise RuntimeError(f"timeout: query exceeded {timeout_ms}ms")
            if len(rows) >= max_rows:
                truncated = True
                break
            rows.append({c: _json_safe(v) for c, v in zip(columns, raw)})
        return {"columns": columns, "rows": rows, "rowCount": len(rows), "truncated": truncated}

    def list_tables(self) -> list[dict[str, Any]]:
        assert self._db is not None
        names = [
            r["name"]
            for r in self._db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        out = []
        for name in names:
            quoted = name.replace('"', '""')
            (n,) = self._db.execute(f'SELECT count(*) FROM "{quoted}"').fetchone()
            out.append({"name": name, "estimatedRows": n})
        return out

    def describe_table(self, table: str) -> dict[str, Any]:
        assert self._db is not None
        cols = self._db.execute("SELECT * FROM pragma_table_info(?)", (table,)).fetchall()
        if not cols:
            raise LookupError(f"unknown table: {table}")

        columns = [
            {
                "name": c["name"],
                "type": c["type"],
                "nullable": not c["notnull"],
                "key": "PRI" if c["pk"] else None,
                "default": None if c["dflt_value"] is None else str(c["dflt_value"]),
            }
            for c in cols
        ]

        indexes = [
            {
                "name": ix["name"],
                "columns": [
                    r["name"]
                    for r in self._db.execute("SELECT name FROM pragma_index_info(?)", (ix["name"],))
                ],
                "unique": bool(ix["unique"]),
            }
            for ix in self._db.execute("SELECT * FROM pragma_index_list(?)", (table,)).fetchall()
        ]

        fk_by_id: dict[int, dict[str, Any]] = {}
        for fk in self._db.execute("SELECT * FROM pragma_foreign_key_list(?)", (table,)):
            entry = fk_by_id.setdefault(
                fk["id"],
                {
                    # SQLite FKs are unnamed; synthesize a stable one.
                    "name": f"fk_{table}_{fk['id']}",
                    "columns": [],
                    "referencesTable": fk["table"],
                    "referencesColumns": [],
                },
            )
            entry["columns"].append(fk["from"])
            entry["referencesColumns"].append(fk["to"])

        return {"name": table, "columns": columns, "indexes": indexes, "foreignKeys": list(fk_by_id.values())}
