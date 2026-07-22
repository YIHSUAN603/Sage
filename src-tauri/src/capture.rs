// S1.4 — Screen capture for the observation subsystem.
// Grabs the focused window (default) or the primary monitor, downscales to
// width <= 1024, encodes JPEG (~70) and returns a data URL. The image lives
// only in memory — never written to disk. Refuses outright when observation
// is disabled in settings or the foreground window is blocklisted as
// sensitive (password managers, login pages, private browsing…).
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use std::io::Cursor;

const MAX_WIDTH: u32 = 1024;
const JPEG_QUALITY: u8 = 70;

/// Guidance appended when capture fails — on macOS this is almost always a
/// missing Screen Recording permission (TCC).
const MACOS_PERMISSION_HINT: &str =
    "螢幕擷取失敗。若在 macOS 上，需要在 系統設定→隱私權與安全性→螢幕錄製 授權本 App 後重新啟動";

#[tauri::command]
pub fn capture_screen(app: tauri::AppHandle) -> Result<String, String> {
    let settings = crate::settings::load(&app);
    if !settings.observe_enabled {
        // Message must match src/ipc/mock.ts.
        return Err("observation disabled".into());
    }

    // Privacy gate: never photograph a sensitive foreground window. The
    // frontend gate falls back to title-only mode on any capture error, and
    // active_window() masks the title of blocklisted windows on its own.
    // One lookup serves both the gate and the capture target, so the window
    // that passed the blocklist is the window that gets photographed.
    let focused = crate::context::current_focused();
    if let Some(w) = &focused {
        if crate::privacy::is_sensitive(&w.app_name, &w.title, &settings.observe_blocklist) {
            // Message must match src/ipc/mock.ts.
            return Err("sensitive window".into());
        }
    }

    let rgba = if settings.observe_capture_mode == "screen" {
        capture_primary_screen()?
    } else {
        // Default "window": only the focused window enters the frame, so
        // background windows (messages, banking tabs…) never leak. Falls back
        // to the full screen when no focused window is found (e.g. desktop).
        capture_focused_window(focused.as_ref().and_then(|w| w.window_id))
            .or_else(|_| capture_primary_screen())?
    };

    // Downscale proportionally to width <= 1024 (saves tokens, lowers detail
    // sensitivity), then drop alpha for JPEG.
    let img = image::DynamicImage::ImageRgba8(rgba);
    let img = if img.width() > MAX_WIDTH {
        img.resize(MAX_WIDTH, u32::MAX, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let rgb = img.to_rgb8();

    let mut jpeg: Vec<u8> = Vec::new();
    JpegEncoder::new_with_quality(Cursor::new(&mut jpeg), JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| format!("JPEG encode failed: {e}"))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

/// Capture the focused window: the exact window id the foreground probe
/// reported (the one the blocklist just cleared). xcap's own is_focused()
/// only compares owner PIDs — every window of the frontmost app matches, and
/// z-order then picks whichever panel floats on top — so it serves only as a
/// fallback when the id is missing or stale.
fn capture_focused_window(window_id: Option<u32>) -> Result<image::RgbaImage, String> {
    let windows = xcap::Window::all().map_err(|e| format!("{MACOS_PERMISSION_HINT}（{e}）"))?;
    let focused = window_id
        .and_then(|id| windows.iter().find(|w| w.id().ok() == Some(id)))
        .or_else(|| windows.iter().find(|w| w.is_focused().unwrap_or(false)))
        .ok_or_else(|| "no focused window".to_string())?;
    focused
        .capture_image()
        .map_err(|e| format!("{MACOS_PERMISSION_HINT}（{e}）"))
}

fn capture_primary_screen() -> Result<image::RgbaImage, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("{MACOS_PERMISSION_HINT}（{e}）"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| format!("{MACOS_PERMISSION_HINT}（找不到主螢幕）"))?;
    monitor
        .capture_image()
        .map_err(|e| format!("{MACOS_PERMISSION_HINT}（{e}）"))
}
