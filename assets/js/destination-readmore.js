// Destination guide — per-section "See more" collapse (/destination/ only).
//
// Each `.destination-guide__text` has ONE localized <p data-i18n-html> body
// (the i18n plugin has already baked the localized HTML in by the time this
// runs). We clamp the body to ~14 lines with a fade-out at the bottom and a
// "See more" / "See less" toggle below. Line-based clamp via CSS max-height
// (see .destination-guide__body.is-collapsed in sections.css); this JS only
// decides whether a body actually overflows 14 lines (else no button) and
// wires the toggle.
//
// Labels come from data-see-more / data-see-less on each text block, baked
// via data-i18n-attr (same pattern as enquiry.js data-err-*), so they stay
// localized. English fallbacks keep it working un-built.

export function initDestinationReadMore() {
  const texts = document.querySelectorAll('.destination-guide__text');
  if (!texts.length) return; // not on /destination/

  texts.forEach((textEl) => {
    const body = textEl.querySelector('p[data-i18n-html], p');
    if (!body) return;

    body.classList.add('destination-guide__body');

    // Only collapse if the body is actually taller than the 14-line cap —
    // otherwise a short section gets a pointless "See more". Measure the
    // uncollapsed scrollHeight against the collapsed max-height.
    body.classList.add('is-collapsed');
    const overflows = body.scrollHeight > body.clientHeight + 1; // +1 for rounding
    if (!overflows) {
      // Nothing to reveal — drop the clamp so it renders normally.
      body.classList.remove('is-collapsed', 'destination-guide__body');
      return;
    }

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
      btn.setAttribute('aria-expanded', String(expanded));
      btn.textContent = expanded ? seeLess : seeMore;
    });

    body.insertAdjacentElement('afterend', btn);
  });
}
