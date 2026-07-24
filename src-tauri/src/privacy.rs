// Privacy guards for the observation subsystem: a sensitive-window blocklist
// (skip content reads, hide titles) and text sanitization (redact emails, long
// digit runs, API tokens) applied before anything leaves the machine.
use regex::Regex;
use std::sync::LazyLock;

/// Sentinel title returned for blocklisted windows. The frontend maps it to a
/// localized label; the model only ever sees this placeholder.
pub const SENSITIVE_TITLE: &str = "[private]";

/// Always-on blocklist entries, matched case-insensitively as substrings of
/// both the app name and the window title. User entries from
/// `observe_blocklist` extend (never replace) this list.
const BUILTIN_BLOCKLIST: &[&str] = &[
    // Password managers / credential stores.
    "1password",
    "keepass",
    "bitwarden",
    "keychain access",
    "lastpass",
    "enpass",
    // Login / private-browsing window titles.
    "password",
    "passphrase",
    "login",
    "sign in",
    "incognito",
    "private browsing",
    "無痕",
    "私密瀏覽",
    "登入",
    "密碼",
];

/// Whether the foreground window counts as sensitive: any builtin or user
/// blocklist entry appearing (case-insensitively) in its app name or title.
pub fn is_sensitive(app_name: &str, title: &str, extra: &[String]) -> bool {
    let app = app_name.to_lowercase();
    let title = title.to_lowercase();
    let hit = |entry: &str| {
        let e = entry.trim().to_lowercase();
        !e.is_empty() && (app.contains(&e) || title.contains(&e))
    };
    BUILTIN_BLOCKLIST.iter().any(|e| hit(e)) || extra.iter().any(|e| hit(e))
}

static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap()
});
/// 8+ digits, allowing single space/dash separators (card numbers, phones).
static DIGIT_RUN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d(?:[ -]?\d){7,}").unwrap());
/// API-key shapes: common prefixed tokens (sk-…, ghp_…) and JWTs (eyJ…).
static TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:(?:sk|pk|ghp|gho|ghs|ghr|github_pat|xox[a-z])[-_]|eyJ)[A-Za-z0-9_./+-]{8,}")
        .unwrap()
});
/// http(s):// and bare www. URLs — redacted whole (may embed tokens/paths).
static URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:https?://|www\.)\S+").unwrap());
/// Filesystem paths reduced to their basename so directory structure (home
/// dirs, usernames, project names) doesn't leak: UNC (`\\host\a\b`), Windows
/// drive (`C:\a\b`), and POSIX *absolute* paths of ≥2 segments (`/a/b`).
/// Deliberately errs toward privacy: a multi-segment *relative* path in prose
/// (`either/or/neither`) may be partly clipped, but single slashes (`and/or`,
/// `TCP/IP`) and single-segment paths (`/etc`) are left alone.
static PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\\\\[\w.$-]+(?:\\[\w .@%+~-]+)+|[A-Za-z]:\\(?:[\w .@%+~-]+\\?)+|(?:/[\w.@%+~-]+){2,}/?",
    )
    .unwrap()
});

/// Last non-empty path segment (either separator), prefixed `…/` to mark it as
/// a redacted path rather than a bare filename.
fn path_basename(path: &str) -> String {
    let seg = path
        .rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or("");
    format!("…/{seg}")
}

/// Redact URLs, filesystem paths (→ basename), emails, long digit runs, and
/// token-looking strings from any text (window titles, semantic-snapshot
/// fragments, agent transcript text) before it is stored, broadcast, or sent to
/// a model. URLs and paths go first so their embedded tokens/digits can't slip
/// past the later, narrower rules.
pub fn sanitize_text(text: &str) -> String {
    let t = URL.replace_all(text, "***");
    let t = PATH.replace_all(&t, |c: &regex::Captures| path_basename(&c[0]));
    let t = EMAIL.replace_all(&t, "***");
    let t = TOKEN.replace_all(&t, "***");
    DIGIT_RUN.replace_all(&t, "***").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocklist_matches_builtin_apps_case_insensitively() {
        assert!(is_sensitive("1Password 8", "Unlock", &[]));
        assert!(is_sensitive("KeePassXC", "database", &[]));
        assert!(is_sensitive("Safari", "GitHub — Sign In", &[]));
        assert!(is_sensitive("Google Chrome", "拍賣 — 登入", &[]));
        assert!(is_sensitive("Google Chrome", "New Tab — Incognito", &[]));
    }

    #[test]
    fn blocklist_matches_user_entries() {
        let extra = vec!["台北富邦".to_string(), "  Slack ".to_string()];
        assert!(is_sensitive("Google Chrome", "台北富邦銀行 — 首頁", &extra));
        assert!(is_sensitive("Slack", "general", &extra));
        assert!(!is_sensitive("Google Chrome", "台北天氣", &[]));
    }

    #[test]
    fn blocklist_ignores_ordinary_windows() {
        assert!(!is_sensitive("Visual Studio Code", "capture.rs — Sage", &[]));
        assert!(!is_sensitive("Terminal", "zsh — 80×24", &[]));
        // Empty user entries never match everything.
        assert!(!is_sensitive("Finder", "Documents", &["".to_string()]));
    }

    #[test]
    fn sanitize_redacts_emails() {
        assert_eq!(
            sanitize_text("Re: quote — alice.wu@example.com.tw — Mail"),
            "Re: quote — *** — Mail"
        );
    }

    #[test]
    fn sanitize_redacts_long_digit_runs() {
        assert_eq!(sanitize_text("Card 4111 1111 1111 1111 due"), "Card *** due");
        assert_eq!(sanitize_text("Call 0912-345-678"), "Call ***");
        // Short numbers survive (versions, line numbers).
        assert_eq!(sanitize_text("Sage v0.3.1 — build 42"), "Sage v0.3.1 — build 42");
    }

    #[test]
    fn sanitize_redacts_tokens() {
        assert_eq!(sanitize_text("env: sk-or-v1-abcdef1234567890"), "env: ***");
        assert_eq!(sanitize_text("ghp_ABCDEFGHIJKLMNOP — token"), "*** — token");
        assert_eq!(sanitize_text("jwt eyJhbGciOiJIUzI1NiJ9.x"), "jwt ***");
    }

    #[test]
    fn sanitize_leaves_ordinary_titles_alone() {
        let t = "capture.rs — Sage — Visual Studio Code";
        assert_eq!(sanitize_text(t), t);
    }

    #[test]
    fn sanitize_redacts_urls() {
        assert_eq!(sanitize_text("see https://example.com/a/b?t=1 now"), "see *** now");
        assert_eq!(sanitize_text("go to www.example.com/x today"), "go to *** today");
    }

    #[test]
    fn sanitize_reduces_paths_to_basename() {
        assert_eq!(
            sanitize_text("edit /home/aries/project/Sage/src/x.rs done"),
            "edit …/x.rs done"
        );
        assert_eq!(
            sanitize_text(r"open C:\Users\me\notes.txt ok"),
            "open …/notes.txt ok"
        );
        assert_eq!(
            sanitize_text(r"read \\wsl.localhost\Ubuntu\home\me\a.rs"),
            r"read …/a.rs"
        );
    }

    #[test]
    fn sanitize_leaves_non_paths_alone() {
        // Single slashes / single-segment paths are not filesystem paths.
        assert_eq!(sanitize_text("use and/or here"), "use and/or here");
        assert_eq!(sanitize_text("over TCP/IP only"), "over TCP/IP only");
        assert_eq!(sanitize_text("touch /etc please"), "touch /etc please");
    }
}
