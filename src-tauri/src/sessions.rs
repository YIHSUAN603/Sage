// Conversation persistence. The single continuous conversation lives at
// <app_config_dir>/session.json as a JSON array of opaque messages; "Clear"
// archives it to <app_config_dir>/sessions/<id>.json. Payloads are opaque
// serde_json::Value arrays — this module never defines or parses a ChatMessage.
//
// Command fns resolve the config dir from the AppHandle and delegate to pure
// `&Path` helpers so the core logic is unit-testable against a temp dir.
// Archive ids come from SystemTime epoch millis (no chrono in the tree) and are
// zero-padded so lexical sort == chronological. Following skills.rs: reads and
// deletes only ever touch ids produced by a fresh scan of the sessions dir —
// user input is never joined into a filesystem path.
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct ArchiveMeta {
    pub id: String,
    pub saved_at: String,
    pub message_count: u64,
}

/// Resolve (and eagerly create) the app config dir holding session.json.
fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir config dir: {e}"))?;
    Ok(dir)
}

fn session_file(dir: &Path) -> PathBuf {
    dir.join("session.json")
}

fn archives_dir(dir: &Path) -> PathBuf {
    dir.join("sessions")
}

/// Length of a JSON array Value; 0 for anything that isn't an array.
fn message_count(value: &Value) -> u64 {
    value.as_array().map(|a| a.len() as u64).unwrap_or(0)
}

/// Epoch millis extracted from a `session-{:013}` id, if it parses.
fn millis_from_id(id: &str) -> Option<u64> {
    id.strip_prefix("session-")?.parse::<u64>().ok()
}

/// A human-ish ISO string derived from epoch millis. Pure integer date math so
/// no chrono dependency is needed; the frontend only displays this.
fn iso_from_millis(millis: u64) -> String {
    let secs = millis / 1000;
    let ms = millis % 1000;
    let days = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let (hh, mm, ss) = (secs_of_day / 3600, (secs_of_day % 3600) / 60, secs_of_day % 60);

    // Civil-from-days algorithm (Howard Hinnant), epoch 1970-01-01.
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, m, d, hh, mm, ss, ms
    )
}

/// Current epoch millis.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- pure helpers (take a dir, testable) ----------------------------------

fn load_session_at(dir: &Path) -> Value {
    // Never error on absence or unparseable content.
    std::fs::read_to_string(session_file(dir))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(|v| v.is_array())
        .unwrap_or_else(|| Value::Array(Vec::new()))
}

fn save_session_at(dir: &Path, messages: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(messages).map_err(|e| e.to_string())?;
    std::fs::write(session_file(dir), json).map_err(|e| format!("write session: {e}"))
}

fn archive_session_at(dir: &Path) -> Result<Option<ArchiveMeta>, String> {
    let current = load_session_at(dir);
    let count = message_count(&current);
    if count == 0 {
        // Absent or empty array ⇒ nothing to archive.
        return Ok(None);
    }

    let millis = now_millis();
    let id = format!("session-{:013}", millis);
    let saved_at = iso_from_millis(millis);

    let sessions = archives_dir(dir);
    std::fs::create_dir_all(&sessions).map_err(|e| format!("mkdir sessions dir: {e}"))?;
    let json = serde_json::to_string_pretty(&current).map_err(|e| e.to_string())?;
    std::fs::write(sessions.join(format!("{id}.json")), json)
        .map_err(|e| format!("write archive: {e}"))?;

    // Empty the current session (write [] rather than leaving stale content).
    save_session_at(dir, &Value::Array(Vec::new()))?;

    Ok(Some(ArchiveMeta {
        id,
        saved_at,
        message_count: count,
    }))
}

/// Every valid archive under the sessions dir. Unreadable/oddly-named entries
/// are skipped, never a whole-scan failure. Returned newest-first (reverse
/// lexical by id — ids are zero-padded so lexical == chronological).
fn scan_archives(dir: &Path) -> Vec<ArchiveMeta> {
    let sessions = archives_dir(dir);
    let Ok(entries) = std::fs::read_dir(&sessions) else {
        return Vec::new();
    };
    let mut out: Vec<ArchiveMeta> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|p| {
            let stem = p.file_stem().and_then(|s| s.to_str())?.to_string();
            let count = std::fs::read_to_string(&p)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .map(|v| message_count(&v))
                .unwrap_or(0);
            let saved_at = millis_from_id(&stem)
                .map(iso_from_millis)
                .unwrap_or_else(|| stem.clone());
            Some(ArchiveMeta {
                id: stem,
                saved_at,
                message_count: count,
            })
        })
        .collect();
    // Newest first: reverse lexical by id.
    out.sort_by(|a, b| b.id.cmp(&a.id));
    out
}

fn read_archive_at(dir: &Path, id: &str) -> Result<Value, String> {
    // SECURITY: only ids the scan itself produced are acceptable, so a caller
    // can never steer the read outside the sessions dir (no `..`, no `/`).
    if !scan_archives(dir).iter().any(|m| m.id == id) {
        return Err(format!("archive not found: {id}"));
    }
    let path = archives_dir(dir).join(format!("{id}.json"));
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read archive: {e}"))?;
    serde_json::from_str::<Value>(&raw).map_err(|e| format!("parse archive: {e}"))
}

fn delete_archive_at(dir: &Path, id: &str) -> Result<(), String> {
    if !scan_archives(dir).iter().any(|m| m.id == id) {
        return Err(format!("archive not found: {id}"));
    }
    let path = archives_dir(dir).join(format!("{id}.json"));
    std::fs::remove_file(&path).map_err(|e| format!("delete archive: {e}"))
}

