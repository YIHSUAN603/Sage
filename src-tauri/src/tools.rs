// Built-in local tools the agent can call. Each is a plain command the frontend
// tool registry maps a ToolSpec onto. Sprint 1 ships `read_file`.
use std::path::Path;

const MAX_BYTES: u64 = 256 * 1024;

#[tauri::command]
pub fn tool_read_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("file not found: {path}"));
    }
    if !p.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("stat failed: {e}"))?;
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "file too large ({} bytes, max {})",
            meta.len(),
            MAX_BYTES
        ));
    }
    std::fs::read_to_string(p).map_err(|e| format!("read failed: {e}"))
}
