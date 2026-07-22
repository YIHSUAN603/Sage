// macOS backend for the semantic snapshot: reads the focused window's text
// through the Accessibility API (AXUIElement). Requires the 輔助使用
// (Accessibility) TCC permission — NOT Screen Recording, which Sage no longer
// uses. Track M replaces this stub with the real implementation.

/// Guidance surfaced when the AX read fails — on macOS this is almost always a
/// missing Accessibility permission (TCC).
#[allow(dead_code)]
const MACOS_PERMISSION_HINT: &str =
    "無法讀取視窗內容。請在 系統設定→隱私權與安全性→輔助使用 授權本 App";

pub fn read_focused(
    _window: &crate::context::FocusedWindow,
) -> Result<super::RawSnapshot, String> {
    Err("semantic snapshot not implemented yet (Track M)".into())
}
