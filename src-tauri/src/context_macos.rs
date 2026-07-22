// macOS foreground-window backend. Deliberately avoids
// CGWindowListCopyWindowInfo (what active-win-pos-rs uses on this platform):
// its `kCGWindowName` field is the only thing Sage ever wanted from it, and
// since macOS 10.15 reading another app's window name costs the Screen
// Recording TCC permission — a second, much scarier-sounding prompt for data
// the Accessibility permission already covers. Here instead:
//
//   app name + pid  ← NSWorkspace.frontmostApplication  (no permission at all)
//   window title    ← AX AXFocusedWindow/AXTitle        (輔助使用 / Accessibility)
//
// so the whole observation subsystem asks for exactly one permission, and
// degrades to app-name-only — not to nothing — when it is not granted.
use objc2_app_kit::NSWorkspace;

pub fn current_focused() -> Option<crate::context::FocusedWindow> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let app_name = app.localizedName()?.to_string();
    let pid = app.processIdentifier();
    if pid <= 0 {
        return None;
    }

    // Title lives in the AX module so the AXUIElement FFI stays declared in
    // exactly one place. Absent (no permission / no focused window) degrades
    // to an empty title, which the blocklist and sanitizer both handle.
    let title = crate::semantic::platform::focused_window_title(pid).unwrap_or_default();

    Some(crate::context::FocusedWindow {
        app_name,
        title,
        process_id: pid as u32,
    })
}
