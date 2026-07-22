// macOS (and Linux desktop) launch GUI apps with a minimal PATH
// (/usr/bin:/bin:...), so agent CLIs installed via Homebrew, npm, or the
// native installers are invisible to Command::new when Sage is started from
// Finder/Dock. Rebuild PATH once at startup: ask the user's login shell for
// its PATH, then append well-known install dirs the login shell might still
// miss. Every later Command::new inherits the fixed value.

#[cfg(not(windows))]
pub fn fix() {
    let mut paths: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect();

    let mut add = |p: String| {
        if !p.is_empty() && !paths.iter().any(|existing| existing == &p) {
            paths.push(p);
        }
    };

    if let Some(shell_path) = login_shell_path() {
        shell_path.split(':').for_each(|p| add(p.to_string()));
    }

    // Fallbacks for when the login shell probe fails or the user's profile
    // doesn't export these (e.g. nvm/volta init living in .zshrc only).
    let home = std::env::var("HOME").unwrap_or_default();
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        &format!("{home}/.local/bin"),
        &format!("{home}/.npm-global/bin"),
        &format!("{home}/.volta/bin"),
        &format!("{home}/.bun/bin"),
        &format!("{home}/.cargo/bin"),
    ] {
        add(dir.to_string());
    }
    if let Some(nvm_bin) = newest_nvm_bin(&home) {
        add(nvm_bin);
    }

    std::env::set_var("PATH", paths.join(":"));
}

#[cfg(windows)]
pub fn fix() {}

/// PATH as the user's login shell sees it. A sentinel marks our printf output
/// so anything the profile itself prints to stdout is ignored.
#[cfg(not(windows))]
fn login_shell_path() -> Option<String> {
    const MARKER: &str = "__SAGE_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(shell)
        .args(["-lc", &format!("printf '{MARKER}%s' \"$PATH\"")])
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout.rsplit(MARKER).next()?.trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// nvm doesn't touch login-shell PATH (its init lives in .zshrc), so pick the
/// highest installed node version's bin dir directly.
#[cfg(not(windows))]
fn newest_nvm_bin(home: &str) -> Option<String> {
    let versions = std::path::Path::new(home).join(".nvm/versions/node");
    let mut dirs: Vec<_> = std::fs::read_dir(versions)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    // Semver-ish sort: v10 must not beat v9 lexically.
    dirs.sort_by_key(|p| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        name.trim_start_matches('v')
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    });
    dirs.pop().map(|p| p.join("bin").to_string_lossy().into_owned())
}
