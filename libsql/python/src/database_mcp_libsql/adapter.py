"""libSQL adapter over the libsql driver. Zero MCP types.

libSQL is a SQLite fork: catalog queries are identical to the SQLite
adapter's. What differs is the transport: the driver speaks to local files
and remote servers (libsql:/https:/ws:) with an auth token.
"""

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

    def __init__(self, url: str, auth_token: Secret | str | None = None) -> None:
        self._url = url
        # A plain string arrives when running isolated (it crossed a process
        # boundary); it becomes a Secret, and is registered for redaction,
        # here too.
        self._token = Secret(auth_token) if isinstance(auth_token, str) else auth_token
        self._db = None
        self._remote_read_only = False

    def connect(self, *, read_only: bool) -> None:
        # The driver takes a plain path for local files; strip the file:
        # scheme the conformance harness (and the TS line) uses for them.
        url = self._url[5:] if self._url.startswith("file:") else self._url
        # Autocommit: with the default, a write that returns rows (INSERT ...
        # RETURNING) was never committed and was lost on close.
        self._db = libsql.connect(
            url, auth_token=self._token.reveal() if self._token else "", isolation_level=None
        )
        if read_only:
            self._db.execute("PRAGMA query_only = ON")
        # Remote: the server drops an idle stream and the driver silently
        # opens a fresh one without the pragma, so query() sets it again
        # right before every query.
        self._remote_read_only = read_only and "://" in url
        # Fail fast on bad URL/credentials.
        self._db.execute("SELECT 1")

    def close(self) -> None:
        if self._db is not None:
            self._db.close()

    def query(self, sql: str, *, max_rows: int, timeout_ms: int) -> dict[str, Any]:
        assert self._db is not None
        # queryTimeoutMs is enforced by running this adapter under
        # IsolatedAdapter: the driver itself cannot be interrupted.
        if self._remote_read_only:
            self._db.execute("PRAGMA query_only = ON")
        cur = self._db.execute(sql)
        # Writes come back with an empty description (not None like stdlib sqlite3).
        if not cur.description:
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
