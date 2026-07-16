"""The seam between the engine-agnostic protocol layer and a database driver.

Adapters contain zero MCP types. Result dicts use the wire-format keys from
docs/tool-contract.md directly, so they serialize without conversion:

  query        -> {"columns": [str], "rows": [dict], "rowCount": int, "truncated": bool}
                  (empty columns signals a write/DDL result; rowCount = affected)
  list_tables  -> [{"name": str, "estimatedRows": int}]
  describe_table -> {"name", "columns": [{name, type, nullable, key, default}],
                     "indexes": [{name, columns, unique}],
                     "foreignKeys": [{name, columns, referencesTable, referencesColumns}]}

Values that can overflow JSON consumers (BIGINT, DECIMAL) are returned as
strings. When read_only is set, the adapter must enforce it at the
connection/session level (the SQL guard is only layer one).
"""

from typing import Any, Protocol


class DatabaseAdapter(Protocol):
    engine: str

    def connect(self, *, read_only: bool) -> None: ...

    def close(self) -> None: ...

    def query(self, sql: str, *, max_rows: int, timeout_ms: int) -> dict[str, Any]: ...

    def list_tables(self) -> list[dict[str, Any]]: ...

    def describe_table(self, table: str) -> dict[str, Any]: ...
