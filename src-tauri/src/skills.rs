// Skill discovery: <app_config_dir>/skills/<dir>/SKILL.md, each with optional
// YAML-ish frontmatter (`---` fenced `key: value` lines — parsed by hand, no
// YAML dependency). `list_skills` returns the metadata catalog; `read_skill`
// returns one skill's body, matched by parsed name so user input is never
// joined into a filesystem path.
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
}

fn skills_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?
        .join("skills");
    // Create eagerly so users have a place to drop skills into.
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir skills dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn list_skills(app: tauri::AppHandle) -> Result<Vec<SkillMeta>, String> {
    let dir = skills_dir(&app)?;
    Ok(scan_skills(&dir).into_iter().map(|(meta, _)| meta).collect())
}

#[tauri::command]
pub fn read_skill(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = skills_dir(&app)?;
    scan_skills(&dir)
        .into_iter()
        .find(|(meta, _)| meta.name == name)
        .map(|(_, body)| body)
        .ok_or_else(|| format!("skill not found: {name}"))
}

/// Every valid skill under `dir` as (meta, body), sorted by folder name.
/// Broken entries (unreadable, oversized, duplicate name) are skipped, never
/// a whole-scan failure. Files are small (≤256KB) so reading bodies during a
/// listing is fine.
fn scan_skills(dir: &Path) -> Vec<(SkillMeta, String)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut folders: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    folders.sort();

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for folder in folders {
        let Some(folder_name) = folder.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if folder_name.starts_with('.') {
            continue;
        }
        let md = folder.join("SKILL.md");
        let Ok(meta) = std::fs::metadata(&md) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_BYTES {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&md) else {
            continue;
        };
        let (skill, body) = parse_skill(&raw, folder_name);
        if seen.insert(skill.name.clone()) {
            out.push((skill, body));
        }
    }
    out
}

/// Split SKILL.md into (meta, body). Frontmatter is optional; an unterminated
/// fence is treated as no frontmatter at all. `name` falls back to the folder
/// name when missing so a bare SKILL.md still works.
fn parse_skill(raw: &str, fallback_name: &str) -> (SkillMeta, String) {
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
    (SkillMeta { name, description }, body)
}

#[cfg(test)]
mod tests {
    use super::parse_skill;

    #[test]
    fn parses_frontmatter_and_body() {
        let raw = "---\nname: pirate-talk\ndescription: \"Answer like a pirate\"\n---\n\nAlways say arr.\n";
        let (meta, body) = parse_skill(raw, "folder");
        assert_eq!(meta.name, "pirate-talk");
        assert_eq!(meta.description, "Answer like a pirate");
        assert_eq!(body, "Always say arr.");
    }

    #[test]
    fn no_frontmatter_falls_back_to_folder_name() {
        let (meta, body) = parse_skill("Just instructions.", "my-skill");
        assert_eq!(meta.name, "my-skill");
        assert_eq!(meta.description, "");
        assert_eq!(body, "Just instructions.");
    }

    #[test]
    fn missing_name_falls_back_missing_description_is_empty() {
        let raw = "---\nother: x\n---\nBody here.";
        let (meta, body) = parse_skill(raw, "fallback");
        assert_eq!(meta.name, "fallback");
        assert_eq!(meta.description, "");
        assert_eq!(body, "Body here.");
    }

    #[test]
    fn unterminated_fence_is_all_body() {
        let raw = "---\nname: broken\nno closing fence";
        let (meta, body) = parse_skill(raw, "folder");
        assert_eq!(meta.name, "folder");
        assert_eq!(body, raw);
    }

    #[test]
    fn description_with_colons_survives_split_once() {
        let raw = "---\nname: a\ndescription: use when: always, why: because\n---\nb";
        let (meta, _) = parse_skill(raw, "f");
        assert_eq!(meta.description, "use when: always, why: because");
    }
}
