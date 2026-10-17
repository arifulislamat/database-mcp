import sqlite3

from database_mcp_libsql.adapter import LibsqlAdapter
from database_mcp_sqlite.adapter import SqliteAdapter


def test_writes_that_return_rows_are_committed(tmp_path):
    path = tmp_path / "t.db"
    sqlite3.connect(path).execute("CREATE TABLE t (i INTEGER)").connection.close()
    for adapter in (SqliteAdapter(str(path)), LibsqlAdapter(str(path))):
        adapter.connect(read_only=False)
        r = adapter.query("INSERT INTO t VALUES (1) RETURNING i", max_rows=10, timeout_ms=5000)
        assert r["rows"] == [{"i": 1}]
        adapter.close()
    other = sqlite3.connect(path)
    assert other.execute("SELECT count(*) FROM t").fetchone() == (2,)
