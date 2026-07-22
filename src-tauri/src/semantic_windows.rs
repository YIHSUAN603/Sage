// Windows backend for the semantic snapshot: reads the focused window's text
// through UI Automation (no user permission required). Track W replaces this
// stub with the real implementation.

pub fn read_focused(
    _window: &crate::context::FocusedWindow,
) -> Result<super::RawSnapshot, String> {
    Err("semantic snapshot not implemented yet (Track W)".into())
}
