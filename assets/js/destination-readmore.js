// Destination guide — per-section "See more" collapse (/destination/ only).
//
// Each `.destination-guide__text` has ONE localized <p data-i18n-html> body
// (the i18n plugin has already baked the localized HTML in by the time this
// runs). We collapse the body with a fade-out at the bottom and a "See more" /
// "See less" toggle below.
//
// The collapsed height is breakpoint-dependent (see sections.css):
//   - DESKTOP (>768px): the photo sits BESIDE the text. We clamp the body so
//     that body + toggle together equal the photo's rendered height, i.e. the
//     "See more" toggle's bottom lands flush with the bottom of the photo. The
//     target height is measured here (the photo height is viewport-dependent —
//     column width × 3/4 — so it can't be a fixed line count) and written to
//     the body as a `--dg-clamp` custom property, recomputed on resize / font
//     swap.
//   - MOBILE (<=768px): the photo stacks ABOVE the text, so there's no
//     side-by-side height to match; CSS ignores --dg-clamp and falls back to a
//     fixed ~14-line clamp.
//
// Labels come from data-see-more / data-see-less on each text block, baked
// via data-i18n-attr (same pattern as enquiry.js data-err-*), so they stay
// localized. English fallbacks keep it working un-built.

const DESKTOP_MQ = '(min-width: 769px)'; // mirror of the 768px CSS breakpoint

// Set descendant links inert while the body is collapsed: overflow:hidden
// clips them visually but leaves them keyboard-focusable + in the a11y tree
// (WCAG 2.4.7). The bodies use data-i18n-html, which permits <a>, so guard
// for it even though today's copy has none.
function setLinksInert(body, inert) {
  body.querySelectorAll('a[href]').forEach((a) => {
    if (inert) {
      a.setAttribute('tabindex', '-1');
      a.setAttribute('aria-hidden', 'true');
    } else {
      a.removeAttribute('tabindex');
      a.removeAttribute('aria-hidden');
    }
  });
}

// Desktop only: compute the max-height that makes (body + toggle) equal the
// photo's height, and write it to --dg-clamp. On mobile, clear --dg-clamp so
// the CSS 14-line fallback applies. Returns the clamp px number on desktop
// (for the overflow test), or null when the fixed CSS clamp is in effect.
//
// Geometry (photo and text column share the same top in an align-items:start
// grid row): the body starts `headingStack` px below the column top (eyebrow +
// h3 + their margins), and the toggle sits below the body with a `--space-3`
// top margin. To make the toggle's bottom land on the photo's bottom:
//     bodyHeight = photoHeight − headingStack − (toggleMarginTop + toggleHeight)
// headingStack is the body's top RELATIVE to the text column (not offsetTop,
// which is measured from the offsetParent and includes the row's own offset).
function measureClamp(textEl, body, btn) {
  const row = textEl.closest('.destination-guide__row');
  const photo = row && row.querySelector('.destination-guide__photo');
  if (!photo || !window.matchMedia(DESKTOP_MQ).matches) {
    body.style.removeProperty('--dg-clamp'); // mobile / no photo → CSS fallback
    return null;
  }

  const photoH = photo.getBoundingClientRect().height;
  // Space above the body inside the text column (eyebrow + h3 + margins),
  // measured relative to the column top so it excludes the row's page offset.
  const headingStack = body.getBoundingClientRect().top - textEl.getBoundingClientRect().top;

  // Toggle stack = its top margin (--space-3) + its own rendered height. If the
  // button doesn't exist yet (first pass), estimate from its computed line box;
  // it's re-measured once the real button is in the DOM.
  let toggleStack;
  if (btn) {
    const cs = getComputedStyle(btn);
    toggleStack = parseFloat(cs.marginTop) + btn.getBoundingClientRect().height;
  } else {
    // Estimate: --space-3 (1.5rem) gap + roughly one small-font line.
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    toggleStack = 1.5 * rootPx + 1.2 * 0.875 * rootPx;
  }

  const clamp = Math.max(0, Math.round(photoH - headingStack - toggleStack));
  body.style.setProperty('--dg-clamp', `${clamp}px`);
  return clamp;
}

