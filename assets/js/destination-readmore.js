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
// grid row): the body starts `headingStack` px below the column top, and the
// toggle sits below the body with a `--space-3` top margin. To make the
// toggle's bottom land on the photo's bottom:
//     bodyHeight = photoHeight − headingStack − (toggleMarginTop + toggleHeight)
// headingStack is the body's border-box top RELATIVE to the text column (not
// offsetTop, which is measured from the offsetParent and includes the row's own
// page offset). It therefore captures everything above the body box — the
// eyebrow, the h3, their margins, AND the body <p>'s own top margin (only
// margin-bottom is reset in CSS) — which is exactly the space to subtract.
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
  // it's re-measured once the real button is in the DOM. Bias the estimate a
  // touch HIGH: it feeds only the first-pass overflow gate, and a slightly-too-
  // large toggleStack makes the estimated clamp slightly smaller, so the gate
  // errs toward KEEPING a toggle. That's the safe direction — a spurious toggle
  // on a barely-overflowing body is harmless, a missing one clips text with no
  // way to reveal it.
  let toggleStack;
  if (btn) {
    const cs = getComputedStyle(btn);
    toggleStack = parseFloat(cs.marginTop) + btn.getBoundingClientRect().height;
  } else {
    // Estimate: --space-3 (1.5rem) top margin + one toggle line box. The toggle
    // is `font: inherit` (so it inherits the body's line-height: 1.7) with only
    // font-size overridden to 0.875rem, so its line box ≈ 1.7 × 0.875rem. Round
    // the line-height factor up to 1.8 to bias the estimate high (see above).
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    toggleStack = 1.5 * rootPx + 1.8 * 0.875 * rootPx;
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

// Recompute an already-wired section after a resize (the desktop clamp depends
// on the photo height, which scales with viewport width). Three collapsed-state
// outcomes; an expanded section is never touched (don't yank it shut).
//
//   - fits now  → fully un-collapse: hide the toggle AND drop is-collapsed +
//                 un-inert the links + clear the clamp, so the body isn't left
//                 clipped/faded with unreachable links and no way to expand.
//   - overflows → ensure the collapsed presentation is (re)applied and the
//                 toggle shown, in case a prior resize had un-collapsed it.
function refreshSection(textEl, body) {
  const btn = body.nextElementSibling &&
    body.nextElementSibling.classList.contains('destination-guide__toggle')
      ? body.nextElementSibling
      : null;
  if (!btn) { measureClamp(textEl, body, null); return; }

  // Don't disturb a body the user has expanded; just refresh its (unused-while-
  // expanded) clamp so it's correct if they collapse later.
  if (body.classList.contains('is-expanded')) { measureClamp(textEl, body, btn); return; }

  // Measure overflow against a collapsed box: temporarily ensure is-collapsed so
  // the clamp/overflow read is valid even if a prior pass un-collapsed it.
  body.classList.add('is-collapsed');
  measureClamp(textEl, body, btn);
  void body.offsetHeight;
  const overflows = body.scrollHeight > body.clientHeight + 1;

  if (overflows) {
    btn.hidden = false;
    setLinksInert(body, true); // collapsed presentation restored
  } else {
    // Fits within the clamp — reveal it fully and remove the collapsed state so
    // no fade/clip/inert-link residue remains without a toggle to undo it.
    btn.hidden = true;
    body.classList.remove('is-collapsed');
    body.style.removeProperty('--dg-clamp');
    setLinksInert(body, false);
  }
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
