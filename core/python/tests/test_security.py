"""Mirrors core/typescript/test/security.test.mjs."""

import json
from pathlib import Path

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


# Shared with the TS and Rust tests: bypass attempts across SQL dialects.
def test_sql_guard_shared_dialect_cases():
    cases_path = Path(__file__).parents[3] / "conformance" / "fixtures" / "guard-cases.json"
    for sql, prefix in json.loads(cases_path.read_text()):
        got = guard_sql(sql, True)
        if prefix is None:
            assert got is None, sql
        else:
            assert got and got.startswith(f"{prefix}:"), (sql, got)


def test_redact_empty_uri_user_and_key_value_dsn_passwords():
    assert redact("postgres://:p%40ss@db/x") == "postgres://:***@db/x"
    assert redact("host=db user=app password=hunter2 dbname=x") == "host=db user=app password=*** dbname=x"
    assert redact("host=db PASSWORD = 'a b' dbname=x") == "host=db PASSWORD = *** dbname=x"


@pytest.mark.parametrize("value", ["abc", "0", "-5", "1.5"])
def test_config_guardrail_numbers_must_be_positive_integers(value):
    with pytest.raises(ValueError, match="maxRows must be a positive integer"):
        load_config(["--max-rows", value], {}, env_prefix="X")
    with pytest.raises(ValueError, match="queryTimeoutMs must be a positive integer"):
        load_config([], {"QUERY_TIMEOUT_MS": value}, env_prefix="X")
