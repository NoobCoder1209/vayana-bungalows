// Shared helper for click-handler modifier-key / non-primary-button gating.
//
// Used by:
//   - assets/js/lang.js — the language pill's click intercept
//   - assets/js/header.js — the drawer's link-click auto-close
//
// A "primary click" is a plain left-button click with no modifier keys held.
// Anything else means the browser is going to open the target in a new tab
// (Cmd/Ctrl/Shift/Alt-click, middle-click) or is a non-interactive dispatch
// (right-click's contextmenu doesn't reach here on modern browsers, but
// button=2 is included in the guard as belt-and-braces for older engines
// before `auxclick` was standard).
//
// Returns true if the click should be treated as a normal in-tab action;
// false if the handler should bail out and let the browser do its default.
export function isPrimaryClick(e) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (e.button !== undefined && e.button !== 0) return false;
  return true;
}
