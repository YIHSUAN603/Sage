// macOS backend for the semantic snapshot: reads the focused window's text
// through the Accessibility API (AXUIElement). Requires the 輔助使用
// (Accessibility) TCC permission — NOT Screen Recording, which Sage no longer
// uses.
//
// Crate choice (Track M): the AX surface we need is four stable C functions
// (AXIsProcessTrusted / AXUIElementCreateApplication /
// AXUIElementCopyAttributeValue / AXUIElementGetTypeID), so we declare them
// in a small extern "C" block and lean on `core-foundation` — already in the
// dependency tree via active-win-pos-rs — for CFString/CFArray handling. The
// wrapper crates evaluated (`accessibility` + `accessibility-sys`,
// `macos-accessibility-client`) would add three dependencies to wrap those
// same four calls, with less control over CF ownership, so direct FFI wins
// on both compile risk and maintenance.

use core_foundation::array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex, CFArrayRef};
use core_foundation::base::{CFGetTypeID, CFRelease, CFTypeID, CFTypeRef, TCFType};
use core_foundation::string::{CFString, CFStringGetTypeID, CFStringRef};
use std::ffi::c_void;

/// Guidance surfaced when the AX read fails — on macOS this is almost always a
/// missing Accessibility permission (TCC).
const MACOS_PERMISSION_HINT: &str =
    "無法讀取視窗內容。請在 系統設定→隱私權與安全性→輔助使用 授權本 App";

// ---------------------------------------------------------------------------
// FFI — AXUIElement lives in ApplicationServices (HIServices). All four
// functions are stable public API dating back to macOS 10.x.
// ---------------------------------------------------------------------------

/// Opaque AXUIElementRef. A CF object — toll-free castable to CFTypeRef.
type AXUIElementRef = *const c_void;
type AXError = i32;
const AX_ERROR_SUCCESS: AXError = 0;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    /// Non-prompting trust check (the `WithOptions` variant can pop a dialog;
    /// we deliberately avoid it and surface MACOS_PERMISSION_HINT instead).
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementGetTypeID() -> CFTypeID;
}

// Attribute names (kAX*Attribute constants are plain CFStrings with these
// literal values; declaring them here avoids linking the constant symbols).
const AX_FOCUSED_UI_ELEMENT: &str = "AXFocusedUIElement";
const AX_FOCUSED_WINDOW: &str = "AXFocusedWindow";
const AX_CHILDREN: &str = "AXChildren";
const AX_ROLE: &str = "AXRole";
const AX_VALUE: &str = "AXValue";
const AX_SELECTED_TEXT: &str = "AXSelectedText";
const AX_TITLE: &str = "AXTitle";

/// Owns a CF object returned under the Copy/Create rule; releases it on drop.
struct OwnedCF(CFTypeRef);

impl Drop for OwnedCF {
    fn drop(&mut self) {
        // Invariant: constructed only from non-null pointers (see copy_attr /
        // read_focused), so the release is always balanced and safe.
        unsafe { CFRelease(self.0) };
    }
}

/// Copies one attribute off an element. `None` covers every failure mode —
/// unsupported attribute, no value, AX error — because a missing field is
/// normal, not exceptional (spec: absent fields become empty strings).
fn copy_attr(element: AXUIElementRef, name: &str) -> Option<OwnedCF> {
    let attr = CFString::new(name);
    let mut value: CFTypeRef = std::ptr::null();
    let err = unsafe {
        AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value)
    };
    if err == AX_ERROR_SUCCESS && !value.is_null() {
        Some(OwnedCF(value))
    } else {
        None
    }
}

/// Extracts a Rust String only when the CF value really is a CFString —
/// AXValue can also be a number/AXValueRef (sliders, scrollbars), which we
/// deliberately skip.
fn cf_string(value: &OwnedCF) -> Option<String> {
    unsafe {
        if CFGetTypeID(value.0) != CFStringGetTypeID() {
            return None;
        }
        // Get rule: OwnedCF keeps the +1 we already hold; the wrapper retains
        // its own reference and releases it independently.
        Some(CFString::wrap_under_get_rule(value.0 as CFStringRef).to_string())
    }
}

/// Attribute as text; empty string when absent or not a CFString.
fn attr_string(element: AXUIElementRef, name: &str) -> String {
    copy_attr(element, name)
        .and_then(|v| cf_string(&v))
        .unwrap_or_default()
}

/// Borrows the value as an AXUIElement after verifying its CF type — feeding
/// a non-element into AXUIElementCopyAttributeValue would be UB.
fn as_element(value: &OwnedCF) -> Option<AXUIElementRef> {
    unsafe { (CFGetTypeID(value.0) == AXUIElementGetTypeID()).then_some(value.0) }
}

// ---------------------------------------------------------------------------
// Tree walk — pure budgeting logic kept separate from FFI so it unit-tests.
// ---------------------------------------------------------------------------

/// Raw per-fragment cap (chars). The shared layer re-sanitizes and tightens to
/// 200; this only bounds how much we haul out of the AX tree.
const MAX_RAW_FRAGMENT_CHARS: usize = 500;
/// Raw total cap (chars): stop walking once this much text is collected.
const MAX_RAW_TOTAL_CHARS: usize = 4000;
/// Maximum tree depth below the focused window.
const MAX_DEPTH: usize = 8;
/// Maximum number of AX elements visited.
const MAX_VISITED: usize = 300;

/// Roles whose AXValue is user-visible text worth collecting.
fn role_reads_value(role: &str) -> bool {
    matches!(role, "AXStaticText" | "AXTextArea" | "AXTextField")
}

