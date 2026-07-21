// Pet (companion) discovery: <app_config_dir>/pets/<dir>/pet.json, following
// the Codex "pet" contract that OpenAI's `hatch-pet` skill emits — a JSON
// manifest (`id` / `displayName` / `description` / `spritesheetPath`) plus a
// spritesheet image. The optional `sage` block is our additive extension
// (persona + proactive tuning); Codex ignores unknown keys, and a plain
// hatch-pet folder with no `sage` block still loads.
//
// Mirrors skills.rs: `list_pets` returns the catalog, `read_pet` returns one
// parsed manifest, `read_pet_atlas` returns the spritesheet as a base64 data
// URL (same approach as capture.rs — no asset protocol / fs plugin needed).
// Lookups match by parsed id so user input is never joined into a path.
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ATLAS_BYTES: u64 = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Wire shapes (serialized to the frontend in camelCase to match contract.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetMeta {
    pub id: String,
    pub display_name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pet {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub spritesheet_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proactive: Option<Proactive>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proactive {
    #[serde(default)]
    pub cooldown_minutes: Option<f64>,
    #[serde(default)]
    pub max_per_hour: Option<u32>,
}

// ---------------------------------------------------------------------------
// pet.json shape (Codex contract keys + optional `sage` extension)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawManifest {
    #[serde(default)]
    id: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    spritesheet_path: String,
    #[serde(default)]
    sage: Option<SageExt>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SageExt {
    #[serde(default)]
    persona: Option<String>,
    #[serde(default)]
    proactive: Option<Proactive>,
}

fn pets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?
        .join("pets");
    // Create eagerly so users have a place to drop pet folders into.
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir pets dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn list_pets(app: tauri::AppHandle) -> Result<Vec<PetMeta>, String> {
    let dir = pets_dir(&app)?;
    Ok(scan_pets(&dir)
        .into_iter()
        .map(|(pet, _)| PetMeta {
            id: pet.id,
            display_name: pet.display_name,
            description: pet.description,
        })
        .collect())
}

#[tauri::command]
pub fn read_pet(app: tauri::AppHandle, id: String) -> Result<Pet, String> {
    let dir = pets_dir(&app)?;
    scan_pets(&dir)
        .into_iter()
        .map(|(pet, _)| pet)
        .find(|pet| pet.id == id)
        .ok_or_else(|| format!("pet not found: {id}"))
}

#[tauri::command]
pub fn read_pet_atlas(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let dir = pets_dir(&app)?;
    let (pet, folder) = scan_pets(&dir)
        .into_iter()
        .find(|(pet, _)| pet.id == id)
        .ok_or_else(|| format!("pet not found: {id}"))?;

    // spritesheetPath is a bare filename per the contract — reject anything
    // that could climb out of the pet folder.
    let name = pet.spritesheet_path.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("invalid spritesheetPath: {name}"));
    }
    let path = folder.join(name);
    let meta = std::fs::metadata(&path).map_err(|e| format!("atlas not found: {e}"))?;
    if !meta.is_file() {
        return Err("atlas is not a file".into());
    }
    if meta.len() > MAX_ATLAS_BYTES {
        return Err("atlas too large".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read atlas: {e}"))?;
    let mime = if name.to_ascii_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/webp"
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Every valid pet under `dir` as (pet, folder), sorted by folder name.
/// Broken entries (unreadable, oversized, invalid JSON, duplicate id) are
/// skipped, never a whole-scan failure — same policy as scan_skills.
fn scan_pets(dir: &Path) -> Vec<(Pet, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut folders: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    folders.sort();

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for folder in folders {
        let Some(folder_name) = folder.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if folder_name.starts_with('.') {
            continue;
        }
        let manifest = folder.join("pet.json");
        let Ok(meta) = std::fs::metadata(&manifest) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_MANIFEST_BYTES {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&manifest) else {
            continue;
        };
        let Some(pet) = parse_manifest(&raw, folder_name) else {
            continue;
        };
        if seen.insert(pet.id.clone()) {
            out.push((pet, folder));
        }
    }
    out
}

/// Parse pet.json into a Pet. `id` falls back to the folder name and
/// `displayName` falls back to the id, so a minimal manifest still works.
/// Returns None on invalid JSON (the folder is then skipped). An empty/blank
/// persona is treated as absent so it falls back to a synthesized one.
fn parse_manifest(raw: &str, fallback_id: &str) -> Option<Pet> {
    let m: RawManifest = serde_json::from_str(raw).ok()?;
    let id = if m.id.trim().is_empty() {
        fallback_id.to_string()
    } else {
        m.id
    };
    let display_name = if m.display_name.trim().is_empty() {
        id.clone()
    } else {
        m.display_name
    };
    let (persona, proactive) = match m.sage {
        Some(s) => (s.persona.filter(|p| !p.trim().is_empty()), s.proactive),
        None => (None, None),
    };
    Some(Pet {
        id,
        display_name,
        description: m.description,
        spritesheet_path: m.spritesheet_path,
        persona,
        proactive,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_manifest;

    #[test]
    fn parses_full_manifest_with_sage_block() {
        let raw = r#"{
            "id": "hatchling",
            "displayName": "小龍",
            "description": "一隻剛孵化的小龍",
            "spritesheetPath": "spritesheet.webp",
            "sage": {
                "persona": "你是小龍",
                "proactive": { "cooldownMinutes": 5, "maxPerHour": 6 }
            }
        }"#;
        let pet = parse_manifest(raw, "folder").unwrap();
        assert_eq!(pet.id, "hatchling");
        assert_eq!(pet.display_name, "小龍");
        assert_eq!(pet.spritesheet_path, "spritesheet.webp");
        assert_eq!(pet.persona.as_deref(), Some("你是小龍"));
        let p = pet.proactive.unwrap();
        assert_eq!(p.cooldown_minutes, Some(5.0));
        assert_eq!(p.max_per_hour, Some(6));
    }

    #[test]
    fn plain_hatch_pet_folder_without_sage_block_loads() {
        let raw = r#"{
            "id": "pet",
            "displayName": "Pet",
            "description": "d",
            "spritesheetPath": "spritesheet.webp"
        }"#;
        let pet = parse_manifest(raw, "folder").unwrap();
        assert_eq!(pet.display_name, "Pet");
        assert!(pet.persona.is_none());
        assert!(pet.proactive.is_none());
    }

    #[test]
    fn missing_id_falls_back_to_folder_and_displayname_to_id() {
        let raw = r#"{ "description": "d", "spritesheetPath": "s.webp" }"#;
        let pet = parse_manifest(raw, "my-pet").unwrap();
        assert_eq!(pet.id, "my-pet");
        assert_eq!(pet.display_name, "my-pet");
    }

    #[test]
    fn blank_persona_is_treated_as_absent() {
        let raw = r#"{ "id": "a", "sage": { "persona": "   " } }"#;
        let pet = parse_manifest(raw, "f").unwrap();
        assert!(pet.persona.is_none());
    }

    #[test]
    fn invalid_json_is_skipped() {
        assert!(parse_manifest("not json", "f").is_none());
    }
}
