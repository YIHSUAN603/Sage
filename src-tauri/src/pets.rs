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

    let name = validate_atlas_name(&pet.spritesheet_path)?;
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

/// spritesheetPath is a bare filename per the contract — reject anything that
/// could climb out of the pet folder. Returns the trimmed name on success.
fn validate_atlas_name(raw: &str) -> Result<&str, String> {
    let name = raw.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("invalid spritesheetPath: {name}"));
    }
    Ok(name)
}

/// Import a pet folder (a `pet.json` + its spritesheet, as hatch-pet emits)
/// into `<config>/pets/`, then return its catalog entry so the caller can
/// select it. Copies only the two known files, never the whole folder. A pet
/// whose id already exists is overwritten (re-import updates it).
#[tauri::command]
pub fn import_pet(app: tauri::AppHandle, source_path: String) -> Result<PetMeta, String> {
    let dir = pets_dir(&app)?;
    import_pet_into(Path::new(&source_path), &dir)
}

/// The AppHandle-free core of `import_pet`, so it can be unit-tested against a
/// temp directory.
fn import_pet_into(source: &Path, pets_dir: &Path) -> Result<PetMeta, String> {
    let manifest = source.join("pet.json");
    let meta = std::fs::metadata(&manifest).map_err(|_| "no pet.json in that folder".to_string())?;
    if !meta.is_file() || meta.len() > MAX_MANIFEST_BYTES {
        return Err("pet.json missing or too large".into());
    }
    let raw = std::fs::read_to_string(&manifest).map_err(|e| format!("read pet.json: {e}"))?;
    let fallback_id = source.file_name().and_then(|n| n.to_str()).unwrap_or("pet");
    let pet = parse_manifest(&raw, fallback_id).ok_or("not a valid pet.json")?;

    // Validate + locate the spritesheet in the source folder.
    let atlas_name = validate_atlas_name(&pet.spritesheet_path)?;
    let atlas_src = source.join(atlas_name);
    let atlas_meta =
        std::fs::metadata(&atlas_src).map_err(|_| "spritesheet not found".to_string())?;
    if !atlas_meta.is_file() {
        return Err("spritesheet is not a file".into());
    }
    if atlas_meta.len() > MAX_ATLAS_BYTES {
        return Err("spritesheet too large".into());
    }

    // Destination folder = filesystem-safe slug of the id (lookups match by
    // parsed id, so the folder name is only cosmetic — keep it tidy & safe).
    let slug = slugify(&pet.id);
    let dest = pets_dir.join(&slug);
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| format!("replace existing pet: {e}"))?;
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("create pet dir: {e}"))?;
    std::fs::copy(&manifest, dest.join("pet.json")).map_err(|e| format!("copy pet.json: {e}"))?;
    std::fs::copy(&atlas_src, dest.join(atlas_name))
        .map_err(|e| format!("copy spritesheet: {e}"))?;

    Ok(PetMeta {
        id: pet.id,
        display_name: pet.display_name,
        description: pet.description,
    })
}

/// Keep only ASCII alphanumerics, '-' and '_'; other chars become '-'.
/// Never empty (falls back to "pet") so the destination path is always valid.
fn slugify(id: &str) -> String {
    let s: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "pet".into()
    } else {
        s
    }
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
    use super::{import_pet_into, parse_manifest, slugify};
    use std::path::PathBuf;

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

    #[test]
    fn slugify_keeps_safe_chars_and_never_empty() {
        assert_eq!(slugify("hatchling"), "hatchling");
        assert_eq!(slugify("小龍/../x"), "x");
        assert_eq!(slugify("///"), "pet");
    }

    /// A unique scratch dir under the OS temp dir; removed on drop.
    struct TmpDir(PathBuf);
    impl TmpDir {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "sage-pets-{tag}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ));
            std::fs::create_dir_all(&base).unwrap();
            TmpDir(base)
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write_source_pet(dir: &std::path::Path, id: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("pet.json"),
            format!(
                r#"{{ "id": "{id}", "displayName": "小龍", "description": "d", "spritesheetPath": "spritesheet.webp" }}"#
            ),
        )
        .unwrap();
        std::fs::write(dir.join("spritesheet.webp"), b"fake-webp-bytes").unwrap();
    }

    #[test]
    fn import_copies_manifest_and_spritesheet() {
        let tmp = TmpDir::new("copy");
        let source = tmp.0.join("src-dragon");
        let pets = tmp.0.join("pets");
        std::fs::create_dir_all(&pets).unwrap();
        write_source_pet(&source, "dragon");

        let meta = import_pet_into(&source, &pets).unwrap();
        assert_eq!(meta.id, "dragon");
        assert_eq!(meta.display_name, "小龍");
        let dest = pets.join("dragon");
        assert!(dest.join("pet.json").is_file());
        assert!(dest.join("spritesheet.webp").is_file());
    }

    #[test]
    fn reimport_overwrites_existing_pet() {
        let tmp = TmpDir::new("overwrite");
        let pets = tmp.0.join("pets");
        std::fs::create_dir_all(&pets).unwrap();

        let src1 = tmp.0.join("v1");
        write_source_pet(&src1, "dragon");
        import_pet_into(&src1, &pets).unwrap();
        // A stray file from a previous import must not survive the overwrite.
        std::fs::write(pets.join("dragon").join("stale.txt"), b"x").unwrap();

        let src2 = tmp.0.join("v2");
        write_source_pet(&src2, "dragon");
        import_pet_into(&src2, &pets).unwrap();

        assert!(pets.join("dragon").join("pet.json").is_file());
        assert!(!pets.join("dragon").join("stale.txt").exists());
    }

    #[test]
    fn import_rejects_folder_without_manifest() {
        let tmp = TmpDir::new("nomanifest");
        let source = tmp.0.join("empty");
        std::fs::create_dir_all(&source).unwrap();
        let pets = tmp.0.join("pets");
        std::fs::create_dir_all(&pets).unwrap();
        assert!(import_pet_into(&source, &pets).is_err());
    }

    #[test]
    fn import_rejects_missing_spritesheet() {
        let tmp = TmpDir::new("noatlas");
        let source = tmp.0.join("src");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("pet.json"),
            r#"{ "id": "x", "spritesheetPath": "spritesheet.webp" }"#,
        )
        .unwrap();
        let pets = tmp.0.join("pets");
        std::fs::create_dir_all(&pets).unwrap();
        assert!(import_pet_into(&source, &pets).is_err());
    }
}