/// Roles whose AXTitle labels an actionable element (links, buttons).
fn role_reads_title(role: &str) -> bool {
    matches!(role, "AXLink" | "AXButton")
}

/// Accumulates fragments in tree order under the raw budget.
#[derive(Default)]
struct Collector {
    texts: Vec<String>,
    total: usize,
    visited: usize,
}

impl Collector {
    fn full(&self) -> bool {
        self.total >= MAX_RAW_TOTAL_CHARS
    }

    /// Pushes one fragment, trimmed and cut to the per-fragment cap and the
    /// remaining total budget. Whitespace-only fragments are dropped.
    fn push(&mut self, text: &str) {
        if self.full() {
            return;
        }
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let budget = MAX_RAW_FRAGMENT_CHARS.min(MAX_RAW_TOTAL_CHARS - self.total);
        let fragment: String = text.chars().take(budget).collect();
        self.total += fragment.chars().count();
        self.texts.push(fragment);
    }
}

/// Depth-first walk collecting text from the roles above, honoring the depth,
/// visit-count and character budgets. Recursion is bounded by MAX_DEPTH.
fn walk(element: AXUIElementRef, depth: usize, out: &mut Collector) {
    if out.visited >= MAX_VISITED || out.full() {
        return;
    }
    out.visited += 1;

    let role = attr_string(element, AX_ROLE);
    if role_reads_value(&role) {
        out.push(&attr_string(element, AX_VALUE));
    } else if role_reads_title(&role) {
        out.push(&attr_string(element, AX_TITLE));
    }

    if depth >= MAX_DEPTH {
        return;
    }
    let Some(children) = copy_attr(element, AX_CHILDREN) else {
        return;
    };
    unsafe {
        if CFGetTypeID(children.0) != CFArrayGetTypeID() {
            return;
        }
        let array = children.0 as CFArrayRef;
        let count = CFArrayGetCount(array);
        for i in 0..count {
            if out.visited >= MAX_VISITED || out.full() {
                break;
            }
            // Get rule: items are borrowed from `children`, which the OwnedCF
            // guard keeps alive for the whole loop.
            let child = CFArrayGetValueAtIndex(array, i) as CFTypeRef;
            if child.is_null() || CFGetTypeID(child) != AXUIElementGetTypeID() {
                continue;
            }
            walk(child, depth + 1, out);
        }
    }
}

pub fn read_focused(
    window: &crate::context::FocusedWindow,
) -> Result<super::RawSnapshot, String> {
    if !unsafe { AXIsProcessTrusted() } {
        return Err(MACOS_PERMISSION_HINT.into());
    }

    // Built from the pid that just passed the blocklist gate, so the app we
    // read is exactly the app that was checked.
    let app = unsafe { AXUIElementCreateApplication(window.process_id as i32) };
    if app.is_null() {
        return Err(format!(
            "無法建立 AX 應用程式元件（pid {}）。{}",
            window.process_id, MACOS_PERMISSION_HINT
        ));
    }
    let app = OwnedCF(app);

    // Focused element: any absent attribute degrades to an empty string.
    let mut focused_role = String::new();
    let mut focused_value = String::new();
    let mut selection = String::new();
    if let Some(owned) = copy_attr(app.0, AX_FOCUSED_UI_ELEMENT) {
        if let Some(element) = as_element(&owned) {
            focused_role = attr_string(element, AX_ROLE);
            focused_value = attr_string(element, AX_VALUE);
            selection = attr_string(element, AX_SELECTED_TEXT);
        }
    }

    // Window text: DFS below the focused window, in tree order.
    let mut collector = Collector::default();
    if let Some(owned) = copy_attr(app.0, AX_FOCUSED_WINDOW) {
        if let Some(win) = as_element(&owned) {
            walk(win, 0, &mut collector);
        }
    }

    Ok(super::RawSnapshot {
        focused_role,
        focused_value,
        selection,
        texts: collector.texts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_filters_match_spec() {
        for role in ["AXStaticText", "AXTextArea", "AXTextField"] {
            assert!(role_reads_value(role), "{role} should read AXValue");
            assert!(!role_reads_title(role));
        }
        for role in ["AXLink", "AXButton"] {
            assert!(role_reads_title(role), "{role} should read AXTitle");
            assert!(!role_reads_value(role));
        }
        for role in ["AXWindow", "AXGroup", "AXImage", ""] {
            assert!(!role_reads_value(role));
            assert!(!role_reads_title(role));
        }
    }

    #[test]
    fn collector_truncates_each_fragment_to_500_chars() {
        let mut c = Collector::default();
        c.push(&"字".repeat(700));
        assert_eq!(c.texts.len(), 1);
        assert_eq!(c.texts[0].chars().count(), 500);
    }

    #[test]
    fn collector_stops_at_total_budget() {
        let mut c = Collector::default();
        for _ in 0..20 {
            c.push(&"x".repeat(500));
        }
        assert!(c.full());
        assert_eq!(c.texts.len(), 8); // 8 × 500 = 4000
        let total: usize = c.texts.iter().map(|t| t.chars().count()).sum();
        assert_eq!(total, MAX_RAW_TOTAL_CHARS);
    }

    #[test]
    fn collector_partial_last_fragment_fits_remaining_budget() {
        let mut c = Collector::default();
        c.total = MAX_RAW_TOTAL_CHARS - 10;
        c.push(&"y".repeat(500));
        assert_eq!(c.texts[0].chars().count(), 10);
        assert!(c.full());
    }

    #[test]
    fn collector_skips_blank_fragments_and_keeps_order() {
        let mut c = Collector::default();
        c.push("first");
        c.push("   ");
        c.push("");
        c.push("  second  ");
        assert_eq!(c.texts, vec!["first", "second"]);
    }
}
