//! Mirrors core/typescript/test/security.test.mjs and core/python/tests/test_security.py.

use std::collections::HashMap;

use database_mcp_rs_core::{EnvNames, Secret, dump, guard_sql, load_config, redact, sanitize_dsn};

const SQLITE: EnvNames = EnvNames {
    prefix: "SQLITE",
    dsn_var: Some("SQLITE_PATH"),
    password_var: None,
};

fn names(prefix: &'static str) -> EnvNames {
    EnvNames {
        prefix,
        dsn_var: None,
        password_var: None,
    }
}

fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

fn temp_file(name: &str, contents: &str) -> String {
    let dir = std::env::temp_dir().join(format!("database-mcp-rs-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, contents).unwrap();
    path.to_string_lossy().into_owned()
}

#[test]
fn secret_never_prints_through_any_render_path() {
    let s = Secret::new("hunter2");
    assert_eq!(s.to_string(), "***");
    assert_eq!(format!("{s}"), "***");
    assert_eq!(format!("{s:?}"), "***");
    assert_eq!(s.reveal(), "hunter2");
}

#[test]
fn redact_masks_registered_secrets_and_uri_credentials() {
    Secret::new("s3cr3t-value"); // constructor registers
    assert_eq!(redact("oops: s3cr3t-value leaked"), "oops: *** leaked");
    assert_eq!(
        redact("connecting to mysql://root:p4ss@db.example.com:3306/app"),
        "connecting to mysql://root:***@db.example.com:3306/app"
    );
}

#[test]
fn sanitize_dsn_strips_the_password_keeps_the_rest() {
    assert_eq!(
        sanitize_dsn("mysql://user:pw@host:3306/db"),
        "mysql://user@host:3306/db"
    );
    assert_eq!(sanitize_dsn("/plain/file/path.db"), "/plain/file/path.db");
}

#[test]
fn config_yaml_var_expansion_and_password_becomes_secret() {
    let path = temp_file(
        "c.yaml",
        "connection:\n  host: db.local\n  user: app\n  password: ${TEST_DB_PW}\nguardrails:\n  maxRows: 7\n",
    );
    let config = load_config(
        &args(&["--config", &path]),
        &env(&[("TEST_DB_PW", "from-env-9")]),
        &names("X"),
    )
    .unwrap();
    assert_eq!(config.connection.host.as_deref(), Some("db.local"));
    let pw = config.connection.password.unwrap();
    assert_eq!(pw.reveal(), "from-env-9");
    assert_eq!(pw.to_string(), "***");
    assert_eq!(config.guardrails.max_rows, 7);
    assert!(config.guardrails.read_only);
}

#[test]
fn config_missing_var_is_a_hard_error_naming_the_variable() {
    let path = temp_file(
        "missing.yaml",
        "connection:\n  password: ${NOT_SET_ANYWHERE}\n",
    );
    let err = load_config(&args(&["--config", &path]), &env(&[]), &names("X")).unwrap_err();
    assert!(err.contains("NOT_SET_ANYWHERE"), "{err}");
}

#[test]
fn config_password_file_wins_over_env_password() {
    let pw_path = temp_file("pw", "file-pw\n");
    let config = load_config(
        &[],
        &env(&[
            ("MYSQL_PASSWORD", "env-pw"),
            ("MYSQL_PASSWORD_FILE", &pw_path),
        ]),
        &names("MYSQL"),
    )
    .unwrap();
    assert_eq!(config.connection.password.unwrap().reveal(), "file-pw");
}

#[test]
fn config_flag_beats_env() {
    let e = env(&[("SQLITE_PATH", "/from/env.db")]);
    let config = load_config(&args(&["--dsn", "/from/flag.db"]), &e, &SQLITE).unwrap();
    assert_eq!(config.connection.dsn.as_deref(), Some("/from/flag.db"));
    let config2 = load_config(&[], &e, &SQLITE).unwrap();
    assert_eq!(config2.connection.dsn.as_deref(), Some("/from/env.db"));
}

#[test]
fn config_inline_dsn_password_gets_registered_for_redaction() {
    load_config(
        &args(&["--dsn", "postgres://u:dsn-inline-pw@h/db"]),
        &env(&[]),
        &names("PG"),
    )
    .unwrap();
    assert_eq!(
        redact("log with dsn-inline-pw inside"),
        "log with *** inside"
    );
}

#[test]
fn config_dump_never_contains_the_dsn_password() {
    let names = EnvNames {
        prefix: "POSTGRES",
        dsn_var: Some("DATABASE_URL"),
        password_var: None,
    };
    let config = load_config(
        &[],
        &env(&[(
            "DATABASE_URL",
            "postgres://myuser:supersecret18@localhost:5432/mydb",
        )]),
        &names,
    )
    .unwrap();
    let printed = redact(&serde_json::to_string_pretty(&dump(&config)).unwrap());
    assert!(!printed.contains("supersecret18"));
    assert!(printed.contains("postgres://myuser:***@localhost:5432/mydb"));
}

#[test]
fn config_transport_defaults_stdio_flags_select_http() {
    let a = load_config(&args(&["--dsn", "/x.db"]), &env(&[]), &SQLITE).unwrap();
    assert_eq!(
        (a.transport.kind.as_str(), a.transport.port),
        ("stdio", 8080)
    );
    let b = load_config(
        &args(&["--dsn", "/x.db", "--transport", "http", "--port", "9090"]),
        &env(&[]),
        &SQLITE,
    )
    .unwrap();
    assert_eq!(
        (b.transport.kind.as_str(), b.transport.port),
        ("http", 9090)
    );
}

#[test]
fn sql_guard_read_only_and_multi_statement_classification() {
    assert_eq!(guard_sql("SELECT 1", true), None);
    assert_eq!(guard_sql("  -- comment\n  select * from t", true), None);
    assert!(
        guard_sql("DELETE FROM t", true)
            .unwrap()
            .starts_with("read-only:")
    );
    assert!(
        guard_sql("SELECT 1; SELECT 2", true)
            .unwrap()
            .starts_with("multi-statement:")
    );
    assert_eq!(guard_sql("SELECT 'a;b' FROM t", true), None);
    assert_eq!(guard_sql("DELETE FROM t", false), None);
}