function setupSection(textEl) {
  const body = textEl.querySelector('p[data-i18n-html], p');
  if (!body) return;

  // Already wired: just recompute the desktop clamp (photo height changes with
  // viewport width) and re-check overflow so a resize that now fits the body
  // hides the toggle (and vice-versa).
  if (body.dataset.readmoreInit === '1') {
    refreshSection(textEl, body);
    return;
  }

  body.classList.add('destination-guide__body', 'is-collapsed');
  // Set the desktop clamp (no button yet — estimated toggle stack) so the
  // overflow test below measures against the real target height, then reflow.
  measureClamp(textEl, body, null);
  void body.offsetHeight; // force reflow so clientHeight reflects the clamp

  // Does the body exceed its clamp? `.is-collapsed` is overflow:hidden, so
  // clientHeight is the clipped height and scrollHeight the full content height.
  const overflows = body.scrollHeight > body.clientHeight + 1; // +1 for rounding
  if (!overflows) {
    // Fits — nothing to reveal. Strip the collapse classes + the clamp var so a
    // short body renders plainly and stays re-measurable on a later resize.
    body.classList.remove('is-collapsed', 'destination-guide__body');
    body.style.removeProperty('--dg-clamp');
    return;
  }

  body.dataset.readmoreInit = '1';
  setLinksInert(body, true); // collapsed by default

  const seeMore = textEl.dataset.seeMore || 'See more';
  const seeLess = textEl.dataset.seeLess || 'See less';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'destination-guide__toggle';
  btn.textContent = seeMore;
  btn.setAttribute('aria-expanded', 'false');
  if (!body.id) {
    body.id = `dg-body-${Math.random().toString(36).slice(2, 8)}`;
  }
  btn.setAttribute('aria-controls', body.id);

  btn.addEventListener('click', () => {
    const expanded = body.classList.toggle('is-expanded');
    body.classList.toggle('is-collapsed', !expanded);
    setLinksInert(body, !expanded);
    btn.setAttribute('aria-expanded', String(expanded));
    btn.textContent = expanded ? seeLess : seeMore;
  });

  body.insertAdjacentElement('afterend', btn);

  // Re-measure the clamp now the real button exists, so its true height is
  // subtracted and the toggle bottom lands exactly on the photo bottom.
  measureClamp(textEl, body, btn);
}

// Recompute an already-wired section: refresh the desktop clamp and, if a
// resize made the (collapsed) body fit within it, hide the toggle; if it now
// overflows again, restore it. Never touches an expanded section's visibility.
function refreshSection(textEl, body) {
  const btn = body.nextElementSibling &&
    body.nextElementSibling.classList.contains('destination-guide__toggle')
      ? body.nextElementSibling
      : null;

  measureClamp(textEl, body, btn);
  if (!btn) return;

  // Only adjust while collapsed — don't yank an expanded body shut on resize.
  if (!body.classList.contains('is-collapsed')) return;

  void body.offsetHeight;
  const overflows = body.scrollHeight > body.clientHeight + 1;
  btn.hidden = !overflows; // fits now → hide the toggle; overflows → show it
}

export function initDestinationReadMore() {
  const texts = document.querySelectorAll('.destination-guide__text');
  if (!texts.length) return; // not on /destination/

  const run = () => texts.forEach(setupSection);

  // Measure AFTER webfonts load — the page uses display=swap Google Fonts, so
  // a DOMContentLoaded measurement is against fallback-font metrics and the
  // final reflow can flip the overflow decision (silently clipping a body with
  // no toggle, or adding a pointless one). fonts.ready gates it.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(run);
  } else {
    run();
  }

  // Re-evaluate on resize: the desktop clamp depends on the photo height (which
  // scales with viewport width), and crossing the 768px breakpoint switches
  // between the measured clamp and the fixed 14-line fallback. setupSection
  // dispatches already-wired sections to refreshSection. Debounced via rAF.
  let raf = 0;
  window.addEventListener('resize', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(run);
  }, { passive: true });
}
