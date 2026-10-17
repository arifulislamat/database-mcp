//! Layer-one read-only guard: conservative string classification.

const READ_PREFIXES: &[&str] = &[
    "SELECT", "WITH", "EXPLAIN", "VALUES", "SHOW", "DESCRIBE", "DESC",
];
const WHITESPACE: &[char] = &[' ', '\t', '\n', '\x0b', '\x0c'];

/// First keyword after leading whitespace and comments, or "" when the lead
/// is anything an engine could read differently: a lone CR, `#`, an
/// executable comment (`/*!`, `/*M!`), a nested or unterminated comment.
fn first_word(sql: &str) -> String {
    let mut rest = sql;
    loop {
        rest = rest.trim_start_matches(WHITESPACE);
        if rest.starts_with("--") {
            let Some(end) = rest.find('\n') else {
                return String::new();
            };
            if rest[..end].contains('\r') {
                return String::new();
            }
            rest = &rest[end + 1..];
        } else if let Some(after) = rest.strip_prefix("/*") {
            let Some(end) = after.find("*/") else {
                return String::new();
            };
            let body = &after[..end];
            if body.starts_with('!') || body.starts_with("M!") || body.contains("/*") {
                return String::new();
            }
            rest = &after[end + 2..];
        } else {
            break;
        }
    }
    rest.chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase()
}

/// Returns (empty, multi). Scans quotes and comments the way SQLite, MySQL
/// and Postgres all agree on. Text they lex differently (backslash escapes,
/// dollar quotes, `#` comments, backticks, `[identifiers]`, a lone CR ending
/// a comment, `--` without a space, nested or executable comments) makes the
/// scan ambiguous; then any semicolon before the end counts as a second
/// statement.
fn scan(sql: &str) -> (bool, bool) {
    #[derive(PartialEq)]
    enum Comment {
        Line,
        Block,
    }
    let chars: Vec<char> = sql.chars().collect();
    let at = |i: usize| chars.get(i).copied();
    let mut quote: Option<char> = None;
    let mut comment: Option<Comment> = None;
    let mut ambiguous = false;
    let mut empty = true;
    let mut after_semi = false;
    let mut multi = false;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        let next = at(i + 1);
        if matches!(ch, '\\' | '$' | '#' | '[' | '`' | '\r') {
            ambiguous = true;
        }
        if comment == Some(Comment::Line) {
            if ch == '\n' {
                comment = None;
            }
        } else if comment == Some(Comment::Block) {
            if ch == '/' && next == Some('*') {
                ambiguous = true;
            }
            if ch == '*' && next == Some('/') {
                comment = None;
                i += 1;
            }
        } else if let Some(q) = quote {
            if ch == q {
                quote = None;
            }
        } else if ch == '-' && next == Some('-') {
            if !matches!(at(i + 2), Some(' ' | '\t' | '\n')) {
                ambiguous = true;
            }
            comment = Some(Comment::Line);
            i += 1;
        } else if ch == '/' && next == Some('*') {
            if at(i + 2) == Some('!') || (at(i + 2) == Some('M') && at(i + 3) == Some('!')) {
                ambiguous = true;
            }
            comment = Some(Comment::Block);
            i += 1;
        } else if ch == ';' {
            empty = false;
            after_semi = true;
        } else if !WHITESPACE.contains(&ch) {
            empty = false;
            if after_semi {
                multi = true;
            }
            if matches!(ch, '\'' | '"' | '`') {
                quote = Some(ch);
            }
        }
        i += 1;
    }
    if ambiguous {
        multi = sql
            .trim_end_matches(|c: char| c.is_whitespace() || c == ';')
            .contains(';');
    }
    (empty, multi)
}

/// Returns an error message (with its stable prefix) or None.
///
/// Conservative: anything not obviously a read is treated as a write. Writes
/// that sneak past (e.g. `WITH x AS (...) DELETE ...`) are stopped by the
/// adapter's session-level read-only enforcement, layer two.
pub fn guard_sql(sql: &str, read_only: bool) -> Option<String> {
    let normalized = sql.replace("\r\n", "\n");
    let (empty, multi) = scan(&normalized);
    if empty {
        return Some("read-only: empty statement".into());
    }
    if multi {
        return Some("multi-statement: only a single SQL statement is allowed".into());
    }
    if read_only {
        let first = first_word(&normalized);
        if !READ_PREFIXES.contains(&first.as_str()) {
            return Some(format!(
                "read-only: statement '{first}' is blocked (start the server with --allow-write to enable writes)"
            ));
        }
    }
    None
}
