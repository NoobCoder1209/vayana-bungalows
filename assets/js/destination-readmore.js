// Destination guide — per-section "See more" collapse (/destination/ only).
//
// Each `.destination-guide__text` has ONE localized <p data-i18n-html> body
// (the i18n plugin has already baked the localized HTML in by the time this
// runs). We clamp the body to ~14 lines with a fade-out at the bottom and a
// "See more" / "See less" toggle below. Line-based clamp via CSS max-height
// (see .destination-guide__body.is-collapsed in sections.css); this JS decides
// whether a body actually overflows 14 lines (else no button) and wires the
// toggle.
//
// Labels come from data-see-more / data-see-less on each text block, baked
// via data-i18n-attr (same pattern as enquiry.js data-err-*), so they stay
// localized. English fallbacks keep it working un-built.

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

function setupSection(textEl) {
  const body = textEl.querySelector('p[data-i18n-html], p');
  if (!body) return;

  // Idempotency — never re-process a body (double init, or the resize
  // re-check below). Mirrors enquiry.js's data-*Init guard.
  if (body.dataset.readmoreInit === '1') return;

  // Measure against the collapsed clamp: does the body exceed ~14 lines?
  const wasCollapsed = body.classList.contains('is-collapsed');
  body.classList.add('destination-guide__body', 'is-collapsed');
  const overflows = body.scrollHeight > body.clientHeight + 1; // +1 for rounding
  if (!overflows) {
    // Short section — nothing to reveal. Render it plainly (unless a prior
    // pass already committed it to collapsed, which can't happen pre-init).
    if (!wasCollapsed) body.classList.remove('is-collapsed', 'destination-guide__body');
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
}

export function initDestinationReadMore() {
  const texts = document.querySelectorAll('.destination-guide__text');
  if (!texts.length) return; // not on /destination/

  const run = () => texts.forEach(setupSection);

  // Measure AFTER webfonts load — the page uses display=swap Google Fonts, so
  // a DOMContentLoaded measurement is against fallback-font metrics and the
  // final reflow can flip the 14-line overflow decision (silently clipping a
  // body with no toggle, or adding a pointless one). fonts.ready gates it.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(run);
  } else {
    run();
  }

  // Re-evaluate on resize: a body that didn't overflow at a wide viewport can
  // exceed 14 lines when narrowed (and vice-versa). setupSection is idempotent
  // (readmoreInit guard) so already-wired sections are skipped; only
  // not-yet-collapsed sections get re-measured. Debounced.
  let raf = 0;
  window.addEventListener('resize', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(run);
  }, { passive: true });
}
