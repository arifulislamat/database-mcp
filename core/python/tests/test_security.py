"""Mirrors core/typescript/test/security.test.mjs."""

import json

import pytest

from database_mcp_core import Secret, guard_sql, load_config, redact, sanitize_dsn
from database_mcp_core.config import _dump


def test_secret_never_prints_through_any_render_path():
    s = Secret("hunter2")
    assert str(s) == "***"
    assert f"{s}" == "***"
    assert repr(s) == "***"
    assert s.reveal() == "hunter2"


def test_redact_masks_registered_secrets_and_uri_credentials():
    Secret("s3cr3t-value")  # constructor registers
    assert redact("oops: s3cr3t-value leaked") == "oops: *** leaked"
    assert (
        redact("connecting to mysql://root:p4ss@db.example.com:3306/app")
        == "connecting to mysql://root:***@db.example.com:3306/app"
    )


def test_sanitize_dsn_strips_the_password_keeps_the_rest():
    assert sanitize_dsn("mysql://user:pw@host:3306/db") == "mysql://user@host:3306/db"
    assert sanitize_dsn("/plain/file/path.db") == "/plain/file/path.db"


def test_config_yaml_var_expansion_and_password_becomes_secret(tmp_path):
    yaml_path = tmp_path / "c.yaml"
    yaml_path.write_text(
        "connection:\n  host: db.local\n  user: app\n  password: ${TEST_DB_PW}\nguardrails:\n  maxRows: 7\n"
    )
    config = load_config(["--config", str(yaml_path)], {"TEST_DB_PW": "from-env-9"}, env_prefix="X")
    assert config.connection.host == "db.local"
    assert config.connection.password.reveal() == "from-env-9"
    assert str(config.connection.password) == "***"
    assert config.guardrails.max_rows == 7
    assert config.guardrails.read_only is True


def test_config_missing_var_is_a_hard_error_naming_the_variable(tmp_path):
    yaml_path = tmp_path / "c.yaml"
    yaml_path.write_text("connection:\n  password: ${NOT_SET_ANYWHERE}\n")
    with pytest.raises(ValueError, match="NOT_SET_ANYWHERE"):
        load_config(["--config", str(yaml_path)], {}, env_prefix="X")


def test_config_password_file_wins_over_env_password(tmp_path):
    pw_path = tmp_path / "pw"
    pw_path.write_text("file-pw\n")
    config = load_config(
        [], {"MYSQL_PASSWORD": "env-pw", "MYSQL_PASSWORD_FILE": str(pw_path)}, env_prefix="MYSQL"
    )
    assert config.connection.password.reveal() == "file-pw"


def test_config_flag_beats_env():
    config = load_config(
        ["--dsn", "/from/flag.db"], {"SQLITE_PATH": "/from/env.db"}, env_prefix="SQLITE", dsn_env_var="SQLITE_PATH"
    )
    assert config.connection.dsn == "/from/flag.db"
    config2 = load_config([], {"SQLITE_PATH": "/from/env.db"}, env_prefix="SQLITE", dsn_env_var="SQLITE_PATH")
    assert config2.connection.dsn == "/from/env.db"


def test_config_inline_dsn_password_gets_registered_for_redaction():
    load_config(["--dsn", "postgres://u:dsn-inline-pw@h/db"], {}, env_prefix="PG")
    assert redact("log with dsn-inline-pw inside") == "log with *** inside"


def test_config_dump_never_contains_the_dsn_password():
    config = load_config(
        [],
        {"DATABASE_URL": "postgres://myuser:supersecret18@localhost:5432/mydb"},
        env_prefix="POSTGRES",
        dsn_env_var="DATABASE_URL",
    )
    printed = redact(json.dumps(_dump(config), indent=2))
    assert "supersecret18" not in printed
    assert "postgres://myuser:***@localhost:5432/mydb" in printed


def test_config_transport_defaults_stdio_flags_select_http():
    a = load_config(["--dsn", "/x.db"], {}, env_prefix="SQLITE")
    assert (a.transport.type, a.transport.port) == ("stdio", 8080)
    b = load_config(["--dsn", "/x.db", "--transport", "http", "--port", "9090"], {}, env_prefix="SQLITE")
    assert (b.transport.type, b.transport.port) == ("http", 9090)


def test_sql_guard_read_only_and_multi_statement_classification():
    assert guard_sql("SELECT 1", True) is None
    assert guard_sql("  -- comment\n  select * from t", True) is None
    assert guard_sql("DELETE FROM t", True).startswith("read-only:")
    assert guard_sql("SELECT 1; SELECT 2", True).startswith("multi-statement:")
    assert guard_sql("SELECT 'a;b' FROM t", True) is None
    assert guard_sql("DELETE FROM t", False) is None