// ---- frozen commands (resolve dir, delegate) ------------------------------

#[tauri::command]
pub fn load_session(app: tauri::AppHandle) -> Result<Value, String> {
    let dir = config_dir(&app)?;
    Ok(load_session_at(&dir))
}

#[tauri::command]
pub fn save_session(app: tauri::AppHandle, messages: Value) -> Result<(), String> {
    let dir = config_dir(&app)?;
    save_session_at(&dir, &messages)
}

#[tauri::command]
pub fn archive_session(app: tauri::AppHandle) -> Result<Option<ArchiveMeta>, String> {
    let dir = config_dir(&app)?;
    archive_session_at(&dir)
}

#[tauri::command]
pub fn list_archives(app: tauri::AppHandle) -> Result<Vec<ArchiveMeta>, String> {
    let dir = config_dir(&app)?;
    Ok(scan_archives(&dir))
}

#[tauri::command]
pub fn read_archive(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let dir = config_dir(&app)?;
    read_archive_at(&dir, &id)
}

#[tauri::command]
pub fn delete_archive(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = config_dir(&app)?;
    delete_archive_at(&dir, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    /// A unique temp dir that cleans itself up on drop.
    struct TmpDir(PathBuf);
    impl TmpDir {
        fn new() -> Self {
            static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "sage-sessions-test-{}-{}-{}",
                std::process::id(),
                now_millis(),
                n
            ));
            std::fs::create_dir_all(&dir).expect("mkdir tmp");
            TmpDir(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn save_load_round_trip() {
        let tmp = TmpDir::new();
        let dir = tmp.path();

        // Absent file ⇒ empty array, never an error.
        assert_eq!(load_session_at(dir), json!([]));

        let msgs = json!([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}]);
        save_session_at(dir, &msgs).expect("save");
        assert_eq!(load_session_at(dir), msgs);
    }

    #[test]
    fn load_of_garbage_is_empty_array() {
        let tmp = TmpDir::new();
        std::fs::write(session_file(tmp.path()), "not json {{{").unwrap();
        assert_eq!(load_session_at(tmp.path()), json!([]));
    }

    #[test]
    fn archive_moves_content_empties_current_and_lists() {
        let tmp = TmpDir::new();
        let dir = tmp.path();

        let msgs = json!([{"m": 1}, {"m": 2}, {"m": 3}]);
        save_session_at(dir, &msgs).expect("save");

        let meta = archive_session_at(dir).expect("archive").expect("some meta");
        assert_eq!(meta.message_count, 3);
        assert!(meta.id.starts_with("session-"));

        // Current session is now empty.
        assert_eq!(load_session_at(dir), json!([]));

        // The archive shows in the list and its content is intact.
        let list = scan_archives(dir);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, meta.id);
        assert_eq!(list[0].message_count, 3);
        assert_eq!(read_archive_at(dir, &meta.id).expect("read"), msgs);
    }

    #[test]
    fn archive_of_empty_or_absent_returns_none() {
        let tmp = TmpDir::new();
        let dir = tmp.path();

        // Absent session.json.
        assert!(archive_session_at(dir).expect("archive absent").is_none());

        // Explicitly empty array.
        save_session_at(dir, &json!([])).expect("save empty");
        assert!(archive_session_at(dir).expect("archive empty").is_none());

        // Nothing got written to the sessions dir.
        assert!(scan_archives(dir).is_empty());
    }

    #[test]
    fn list_sorts_newest_first() {
        let tmp = TmpDir::new();
        let sessions = archives_dir(tmp.path());
        std::fs::create_dir_all(&sessions).unwrap();
        // Three ids in ascending time order.
        for id in ["session-0000000001000", "session-0000000002000", "session-0000000003000"] {
            std::fs::write(sessions.join(format!("{id}.json")), "[]").unwrap();
        }
        let list = scan_archives(tmp.path());
        let ids: Vec<_> = list.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "session-0000000003000",
                "session-0000000002000",
                "session-0000000001000"
            ]
        );
    }

    #[test]
    fn read_and_delete_reject_traversal_and_unknown_ids() {
        let tmp = TmpDir::new();
        let dir = tmp.path();

        // Create one real archive.
        save_session_at(dir, &json!([{"a": 1}])).unwrap();
        let meta = archive_session_at(dir).unwrap().unwrap();

        // Path traversal / separators / unknown ids are all rejected.
        for bad in [
            "..",
            "../../etc/passwd",
            "sessions/../session",
            "foo/bar",
            "unknown-id",
            &format!("{}/..", meta.id),
        ] {
            assert!(read_archive_at(dir, bad).is_err(), "read should reject {bad}");
            assert!(
                delete_archive_at(dir, bad).is_err(),
                "delete should reject {bad}"
            );
        }

        // The real one still reads (nothing was deleted).
        assert!(read_archive_at(dir, &meta.id).is_ok());

        // And deleting the real one works, after which it's gone.
        delete_archive_at(dir, &meta.id).expect("delete real");
        assert!(read_archive_at(dir, &meta.id).is_err());
        assert!(scan_archives(dir).is_empty());
    }

    #[test]
    fn iso_from_millis_is_reasonable() {
        // 2021-01-01T00:00:00.000Z == 1609459200000 ms.
        assert_eq!(iso_from_millis(1_609_459_200_000), "2021-01-01T00:00:00.000Z");
        // Epoch.
        assert_eq!(iso_from_millis(0), "1970-01-01T00:00:00.000Z");
    }
}
