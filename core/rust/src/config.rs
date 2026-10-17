//! Multi-source config resolution, mirroring core/typescript/src/config.ts.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::{Captures, Regex};
use serde_json::{Map, Value, json};
use yaml_rust2::{Yaml, YamlLoader};

use crate::secret::{Secret, register_secret};

#[derive(Debug, Clone)]
pub struct Guardrails {
    pub read_only: bool,
    pub max_rows: usize,
    pub query_timeout_ms: u64,
}

/// General enough for a SQLite file path AND a networked engine.
#[derive(Debug, Clone, Default)]
pub struct Connection {
    pub dsn: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<Secret>,
    pub database: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Transport {
    /// "stdio" or "http"
    pub kind: String,
    /// http only; the server binds 127.0.0.1.
    pub port: u16,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub connection: Connection,
    pub guardrails: Guardrails,
    pub transport: Transport,
}

/// How an engine names its environment variables.
pub struct EnvNames {
    /// e.g. "SQLITE" -> SQLITE_HOST, SQLITE_PASSWORD, ...
    pub prefix: &'static str,
    /// Extra DSN variable checked before <PREFIX>_DSN (e.g. SQLITE_PATH).
    pub dsn_var: Option<&'static str>,
    /// Overrides <PREFIX>_PASSWORD (e.g. LIBSQL_AUTH_TOKEN).
    pub password_var: Option<&'static str>,
}

static VAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\$\{(\w+)\}").unwrap());

/// ${VAR} in YAML string values resolves from the environment at load time.
fn expand(value: &str, env: &HashMap<String, String>, path: &str) -> Result<String, String> {
    let mut missing = None;
    let out = VAR.replace_all(value, |c: &Captures| match env.get(&c[1]) {
        Some(v) => v.clone(),
        None => {
            missing.get_or_insert_with(|| c[1].to_string());
            String::new()
        }
    });
    match missing {
        Some(name) => Err(format!(
            "config: ${{{name}}} referenced at '{path}' but the environment variable is not set"
        )),
        None => Ok(out.into_owned()),
    }
}

/// YAML to JSON, expanding ${VAR} in every string value on the way.
fn to_json(node: &Yaml, env: &HashMap<String, String>, path: &str) -> Result<Value, String> {
    Ok(match node {
        Yaml::String(s) => Value::String(expand(s, env, path)?),
        Yaml::Integer(i) => json!(i),
        Yaml::Real(_) => json!(node.as_f64()),
        Yaml::Boolean(b) => json!(b),
        Yaml::Array(items) => Value::Array(
            items
                .iter()
                .enumerate()
                .map(|(i, v)| to_json(v, env, &format!("{path}[{i}]")))
                .collect::<Result<_, _>>()?,
        ),
        Yaml::Hash(h) => {
            let mut m = Map::new();
            for (k, v) in h {
                let key = match k {
                    Yaml::String(s) => s.clone(),
                    Yaml::Integer(i) => i.to_string(),
                    _ => continue,
                };
                let child = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                m.insert(key, to_json(v, env, &child)?);
            }
            Value::Object(m)
        }
        _ => Value::Null,
    })
}

/// A config value as a string: YAML numbers and strings both count.
fn as_text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn number<T: std::str::FromStr>(name: &str, raw: Option<String>, default: T) -> Result<T, String> {
    match raw {
        None => Ok(default),
        Some(s) => s
            .trim()
            .parse()
            .map_err(|_| format!("config: {name} must be a number, got '{s}'")),
    }
}

/// 0 or garbage would silently switch a guardrail off.
fn positive(name: &str, raw: Option<String>, default: u64) -> Result<u64, String> {
    match number(name, raw.clone(), default) {
        Ok(n) if n > 0 => Ok(n),
        _ => Err(format!(
            "config: {name} must be a positive integer, got '{}'",
            raw.unwrap_or_default()
        )),
    }
}

/// Multi-source resolution, highest precedence first:
///   1. flags (--dsn, --allow-write, --max-rows, --query-timeout-ms, --transport, --port)
///   2. --config <path.yaml> (or DB_MCP_CONFIG), with ${VAR} expansion
///   3. discrete env vars (<PREFIX>_HOST, ..., plus *_FILE variants)
///   4. defaults
///
/// Password specifically: password_file / *_PASSWORD_FILE > password / *_PASSWORD.
/// The password is a Secret the moment it is read.
pub fn load_config(
    argv: &[String],
    env: &HashMap<String, String>,
    names: &EnvNames,
) -> Result<Config, String> {
    let flag = |name: &str| {
        argv.iter()
            .position(|a| a == name)
            .and_then(|i| argv.get(i + 1))
            .cloned()
    };
    let var = |name: &str| env.get(name).cloned();

    let file = match flag("--config").or_else(|| var("DB_MCP_CONFIG")) {
        Some(path) => {
            let text = std::fs::read_to_string(&path)
                .map_err(|e| format!("config: cannot read {path}: {e}"))?;
            let docs = YamlLoader::load_from_str(&text)
                .map_err(|e| format!("config: invalid YAML in {path}: {e}"))?;
            docs.first()
                .map(|d| to_json(d, env, ""))
                .transpose()?
                .unwrap_or(Value::Null)
        }
        None => Value::Null,
    };
    let fc = &file["connection"];
    let fg = &file["guardrails"];
    let ft = &file["transport"];
    let p = names.prefix;

    let pw_var = names
        .password_var
        .map(String::from)
        .unwrap_or(format!("{p}_PASSWORD"));
    let raw_password =
        match as_text(fc.get("password_file")).or_else(|| var(&format!("{pw_var}_FILE"))) {
            Some(path) => Some(
                std::fs::read_to_string(&path)
                    .map_err(|e| format!("config: cannot read password file {path}: {e}"))?
                    .trim()
                    .to_string(),
            ),
            None => as_text(fc.get("password")).or_else(|| var(&pw_var)),
        };

    let dsn = flag("--dsn")
        .or_else(|| as_text(fc.get("dsn")))
        .or_else(|| names.dsn_var.and_then(var))
        .or_else(|| var(&format!("{p}_DSN")));
    // Inline DSN credentials are discouraged but must never leak: register them.
    if let Some(caps) = dsn.as_deref().and_then(|d| DSN_PASSWORD.captures(d)) {
        register_secret(&percent_decode(&caps[1]));
        register_secret(&caps[1]);
    }

    let read_only = if argv.iter().any(|a| a == "--allow-write") {
        false
    } else if let Some(b) = fg.get("readOnly").and_then(Value::as_bool) {
        b
    } else if let Some(v) = var("ALLOW_WRITE") {
        v != "true"
    } else {
        true
    };

    let port = as_text(fc.get("port")).or_else(|| var(&format!("{p}_PORT")));
    Ok(Config {
        connection: Connection {
            dsn,
            host: as_text(fc.get("host")).or_else(|| var(&format!("{p}_HOST"))),
            port: port.map(|s| number("port", Some(s), 0)).transpose()?,
            user: as_text(fc.get("user")).or_else(|| var(&format!("{p}_USER"))),
            password: raw_password.filter(|s| !s.is_empty()).map(Secret::new),
            database: as_text(fc.get("database")).or_else(|| var(&format!("{p}_DATABASE"))),
        },
        guardrails: Guardrails {
            read_only,
            max_rows: positive(
                "maxRows",
                flag("--max-rows")
                    .or_else(|| as_text(fg.get("maxRows")))
                    .or_else(|| var("MAX_ROWS")),
                1000,
            )? as usize,
            query_timeout_ms: positive(
                "queryTimeoutMs",
                flag("--query-timeout-ms")
                    .or_else(|| as_text(fg.get("queryTimeoutMs")))
                    .or_else(|| var("QUERY_TIMEOUT_MS")),
                30000,
            )?,
        },
        transport: Transport {
            kind: flag("--transport")
                .or_else(|| as_text(ft.get("type")))
                .unwrap_or("stdio".into()),
            port: number(
                "port",
                flag("--port").or_else(|| as_text(ft.get("port"))),
                8080,
            )?,
        },
    })
}

/// The password part of a credential-bearing URI: proto://user:PASS@
static DSN_PASSWORD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^[a-z][a-z0-9+.-]*://[^:@/\s]*:([^@/\s]+)@").unwrap());

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(b) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Redacted, camelCase dump matching the TypeScript --print-config shape.
/// Callers still pass it through `redact()`: DSN credentials are plain strings.
pub fn dump(config: &Config) -> Value {
    let c = &config.connection;
    let mut connection = Map::new();
    let mut put = |k: &str, v: Option<Value>| {
        if let Some(v) = v {
            connection.insert(k.into(), v);
        }
    };
    put("dsn", c.dsn.clone().map(Value::from));
    put("host", c.host.clone().map(Value::from));
    put("port", c.port.map(Value::from));
    put("user", c.user.clone().map(Value::from));
    put("password", c.password.as_ref().map(|_| Value::from("***")));
    put("database", c.database.clone().map(Value::from));
    json!({
        "connection": connection,
        "guardrails": {
            "readOnly": config.guardrails.read_only,
            "maxRows": config.guardrails.max_rows,
            "queryTimeoutMs": config.guardrails.query_timeout_ms,
        },
        "transport": { "type": config.transport.kind, "port": config.transport.port },
    })
}
