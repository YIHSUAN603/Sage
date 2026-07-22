// Long-term memory: <app_config_dir>/memory/<slug>.md, one markdown file per
// memory, with optional YAML-ish frontmatter (`---` fenced `key: value` lines —
// parsed by hand, no YAML dependency). Frontmatter (name + description) is the
// same shape as skills, body = the fact. Mirrors skills.rs closely: memories
// scan the dir and match by PARSED name so user input is never joined into a
// filesystem path; writes derive a safe slug from the name.
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct MemoryMeta {
    pub name: String,
    pub description: String,
}

fn memory_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?
        .join("memory");
    // Create eagerly so there is always a place to store memories.
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir memory dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn list_memories(app: tauri::AppHandle) -> Result<Vec<MemoryMeta>, String> {
    let dir = memory_dir(&app)?;
    Ok(scan_memories(&dir)
        .into_iter()
        .map(|(meta, _, _)| meta)
        .collect())
}

#[tauri::command]
pub fn read_memory(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = memory_dir(&app)?;
    scan_memories(&dir)
        .into_iter()
        .find(|(meta, _, _)| meta.name == name)
        .map(|(_, body, _)| body)
        .ok_or_else(|| format!("memory not found: {name}"))
}

#[tauri::command]
pub fn save_memory(
    app: tauri::AppHandle,
    name: String,
    description: String,
    body: String,
) -> Result<(), String> {
    let dir = memory_dir(&app)?;
    let slug = slugify(&name);
    if slug.is_empty() {
        return Err(format!("invalid memory name: {name}"));
    }
    // Only the sanitized slug is ever joined into the path.
    let path = dir.join(format!("{slug}.md"));
    let contents = format!("---\nname: {name}\ndescription: {description}\n---\n\n{body}\n");
    std::fs::write(&path, contents).map_err(|e| format!("write memory: {e}"))
}

#[tauri::command]
pub fn forget_memory(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = memory_dir(&app)?;
    let path = scan_memories(&dir)
        .into_iter()
        .find(|(meta, _, _)| meta.name == name)
        .map(|(_, _, path)| path)
        .ok_or_else(|| format!("memory not found: {name}"))?;
    // Delete the file the scan found — never reconstruct a path from `name`.
    std::fs::remove_file(&path).map_err(|e| format!("remove memory: {e}"))
}

/// Every valid memory under `dir` as (meta, body, path), sorted by filename.
/// Broken entries (dotfiles, unreadable, oversized, duplicate name) are
/// skipped, never a whole-scan failure. Files are small (≤256KB) so reading
/// bodies during a listing is fine.
fn scan_memories(dir: &Path) -> Vec<(MemoryMeta, String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("md"))
        .collect();
    files.sort();

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for file in files {
        let Some(stem) = file.file_stem().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(file_name) = file.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&file) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_BYTES {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&file) else {
            continue;
        };
        let (memory, body) = parse_memory(&raw, stem);
        if seen.insert(memory.name.clone()) {
            out.push((memory, body, file.clone()));
        }
    }
    out
}

/// Split a memory file into (meta, body). Frontmatter is optional; an
/// unterminated fence is treated as no frontmatter at all. `name` falls back to
/// the file stem when missing so a bare `.md` still works.
fn parse_memory(raw: &str, fallback_name: &str) -> (MemoryMeta, String) {
    let mut name = String::new();
    let mut description = String::new();
    let mut body_lines: Vec<&str> = Vec::new();

    let mut lines = raw.lines().peekable();
    let fenced = matches!(lines.peek(), Some(l) if l.trim() == "---");
    let mut closed = false;
    if fenced {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                closed = true;
                break;
            }
            if let Some((key, value)) = line.split_once(':') {
                let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
                match key.trim() {
                    "name" => name = value.to_string(),
                    "description" => description = value.to_string(),
                    _ => {}
                }
            }
        }
    }
    if closed {
        body_lines.extend(lines);
    } else {
        name.clear();
        description.clear();
        body_lines.extend(raw.lines());
    }

    if name.is_empty() {
        name = fallback_name.to_string();
    }
    let body = body_lines.join("\n").trim().to_string();
    (MemoryMeta { name, description }, body)
}

/// Derive a filesystem-safe slug from a memory name: lowercase, collapse each
/// run of non-`[a-z0-9]` characters to a single `-`, then trim leading and
/// trailing `-`. May return an empty string (caller must reject it).
fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::{parse_memory, slugify};

    #[test]
    fn slugify_lowercases_and_replaces_symbols() {
        assert_eq!(slugify("My Name!"), "my-name");
    }

    #[test]
    fn slugify_strips_path_traversal() {
        assert_eq!(slugify("../etc"), "etc");
    }

    #[test]
    fn slugify_collapses_and_trims_separators() {
        assert_eq!(slugify("  Hello   World  "), "hello-world");
        assert_eq!(slugify("a__b--c"), "a-b-c");
        assert_eq!(slugify("---lead-and-trail---"), "lead-and-trail");
    }

    #[test]
    fn slugify_all_symbols_is_empty() {
        assert_eq!(slugify("!!!"), "");
        assert_eq!(slugify("   "), "");
    }

    #[test]
    fn slugify_keeps_digits() {
        assert_eq!(slugify("Project 42 Notes"), "project-42-notes");
    }

    #[test]
    fn parses_frontmatter_and_body() {
        let raw =
            "---\nname: coffee-order\ndescription: \"How they take it\"\n---\n\nOat milk latte.\n";
        let (meta, body) = parse_memory(raw, "stem");
        assert_eq!(meta.name, "coffee-order");
        assert_eq!(meta.description, "How they take it");
        assert_eq!(body, "Oat milk latte.");
    }

    #[test]
    fn no_frontmatter_falls_back_to_file_stem() {
        let (meta, body) = parse_memory("Just a fact.", "my-memory");
        assert_eq!(meta.name, "my-memory");
        assert_eq!(meta.description, "");
        assert_eq!(body, "Just a fact.");
    }

    #[test]
    fn missing_name_falls_back_missing_description_is_empty() {
        let raw = "---\nother: x\n---\nBody here.";
        let (meta, body) = parse_memory(raw, "fallback");
        assert_eq!(meta.name, "fallback");
        assert_eq!(meta.description, "");
        assert_eq!(body, "Body here.");
    }

    #[test]
    fn unterminated_fence_is_all_body() {
        let raw = "---\nname: broken\nno closing fence";
        let (meta, body) = parse_memory(raw, "stem");
        assert_eq!(meta.name, "stem");
        assert_eq!(body, raw);
    }

    #[test]
    fn description_with_colons_survives_split_once() {
        let raw = "---\nname: a\ndescription: use when: always, why: because\n---\nb";
        let (meta, _) = parse_memory(raw, "f");
        assert_eq!(meta.description, "use when: always, why: because");
    }

    #[test]
    fn save_format_round_trips_through_parse() {
        // Mirror what save_memory writes, then parse it back.
        let name = "Trip Plan";
        let description = "Where to go";
        let body = "Kyoto in spring.";
        let written = format!("---\nname: {name}\ndescription: {description}\n---\n\n{body}\n");
        let (meta, parsed_body) = parse_memory(&written, "trip-plan");
        assert_eq!(meta.name, name);
        assert_eq!(meta.description, description);
        assert_eq!(parsed_body, body);
    }
}
