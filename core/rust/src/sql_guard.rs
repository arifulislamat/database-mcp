//! Layer-one read-only guard: conservative string classification.

use std::sync::LazyLock;

use regex::Regex;

const READ_PREFIXES: &[&str] = &[
    "SELECT", "WITH", "EXPLAIN", "VALUES", "SHOW", "DESCRIBE", "DESC",
];

static BLOCK_COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)/\*.*?\*/").unwrap());
static LINE_COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"--[^\n]*").unwrap());

fn strip_comments(sql: &str) -> String {
    let no_block = BLOCK_COMMENT.replace_all(sql, " ");
    LINE_COMMENT.replace_all(&no_block, " ").trim().to_string()
}

/// True if a semicolon appears outside string literals before the end.
fn has_multiple_statements(sql: &str) -> bool {
    let mut quote: Option<char> = None;
    for (i, ch) in sql.char_indices() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if matches!(ch, '\'' | '"' | '`') => quote = Some(ch),
            None if ch == ';' && !sql[i + 1..].trim().is_empty() => return true,
            None => {}
        }
    }
    false
}

/// Returns an error message (with its stable prefix) or None.
///
/// Conservative: anything not obviously a read is treated as a write. Writes
/// that sneak past (e.g. `WITH x AS (...) DELETE ...`) are stopped by the
/// adapter's session-level read-only enforcement, layer two.
pub fn guard_sql(sql: &str, read_only: bool) -> Option<String> {
    let stripped = strip_comments(sql);
    if stripped.is_empty() {
        return Some("read-only: empty statement".into());
    }
    if has_multiple_statements(&stripped) {
        return Some("multi-statement: only a single SQL statement is allowed".into());
    }
    if read_only {
        let first: String = stripped
            .chars()
            .take_while(|c| c.is_ascii_alphabetic())
            .collect::<String>()
            .to_ascii_uppercase();
        if !READ_PREFIXES.contains(&first.as_str()) {
            return Some(format!(
                "read-only: statement '{first}' is blocked (start the server with --allow-write to enable writes)"
            ));
        }
    }
    None
}
