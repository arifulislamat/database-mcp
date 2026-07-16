"""libSQL adapter over the libsql driver. Zero MCP types.

libSQL is a SQLite fork: catalog queries are identical to the SQLite
adapter's. What differs is the transport: the driver speaks to local files
and remote servers (libsql:/https:/ws:) with an auth token.
"""

import concurrent.futures
import sys
from typing import Any

import libsql

from database_mcp_core import Secret

_JS_SAFE_MAX = 2**53 - 1


def _json_safe(value: Any) -> Any:
    """Integers beyond the JS safe range are returned as strings (JSON-safe)."""
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > _JS_SAFE_MAX:
        return str(value)
    return value


def _dict_rows(cur) -> list[dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


class LibsqlAdapter:
    engine = "libsql"

    def __init__(self, url: str, auth_token: Secret | None = None) -> None:
        self._url = url
        self._token = auth_token
        self._db = None
        self._pool: concurrent.futures.ThreadPoolExecutor | None = None

    def connect(self, *, read_only: bool) -> None:
        # The driver takes a plain path for local files; strip the file:
        # scheme the conformance harness (and the TS line) uses for them.
        url = self._url[5:] if self._url.startswith("file:") else self._url
        self._db = libsql.connect(url, auth_token=self._token.reveal() if self._token else "")
        if read_only:
            try:
                self._db.execute("PRAGMA query_only = ON")
            except Exception:
                # Remote servers may not honor per-session pragmas. The SQL
                # guard still blocks writes; for real protection use a
                # read-only token.
                print(
                    "libsql: session read-only unavailable on this server, use a read-only auth token",
                    file=sys.stderr,
                )
        # Fail fast on bad URL/credentials.
        self._db.execute("SELECT 1")
        self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)

    def close(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=False)
        if self._db is not None:
            self._db.close()

    def query(self, sql: str, *, max_rows: int, timeout_ms: int) -> dict[str, Any]:
        assert self._db is not None and self._pool is not None
        # ponytail: on timeout the call is abandoned, not cancelled (the
        # worker thread keeps running), same semantics as the TS adapter's
        # Promise.race.
        try:
            cur = self._pool.submit(self._db.execute, sql).result(timeout=timeout_ms / 1000)
        except TimeoutError:
            raise RuntimeError(f"timeout: query exceeded {timeout_ms}ms") from None
        # Writes come back with an empty description (not None like stdlib sqlite3).
        if not cur.description:
            self._db.commit()
            return {"columns": [], "rows": [], "rowCount": max(cur.rowcount, 0), "truncated": False}
        columns = [d[0] for d in cur.description]
        fetched = cur.fetchmany(max_rows + 1)
        truncated = len(fetched) > max_rows
        rows = [{c: _json_safe(v) for c, v in zip(columns, r)} for r in fetched[:max_rows]]
        return {"columns": columns, "rows": rows, "rowCount": len(rows), "truncated": truncated}

    def list_tables(self) -> list[dict[str, Any]]:
        assert self._db is not None
        names = [
            r[0]
            for r in self._db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
        ]
        out = []
        for name in names:
            quoted = name.replace('"', '""')
            (n,) = self._db.execute(f'SELECT count(*) FROM "{quoted}"').fetchone()
            out.append({"name": name, "estimatedRows": n})
        return out

    def describe_table(self, table: str) -> dict[str, Any]:
        assert self._db is not None
        cols = _dict_rows(self._db.execute("SELECT * FROM pragma_table_info(?)", (table,)))
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
                    r[0]
                    for r in self._db.execute(
                        "SELECT name FROM pragma_index_info(?)", (ix["name"],)
                    ).fetchall()
                ],
                "unique": bool(ix["unique"]),
            }
            for ix in _dict_rows(self._db.execute("SELECT * FROM pragma_index_list(?)", (table,)))
        ]

        fk_by_id: dict[int, dict[str, Any]] = {}
        for fk in _dict_rows(self._db.execute("SELECT * FROM pragma_foreign_key_list(?)", (table,))):
            entry = fk_by_id.setdefault(
                fk["id"],
                {
                    # SQLite-family FKs are unnamed; synthesize a stable one.
                    "name": f"fk_{table}_{fk['id']}",
                    "columns": [],
                    "referencesTable": fk["table"],
                    "referencesColumns": [],
                },
            )
            entry["columns"].append(fk["from"])
            entry["referencesColumns"].append(fk["to"])

        return {"name": table, "columns": columns, "indexes": indexes, "foreignKeys": list(fk_by_id.values())}
