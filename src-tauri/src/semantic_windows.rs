// Windows backend for the semantic snapshot: reads the focused window's text
// through UI Automation (no user permission required on Windows).
//
// Crate choice: `uiautomation` (v0.25) — a safe wrapper over the UIA COM API.
// Picked over calling the raw `windows` crate COM interfaces because it wraps
// every IUIAutomation* call in Result-returning methods (no unsafe here, no
// panics), exposes ValuePattern/TextPattern/TreeWalker directly, and its
// `UIAutomation::new()` performs the per-thread CoInitializeEx — important
// because Tauri commands run on worker threads with no guaranteed COM state.

use uiautomation::patterns::{UITextPattern, UIValuePattern};
use uiautomation::types::ControlType;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

/// Per-fragment raw cap (chars). The shared layer trims further (200/2000);
/// this only bounds what crosses the COM boundary.
const MAX_FRAGMENT_CHARS: usize = 500;
/// Stop collecting window text once the raw total reaches this many chars.
const MAX_TOTAL_CHARS: usize = 4000;
/// Depth-first traversal limits: keep the walk cheap on huge UIA trees.
const MAX_DEPTH: usize = 8;
const MAX_ELEMENTS: usize = 300;
/// Cap on the ancestor hops when climbing from the focused element to its
/// top-level window — guards against pathological (cyclic) UIA trees.
const MAX_ANCESTOR_HOPS: usize = 32;

pub fn read_focused(
    window: &crate::context::FocusedWindow,
) -> Result<super::RawSnapshot, String> {
    // `new()` CoInitializeEx-es this thread (MTA). If the thread was already
    // initialized with a different model it fails with RPC_E_CHANGED_MODE —
    // COM is usable then, so fall back to creating the client directly.
    let automation = UIAutomation::new()
        .or_else(|_| UIAutomation::new_direct())
        .map_err(|e| format!("UIA init failed: {e}"))?;

    let focused = automation
        .get_focused_element()
        .map_err(|e| format!("UIA focused element unavailable: {e}"))?;

    // Privacy alignment: the content we are about to read must belong to the
    // window that just passed the blocklist gate. If focus moved to another
    // process in between, refuse rather than leak the wrong window.
    let pid = focused
        .get_process_id()
        .map_err(|e| format!("UIA process id unavailable: {e}"))?;
    if pid != window.process_id {
        return Err("focus changed".into());
    }

    let focused_role = focused
        .get_control_type()
        .map(|ct| format!("{ct:?}"))
        .unwrap_or_default();
    let focused_value = element_value(&focused);
    let selection = selection_text(&focused);

    let mut texts = Vec::new();
    if let Ok(walker) = automation.get_control_view_walker() {
        let top = top_level_of(&automation, &walker, &focused);
        let mut visited = 0usize;
        let mut total = 0usize;
        collect_texts(&walker, &top, 0, &mut visited, &mut total, &mut texts);
    }

    Ok(super::RawSnapshot {
        focused_role,
        focused_value,
        selection,
        texts,
    })
}

/// Truncate on char boundaries (fragments are frequently CJK).
fn cap_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect()
    }
}

/// Value of the focused element: ValuePattern value, else TextPattern full
/// text (bounded), else the Name property.
fn element_value(element: &UIElement) -> String {
    if let Ok(value) = element.get_pattern::<UIValuePattern>() {
        if let Ok(text) = value.get_value() {
            if !text.trim().is_empty() {
                return cap_chars(&text, MAX_FRAGMENT_CHARS);
            }
        }
    }
    if let Ok(text_pattern) = element.get_pattern::<UITextPattern>() {
        if let Ok(range) = text_pattern.get_document_range() {
            // get_text takes the max length; -1 would mean "no limit".
            if let Ok(text) = range.get_text(MAX_FRAGMENT_CHARS as i32) {
                if !text.trim().is_empty() {
                    return cap_chars(&text, MAX_FRAGMENT_CHARS);
                }
            }
        }
    }
    element
        .get_name()
        .map(|name| cap_chars(&name, MAX_FRAGMENT_CHARS))
        .unwrap_or_default()
}

/// Selected text via TextPattern's GetSelection; empty when unsupported.
fn selection_text(element: &UIElement) -> String {
    let Ok(text_pattern) = element.get_pattern::<UITextPattern>() else {
        return String::new();
    };
    let Ok(ranges) = text_pattern.get_selection() else {
        return String::new();
    };
    let mut out = String::new();
    for range in ranges {
        let Ok(text) = range.get_text(MAX_FRAGMENT_CHARS as i32) else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&text);
        if out.chars().count() >= MAX_FRAGMENT_CHARS {
            break;
        }
    }
    cap_chars(&out, MAX_FRAGMENT_CHARS)
}

/// Climb the control-view ancestor chain from the focused element to its
/// top-level window (the element whose parent is the desktop root). Falls
/// back to the focused element itself when the climb fails — the traversal
/// then still covers the focused subtree.
fn top_level_of(
    automation: &UIAutomation,
    walker: &UITreeWalker,
    focused: &UIElement,
) -> UIElement {
    let Ok(root) = automation.get_root_element() else {
        return focused.clone();
    };
    let mut current = focused.clone();
    for _ in 0..MAX_ANCESTOR_HOPS {
        let Ok(parent) = walker.get_parent(&current) else {
            // No parent below the root: `current` is the top-level window.
            return current;
        };
        if automation
            .compare_elements(&parent, &root)
            .unwrap_or(false)
        {
            return current;
        }
        current = parent;
    }
    focused.clone()
}

/// True for control types whose Name/value is user-visible window text.
fn is_texty(control_type: ControlType) -> bool {
    matches!(
        control_type,
        ControlType::Text
            | ControlType::Edit
            | ControlType::Document
            | ControlType::Hyperlink
            | ControlType::Button
    )
}

/// One raw fragment for a texty element. Edit/Document carry their content in
/// ValuePattern (Name is just the label); the rest carry it in Name.
fn fragment_of(element: &UIElement, control_type: ControlType) -> String {
    let value = || {
        element
            .get_pattern::<UIValuePattern>()
            .and_then(|p| p.get_value())
            .unwrap_or_default()
    };
    let name = || element.get_name().unwrap_or_default();
    let text = match control_type {
        ControlType::Edit | ControlType::Document => {
            let v = value();
            if v.trim().is_empty() { name() } else { v }
        }
        _ => {
            let n = name();
            if n.trim().is_empty() { value() } else { n }
        }
    };
    cap_chars(text.trim(), MAX_FRAGMENT_CHARS)
}

/// Depth-first, order-preserving walk over the control view collecting texty
/// fragments, bounded by depth / element count / total chars.
fn collect_texts(
    walker: &UITreeWalker,
    element: &UIElement,
    depth: usize,
    visited: &mut usize,
    total: &mut usize,
    out: &mut Vec<String>,
) {
    if depth >= MAX_DEPTH {
        return;
    }
    let mut child = walker.get_first_child(element).ok();
    while let Some(current) = child {
        if *visited >= MAX_ELEMENTS || *total >= MAX_TOTAL_CHARS {
            return;
        }
        *visited += 1;
        if let Ok(control_type) = current.get_control_type() {
            if is_texty(control_type) {
                let text = fragment_of(&current, control_type);
                if !text.is_empty() {
                    *total += text.chars().count();
                    out.push(text);
                }
            }
        }
        collect_texts(walker, &current, depth + 1, visited, total, out);
        child = walker.get_next_sibling(&current).ok();
    }
}
