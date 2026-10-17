//! Secret handling: secrets must never appear in plaintext output.

use std::fmt;
use std::sync::{LazyLock, Mutex};

use regex::Regex;

/// Registered secret literals, masked by `redact()` just before output.
static SECRETS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Matches the password in credential-bearing URIs: proto://user:pass@
static URI_CREDENTIALS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)([a-z][a-z0-9+.-]*://[^:@/\s]+):[^@/\s]+@").unwrap());

pub fn register_secret(value: &str) {
    if !value.is_empty() {
        let mut secrets = SECRETS.lock().unwrap_or_else(|e| e.into_inner());
        if !secrets.iter().any(|s| s == value) {
            secrets.push(value.to_string());
        }
    }
}

/// Masks every registered secret and anything shaped like URI credentials.
///
/// Belt and suspenders for driver messages we don't control.
pub fn redact(text: &str) -> String {
    let mut out = URI_CREDENTIALS.replace_all(text, "$1:***@").into_owned();
    for s in SECRETS.lock().unwrap_or_else(|e| e.into_inner()).iter() {
        out = out.replace(s.as_str(), "***");
    }
    out
}

/// A full DSN embeds the password; log this form instead.
pub fn sanitize_dsn(dsn: &str) -> String {
    URI_CREDENTIALS.replace_all(dsn, "$1@").into_owned()
}

/// Logs to stderr through the redaction filter. stdout is the MCP stream and
/// never carries logs. Rust has no global stderr hook, so every log line in
/// this crate and the engine crates goes through here.
pub fn log(message: &str) {
    eprintln!("{}", redact(message));
}

/// Panic messages go to stderr too; route them through the redactor.
pub fn install_panic_redaction() {
    std::panic::set_hook(Box::new(|info| log(&format!("panic: {info}"))));
}

/// A password that cannot be printed by accident.
///
/// Display and Debug both yield "***". The raw value is available only
/// through `reveal()`, used at the single point of driver connection.
/// Constructing one also registers it with the redactor.
#[derive(Clone)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        let value = value.into();
        register_secret(&value);
        Secret(value)
    }

    pub fn reveal(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}
