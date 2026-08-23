# Vayana Bungalows — Audit Report

> **How to read this.** Every finding has an **In plain terms** line (what it means, no jargon), **The issue** (the precise technical claim), a **code block** of the actual source, clickable **Where** links (pinned to the audited commit so they never drift), and a **Proposed fix**. Fixable-now items have a `[ ]` box. **This is a report — no code was changed.**

> 🔧 **TO FIX** — findings tagged with this marker are the ones the owner selected to be worked on later (some carry a note). Untagged findings remain in the report for reference only. Marking only — still no code changed.

_Source links pinned to commit `2402fef`._

---

## Issue index

**38 of 53** findings are marked to fix (owner-selected); **24 are ✅ done** and **14 remain 🔧 To fix** (S-01/S-02/S-03 are pending Cloudflare-dashboard/config actions, not repo code). The rest are **Reference only** (kept for context, not scheduled to be worked on). Refuted claims are listed for completeness. Full detail for every item is in the sections below.

| Issue | Status |
|---|---|
| ~~**C-01** · `assets/js/booking.js:81-133` · comment-stale · high~~ | ✅ **Done** (comment fix) |
| **C-10** · `assets/js/newsletter.js:175` · bug · med | 🔧 **To fix** |
| ~~**C-09** · `assets/js/header.js:98-102` · comment-stale · med~~ | ✅ **Done** (comment fix) |
| **C-13** · `assets/js/availability-calendar.js:259-266` · perf · med | Reference only |
| **C-11** · `assets/js/newsletter.js:97-98` · bug · low | 🔧 **To fix** |
| ~~**C-05** · `assets/js/enquiry.js:124-219` · comment-stale · low~~ | ✅ **Done** (comment fix) |
| ~~**C-06** · `assets/js/enquiry.js:723-728` · dead-code · low~~ | ✅ **Done** (comment fix) |
| ~~**C-12** · `assets/js/newsletter.js:180` · dead-end · low~~ | ✅ **Done** |
| ~~**C-03** · `assets/js/booking.js:158` · dead-code · nit~~ | ✅ **Done** (comment fix) |
| ~~**C-08** · `assets/js/enquiry.js:443-452` · comment-stale · nit~~ | ✅ **Done** (comment fix) |
| ~~**C-17** · `assets/js/hero-carousel.js:63` · comment-stale · nit~~ | ✅ **Done** (comment fix) |
| **C-18** · `assets/js/parallax.js:32-33` · perf · nit | 🔧 **To fix** |
| **T-01** · `package.json:10` · test-gap · med | Reference only |
| **D-03** · `README.md:13-18` · dx · med | 🔧 **To fix** |
| ~~**D-01** · `README.md:134-139` · doc-stale · low~~ | ✅ **Done** (comment fix) |
| ~~**D-02** · `SITEMAP.md:5` · doc-stale · low~~ | ✅ **Done** (comment fix) |
| **C-02** · `assets/js/booking.js:346-356` | 🔧 **To fix** |
| **C-04** · `assets/js/enquiry.js:353-355` | 🔧 **To fix** |
| **C-14** · `assets/js/availability-calendar.js:271-296` | 🔧 **To fix** |
| **C-15** · `assets/js/offer-modal.js:1-6` · comment-stale · med | Reference only |
| **C-07** · `assets/js/enquiry.js:428` · bug · low | Reference only |
| ~~**C-19** · `assets/js/bookings-data.js:76-83` · dead-code · low~~ | ✅ **Done** (comment fix) |
| **C-20** · `assets/js/site-config.js:8-15` · comment-stale · low | Reference only |
| **C-21** · `assets/js/util/offer-dates.js:35-65` · bug · low | 🔧 **To fix** |
| **B-07** · `scripts/i18n-plugin.js:1650-1669` · bug · low | 🔧 **To fix** |
| ~~**B-01** · `scripts/i18n-plugin.js:55-102` · comment-stale · low~~ | ✅ **Done** (comment fix) |
| ~~**B-02** · `scripts/i18n-plugin.js:17` · comment-stale · low~~ | ✅ **Done** (comment fix) |
| **B-03** · `scripts/i18n-plugin.js:71-78` · comment-stale · low | Reference only |
| ~~**B-05** · `scripts/i18n-plugin.js:936-947` · dead-end · low~~ | ✅ **Done** |
| **B-08** · `scripts/fetch-bookings.mjs:284-289` · comment-stale · low | Reference only |
| **B-09** · `vite.config.js:66-98` · bug · low | 🔧 **To fix** |
| ~~**B-04** · `scripts/i18n-plugin.js:403-416` · dead-code · nit~~ | ✅ **Done** (comment fix) |
| **B-06** · `scripts/i18n-plugin.js:673-678` · dead-code · nit | Reference only |
| ~~**B-10** · `vite.config.js:65-96` · nit · nit~~ | ✅ **Done** |
| **T-02** · `scripts/__tests__/fetch-bookings.test.mjs:3` · test-gap · low | 🔧 **To fix** |
| **W-07** · `worker/src/pricing.js:190-193` · bug · med | Reference only |
| **W-05** · `worker/src/offers.js:322-334` · perf · med | Reference only |
| ~~**W-08** · `worker/src/sheets.js:138-161` · comment-stale · med~~ | ✅ **Done** (comment fix) |
| ~~**W-01** · `worker/src/index.js:34-422` · dead-code · low~~ | ✅ **Done** (comment fix) |
| ~~**W-02** · `worker/src/index.js:387-400` · comment-stale · low~~ | ✅ **Done** (comment fix) |
| **W-03** · `worker/src/index.js:248` · bug · low | Reference only |
| **W-04** · `worker/src/offers.js:224-245` · security · low | Reference only |
| ~~**W-06** · `worker/src/rate-limit.js:34-38` · dead-code · nit~~ | ✅ **Done** (comment fix) |
| **W-09** · `worker/src/lib/response.js:99` · config · low | Reference only |
| **S-01** · `worker/src/index.js:74-195` · security · med | 🔧 **To fix** |
| **S-02** · `worker/src/rate-limit.js:17-40` · security · med | 🔧 **To fix** |
| **S-03** · `worker/src/index.js:265-273` · security · low | 🔧 **To fix** |
| ~~**S-04** · `package.json:16-19` · security · med~~ | ✅ **Done** |
| **S-05** · `.github/workflows/deploy.yml:49-51` · bug · med | Reference only |
| ~~**S-06** · `.github/workflows/deploy.yml:24` · security · low~~ | ✅ **Done** |
| ~~**S-07** · `worker/wrangler.toml:29` · comment-stale · low~~ | ✅ **Done** (comment fix) |
| ~~**S-08** · `worker/wrangler.toml:1-15` · comment-stale · low~~ | ✅ **Done** (comment fix) |
| **L-01** · `locales/en.json:5` · consistency · high | Reference only |
| **C-16** · `assets/js/offers.js:93-102` | Refuted (not a finding) |
| **R-01** · `worker/package.json:15-17` | Refuted (not a finding) |
| **R-02** · `assets/js/booking.js:140-142` | Refuted (not a finding) |

---

## Summary

**Counts** — 56 items checked: **53 CONFIRMED, 3 REFUTED**, 0 needs-runtime.
- **Fixable-now:** 16 (client comments/dead-code/perf, newsletter bugs, calendar Intl hoist, test-runlist gap, doc refresh).
- **Report-only:** 37 (worker + security, i18n hardcodes, build/tooling comments, locale `Code·/Код·` asymmetry).
- **Refuted (appendix):** 3 — C-16, plus known-flip checks R-01 (`jose`) and R-02 (dock dates).

**By severity** (the 53 confirmed): high 2 · med 14 · low 31 · nit 6.

**Top 5 to care about**
1. **L-01** (high) — translator `Code·/Код·` prefixes still on live text, asymmetric (327 EN / 531 BG). _Left untouched per your call — writer mid-work._
2. **C-01** (high) — `booking.js` comments describe an `/enquiries/` bar that doesn’t exist.
3. **W-08** (med) — un-actioned “insert Price column L” warning shipped in code; RAW append misaligns saved columns if the live sheet lacks it.
4. **W-07** (med) — a misconfigured discount can produce a negative accepted price.
5. **S-01 / S-02** (med) — `/price` + `/offers` are open, un-rate-limited, and read Google Sheets → quota-drain; the rate limiter is per-isolate.

**Security posture.** No committed secrets; `npm audit --omit=dev` = **0** production vulnerabilities (the 5 findings are dev-toolchain only); no PII in `bookings.json` (only dates ship; IPs are hashed). i18n injection defenses are strong and fail-closed. The real exposure is **abuse/availability, not confidentiality**: the two open read routes can drain Sheets quota (S-01, W-05), the rate limiter is per-isolate and leans on the captcha (S-02), and one correctness bug (W-07 negative price) could persist bad data. Fix those before high-traffic launch.

---

## Fixable-now

- [ ] **C-01** · [`assets/js/booking.js:81-133`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/booking.js#L81-L133) · comment-stale · **high** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** Comments describe a search bar on the enquiries page that was never built — they point future readers at a page that has nothing to do with this code.
  - **The issue:** `setupLinkForm`’s comments claim it powers an `/enquiries/` bar and forwards there, but the only caller sends it to `stay/`, and no `data-booking-mode` element exists on the enquiries page.

  The stale claim:
  ```js
  84  // Used by the /enquiries/ bar (legacy detail pages) and the home floating dock
  ```
  The only real caller — target is `stay/`, not `/enquiries/`:
  ```js
  57      .querySelectorAll('form[data-booking-mode="availability-link"]')
  58      .forEach((form) => setupLinkForm(form, 'stay/'));
  ```

  - **Where:** [`assets/js/booking.js:112`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/booking.js#L112) · [`assets/js/booking.js:128`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/booking.js#L128)
  - **Proposed fix:** Delete the `/enquiries/` references; document the single `stay/` target.

- [ ] **C-10** · [`assets/js/newsletter.js:175`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/newsletter.js#L175) · bug · **med** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** The newsletter popup attaches its “press Escape to close” listener to the whole page and never removes it, so listeners pile up — the enquiry form already fixed this exact bug.
  - **The issue:** The keydown handler is bound on `document` (global, cross-page-lifecycle leak) instead of on the modal element, unlike the enquiry modal which was deliberately changed to modal-scoped.

  Newsletter (leaks — document-level):
  ```js
  173    // Single document-level Escape handler — guarded by the idempotency
  174    // check at the top of initNewsletter(), so we never stack two of them.
  175    document.addEventListener('keydown', (e) => {
  176      if (e.key === 'Escape' && !modal.hidden) closeModal(modal, lastFocusBeforeModal);
  ```
  Enquiry (the fixed pattern — modal-scoped):
  ```js
  805    // Round-2 review finding B-R2-3 — was previously `document.addEventListener`
  806    // which leaked across page lifecycles. Focus during modal-open is
  807    // inside the panel (close button), so the keydown bubbles to the
  808    // modal element and the listener fires from there.
  809    modal.addEventListener('keydown', (e) => {
  810      if (e.key === 'Escape' && !modal.hidden) closeModal(modal, lastFocusBeforeModal);
  ```

  - **Proposed fix:** Scope the keydown listener to `modal` as enquiry.js does.

- [ ] **C-09** · [`assets/js/header.js:98-102`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/header.js#L98-L102) · comment-stale · **med** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** A comment lists “4 ways to close the menu” but the code actually has 5 — the comment just wasn’t updated when the × button was added.
  - **The issue:** The drawer doc comment enumerates 4 close paths; the code wires a fifth (the explicit × button, self-labelled “close path #5”).

  The comment says 4:
  ```js
  98  //   1. click any link inside the drawer
  99  //   2. press Esc
  100  //   3. click the backdrop
  101  //   4. click the hamburger toggle a second time
  102  // On close, focus returns to the hamburger toggle.
  ```
  …but path #5 is right here:
  ```js
  353    // Explicit × button (close path #5).
  354    if (closeBtn) closeBtn.addEventListener('click', close);
  ```

  - **Proposed fix:** Update the enumeration to list all 5 paths including the × button.

- [ ] **C-13** · [`assets/js/availability-calendar.js:259-266`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/availability-calendar.js#L259-L266) · perf · **med** · CONFIRMED (3/3)
  - **In plain terms:** Every time the calendar repaints (each click, each month change) it rebuilds 8 date-formatter objects per calendar × 3 calendars — work that only needs doing once because the language never changes mid-page.
  - **The issue:** `renderInstance` constructs `weekdayShortNames()` (7 `Intl.DateTimeFormat`) plus a day formatter on every render; `renderAll` runs all three instances on every step/click.

  Rebuilt per render, per instance:
  ```js
  259    const weekdays = weekdayShortNames();
  260    const dayFormatter = new Intl.DateTimeFormat(currentLocale(), {
  261      day: 'numeric',
  262      month: 'long',
  263      year: 'numeric',
  264    });
  265  
  266    const g1 = buildMonthGrid(left, avail, today, dayFormatter, weekdays, key);
  ```
  `weekdayShortNames()` makes 7 formatters each call:
  ```js
  76    return WEEKDAY_ORDER.map((_, i) => {
  77      const d = new Date(base);
  78      d.setDate(base.getDate() + i);
  79      return new Intl.DateTimeFormat(currentLocale(), { weekday: 'short' }).format(d);
  80    });
  ```

  - **Where:** [`assets/js/availability-calendar.js:321`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/availability-calendar.js#L321) · [`assets/js/availability-calendar.js:60`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/availability-calendar.js#L60)
  - **Proposed fix:** Hoist the locale-keyed formatters to module scope; rebuild only when `currentLocale()` changes.

- [ ] **C-11** · [`assets/js/newsletter.js:97-98`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/newsletter.js#L97-L98) · bug · **low** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** If the user forgets the consent tick and gets an error, then ticks it, the red error message stays on screen instead of clearing.
  - **The issue:** The consent change handler calls `flagConsent(false)` but not `clearError()`; the enquiry form clears the error on change.

  Newsletter — no `clearError()`:
  ```js
  96    email.addEventListener('input', clearError);
  97    consentInput.addEventListener('change', () => {
  98      if (consentInput.checked) flagConsent(false);
  99    });
  ```
  Enquiry clears the error on change:
  ```js
  477    consentInput.addEventListener('change', () => {
  478      if (consentInput.checked) flagConsent(false);
  479      clearError();
  ```

  - **Proposed fix:** Add `clearError();` to the newsletter consent-change handler.

- [ ] **C-05** · [`assets/js/enquiry.js:124-219`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/enquiry.js#L124-L219) · comment-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** Some variables are written a certain way “for a future live language switch,” but the site never switches language live — changing language reloads the page — so the reason given no longer holds.
  - **The issue:** Module-scope `let` bindings are justified by comments citing a runtime language swap (issue #47), contradicted by lang.js which states a language change is a full navigation.

  The stale justification:
  ```js
  122  // something readable. Assigning at init rather than module scope so a
  123  // runtime language swap (future work) can re-read the current DOM value.
  124  let SUBMIT_BUSY_TEXT = 'Sending…';
  ```
  …but lang.js says language change is a navigation:
  ```js
  28  //   - Client-side dictionary swaps. This is a build-time i18n stack: EN lives
  29  //     at root, BG at /bg/. A language change is a navigation, not a string swap.
  ```

  - **Proposed fix:** Remove the runtime-swap justification (or convert to `const`) and reference the build-time i18n architecture.

- [ ] **C-06** · [`assets/js/enquiry.js:723-728`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/enquiry.js#L723-L728) · dead-code · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** This file re-writes a date helper it could just import from another file it already imports from — duplicated logic.
  - **The issue:** A local `toISO` duplicates `toIso` exported by bookings-data.js, which enquiry.js already imports (`parseIso`).

  Local duplicate:
  ```js
  723      const toISO = (d) => {
  724        const yyyy = d.getFullYear();
  725        const mm = String(d.getMonth() + 1).padStart(2, '0');
  726        const dd = String(d.getDate()).padStart(2, '0');
  727        return `${yyyy}-${mm}-${dd}`;
  728      };
  ```
  Already imports from that module:
  ```js
  39  import { parseIso } from './bookings-data.js';
  ```

  - **Proposed fix:** Import `toIso` from bookings-data.js and delete the local copy.

- [ ] **C-12** · [`assets/js/newsletter.js:180`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/newsletter.js#L180) · dead-end · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** — removed the unused openModal param + discarded caller arg;
  - **In plain terms:** A function takes an argument it never uses, and the caller bothers to compute and pass it — wasted, confusing code.
  - **The issue:** `openModal(modal, getReturnFocusEl)` declares a second parameter never referenced in the body (focus restore lives in `closeModal`); the caller passes a discarded arg.

  Param declared, never used:
  ```js
  180  function openModal(modal, getReturnFocusEl) {
  181    modal.hidden = false;
  182    document.body.style.overflow = 'hidden';
  183    // Focus the close button — same convention as the booking modal: the
  184    // first [data-modal-close] is the .modal__backdrop <div> (not focusable),
  185    // so prefer the explicit .modal__close button.
  186    const focusable = modal.querySelector('.modal__close')
  187      || modal.querySelector('button[data-modal-close]')
  188      || modal.querySelector('.btn');
  189    focusable?.focus();
  ```
  Caller passes a discarded arg:
  ```js
  107      openModal(modal, () => lastFocusBeforeModal);
  ```

  - **Proposed fix:** Drop the unused parameter and the discarded caller argument.

- [ ] **C-03** · [`assets/js/booking.js:158`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/booking.js#L158) · dead-code · **nit** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** A `today` variable is created just to compute “tomorrow” once — it can be inlined.
  - **The issue:** `const today = new Date()` is referenced only once (to compute `tomorrow`).

  ```js
  158    const today = new Date();
  159    const tomorrow = new Date();
  160    tomorrow.setDate(today.getDate() + 1);
  ```

  - **Proposed fix:** Inline `new Date()` into the `tomorrow` computation.

- [ ] **C-08** · [`assets/js/enquiry.js:443-452`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/enquiry.js#L443-L452) · comment-stale · **nit** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied) — Drop the whole comment (not just the lead sentence).
  - **In plain terms:** A comment says three dropdowns are left out of a list, but one of them (Adults) was later added — the opening sentence contradicts the code until you read a later note.
  - **The issue:** The lead sentence says the 3 selects are omitted from `allFields`, but a POST-#41 addendum and the array itself include `adults`.

  ```js
  443    // is valid, and there is no validation branch that could fail on them.
  444    // Round-2 review finding N-R2-2 (explicit comment requested).
  445    //
  446    // POST-#41 / placeholder-pattern update: Adults is now REQUIRED with
  447    // no numeric default — the select starts on a disabled placeholder
  448    // option ("ADULTS*"). It joins allFields so submit-time validation
  449    // failures get the aria-invalid marker like the other required
  450    // inputs. Children and Infants remain optional (placeholder or "-"
  451    // are both legal) so they stay out of allFields.
  452    const allFields = [name, checkinEl, checkoutEl, adults, email, phone, message, consentInput];
  ```

  - **Proposed fix:** Rewrite the lead sentence: only children/infants are omitted; adults is required and included.

- [ ] **C-17** · [`assets/js/hero-carousel.js:63`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/hero-carousel.js#L63) · comment-stale · **nit** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** A comment hardcodes “8 slides” but the carousel counts slides dynamically — the number is just an old assumption.
  - **The issue:** The comment says “most visible at the 8→1 wrap” implying 8 slides; slide count is data-driven (`slides.length`).

  ```js
  62      // would slide it left→right across the viewport — a stray motion most
  63      // visible at the 8→1 wrap. Timeout keyed to SLIDE_MS so a missed
  ```

  - **Proposed fix:** Change “8→1” to “last→first”.

- [ ] **C-18** · [`assets/js/parallax.js:32-33`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/parallax.js#L32-L33) · perf · **nit** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** The scroll listener is marked “passive” (a small perf hint) but the resize listener isn’t — just an inconsistency, negligible impact.
  - **The issue:** Resize listener omits `{passive:true}` while the scroll listener has it; both funnel to a rAF-throttled handler.

  ```js
  31    window.addEventListener('scroll', onScroll, { passive: true });
  32    window.addEventListener('resize', onScroll);
  33    update();
  ```

  - **Proposed fix:** Add `{ passive: true }` to the resize listener for consistency.

- [ ] **T-01** · [`package.json:10`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/package.json#L10) · test-gap · **med** · CONFIRMED (3/3)
  - **In plain terms:** One test file exists on disk but was never added to the list of tests that actually run — so a whole file of date-logic tests is silently skipped in CI.
  - **The issue:** The npm `test` script hand-enumerates files and omits `assets/js/util/__tests__/offer-dates.test.mjs`, so offer-dates.js is never exercised.

  The hand-listed test files (no offer-dates):
  ```json
  10      "test": "node --test scripts/__tests__/i18n-plugin.test.mjs scripts/__tests__/i18n-lint.test.mjs scripts/__tests__/i18n-smoke.test.mjs scripts/__tests__/fetch-bookings.test.mjs assets/js/__tests__/lang.test.mjs assets/js/__tests__/is-primary-click.test.mjs assets/js/__tests__/header.test.mjs assets/js/__tests__/current-locale.test.mjs assets/js/__tests__/season.test.mjs assets/js/__tests__/availability-calendar.test.mjs assets/js/__tests__/calendar-selection.test.mjs worker/__tests__/locale.test.mjs worker/__tests__/offers.test.mjs worker/__tests__/pricing.test.mjs worker/__tests__/price.test.mjs worker/__tests__/append-row.test.mjs assets/js/__tests__/offers.test.mjs assets/js/__tests__/offer-modal.test.mjs assets/js/__tests__/enquiry-errors.test.mjs",
  ```

  - **Proposed fix:** Add the offer-dates test, or switch to a glob so new test files can’t be silently dropped.

- [ ] **D-03** · [`README.md:13-18`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/README.md#L13-L18) · dx · **med** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** If a new developer clones the repo and follows the README, 3 tests fail — because the README never tells them to install the worker’s dependencies (CI does this, the docs don’t).
  - **The issue:** `jose` lives in worker/node_modules; a root-only `npm ci && npm test` hits `ERR_MODULE_NOT_FOUND`. The README omits `cd worker && npm ci`; CI performs it.

  The import that needs worker deps:
  ```js
  17  import { SignJWT, importPKCS8 } from 'jose';
  ```

  - **Where:** [`README.md:13-18`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/README.md#L13-L18)
  - **Proposed fix:** Add a `cd worker && npm ci` step to the README setup instructions.

- [ ] **D-01** · [`README.md:134-139`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/README.md#L134-L139) · doc-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** The README says the i18n plugin handles “five” marker types (there are four) and undercounts which HTML tags the sanitizer allows.
  - **The issue:** README says “five marker attributes” (only four exist) and its sanitizer description omits the allowed `<a>` and `<strong>`.

  The actual allowed-tags list (4 tags):
  ```js
  589  const ALLOWED_HTML_TAGS = new Set(['a', 'strong', 'em', 'br']);
  ```

  - **Where:** [`README.md:134-139`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/README.md#L134-L139)
  - **Proposed fix:** Correct “five”→“four” and list all four allowed tags.

- [ ] **D-02** · [`SITEMAP.md:5`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/SITEMAP.md#L5) · doc-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** SITEMAP says the site has 8 pages and that the legal pages 404 — both outdated; there are 12 pages and the legal pages are built and live.
  - **The issue:** SITEMAP says “eight pages” and that privacy/terms/cancellation links “today 404,” but vite.config defines 12 entries and the policy pages build (smoke test asserts 12 EN + 12 BG).
  - **Where:** [`SITEMAP.md:5`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/SITEMAP.md#L5) · [`SITEMAP.md:35`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/SITEMAP.md#L35) · [`SITEMAP.md:148`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/SITEMAP.md#L148)
  - **Proposed fix:** Update the page count to 12 and mark the policy pages as built/live.

---

## Report-only

- **C-02** · [`assets/js/booking.js:346-356`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/booking.js#L346-L356) · i18n-hardcode · **med** · CONFIRMED (3/3)
  - > 🔧 **TO FIX** — Also add translator Codes to the BG + EN versions so the writer can rewrite them later.
  - **In plain terms:** The booking confirmation popup’s text is hardcoded in English, so on the Bulgarian site it still shows English.
  - **The issue:** Modal success title/body copy is built in JS as English literals, bypassing the data-attribute i18n pattern.

  ```js
  346      const bungalow = form.querySelector('input[name="bungalow"]')?.value?.trim();
  347      if (modalBody) {
  348        modalBody.textContent = bungalow
  349          ? `A reservations specialist will follow up within twenty-four hours to confirm availability for ${bungalow} and tailor your stay.`
  350          : defaultBody;
  351      }
  352      if (modalTitle) {
  353        modalTitle.textContent = bungalow
  354          ? `Thank you — your ${bungalow} request is in.`
  355          : defaultTitle;
  356      }
  ```

  - **Proposed fix:** Source the success copy from localized data attributes / the i18n table.

- **C-04** · [`assets/js/enquiry.js:353-355`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/enquiry.js#L353-L355) · i18n-hardcode · **med** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** When a guest arrives from a specific villa, the pre-filled enquiry message is English-only — there’s a known TODO for it.
  - **The issue:** The `?villa=` prefill writes an English opener; a live (accurate) TODO already flags the i18n gap.

  ```js
  346    // TODO i18n: when Bulgarian copy lands, source the opener template
  347    // from site-config.js / an i18n table rather than inline English
  348    // (round-1 review finding N1).
  349    const params = new URLSearchParams(window.location.search);
  350    const villaSlug = params.get('villa');
  351    if (villaSlug && Object.prototype.hasOwnProperty.call(BUNGALOW_SLUGS, villaSlug)) {
  352      const villaName = BUNGALOW_SLUGS[villaSlug];
  353      if (!message.value.trim()) {
  354        message.value = `Hello, I'd like to enquire about the ${villaName}.`;
  355      }
  ```

  - **Proposed fix:** Source the opener template from an i18n table when Bulgarian copy lands.

- **C-14** · [`assets/js/availability-calendar.js:271-296`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/availability-calendar.js#L271-L296) · i18n-hardcode · **med** · CONFIRMED (3/3)
  - > 🔧 **TO FIX** — Also add translator Codes to the BG + EN versions so the writer can rewrite them later.
  - **In plain terms:** The calendar’s labels (“Availability”, “Available/Booked/Past/Selected”, prev/next) are hardcoded English, so the Bulgarian calendar shows English.
  - **The issue:** English UI strings are baked into the calendar grid HTML with no translation call.

  The legend literals:
  ```js
  293        <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--free"></span>Available</span>
  294        <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--booked"></span>Booked</span>
  295        <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--past"></span>Past</span>
  296        <span class="avail-cal__key-item"><span class="avail-cal__key-dot avail-cal__key-dot--selected"></span>Selected</span>
  ```

  - **Where:** [`assets/js/availability-calendar.js:271`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/availability-calendar.js#L271) · [`assets/js/availability-calendar.js:269`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/availability-calendar.js#L269)
  - **Proposed fix:** Route the calendar template strings through the i18n layer.

- **C-15** · [`assets/js/offer-modal.js:1-6`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/offer-modal.js#L1-L6) · comment-stale · **med** · CONFIRMED (3/3)
  - **In plain terms:** The offer popup’s header comment claims it shows “savings” and “message,” but those parts are turned off in the current design.
  - **The issue:** Header comment enumerates savings/message as shown, but both slots are permanently dormant.

  The comment:
  ```js
  1  // Offer detail modal — opened from the home-page offer cards' CTA.
  2  //
  3  // The card CTA used to link to /stay/; now it opens this modal, which shows
  4  // the FULL offer (dates, prices, savings, nights, message) plus a templated
  5  // rules/terms block that is identical for every offer. Only the per-offer
  6  // dynamic values differ — they're injected into the static #offer-modal
  ```
  …but both are DORMANT:
  ```js
  107    setSlot(modal, 'struck', ''); // DORMANT: always hidden (no priceBefore)
  108    setSlot(modal, 'hero', euro(offer.price));
  109    setSlot(modal, 'save', ''); // DORMANT: always hidden (no savings data)
  110    // Deal line — Type 2 nights-free or Type 1 discount framing. Shared helper
  111    // with the card (offers.js offerDealLine) so the two never drift.
  112    setSlot(modal, 'nights', offerDealLine(offer, offersDs));
  113    setSlot(modal, 'message', ''); // DORMANT: no message field in the new shape
  ```

  - **Proposed fix:** Drop savings/message from the header enumeration (or mark them dormant).

- **C-07** · [`assets/js/enquiry.js:428`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/enquiry.js#L428) · bug · **low** · CONFIRMED (3/3)
  - **In plain terms:** If a link supplies only a checkout date (no check-in), the form can pre-fill a checkout of “today” even though the earliest allowed date is tomorrow — harmless (submit still validates) but sloppy.
  - **The issue:** The lone-checkout guard uses `d >= today` while `minDate` is tomorrow, so a checkout equal to today slips below the picker floor.

  ```js
  426    if (isValidPrefill(checkoutParam)) {
  427      const d = parseIso(checkoutParam);
  428      const afterCheckin = prefilledCheckin ? d > prefilledCheckin : d >= today;
  429      if (!Number.isNaN(d.getTime()) && afterCheckin && !isOffSeason(d)) {
  430        fpCheckout.setDate(d, false);
  ```

  - **Proposed fix:** Use `d >= tomorrow` (the picker floor) when no valid check-in is present.

- **C-19** · [`assets/js/bookings-data.js:76-83`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/bookings-data.js#L76-L83) · dead-code · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied) — Remove it — but first double-check it is truly unreachable in prod (confirm it is genuinely dead code) before deleting.
  - **In plain terms:** There’s a safety branch handling an old data format that may never actually occur in production — possibly-dead but cheap defensive code.
  - **The issue:** The `Array.isArray(entry)` branch guards a legacy array shape (schema regression), self-documented as a guard.

  ```js
  76  export function availabilityFor(bookings, key) {
  77    const entry = bookings?.bungalows?.[key];
  78    if (Array.isArray(entry)) {
  79      console.warn(
  80        `[bookings] ${key}: bookings.json is in the legacy array shape; treating as empty.`,
  81      );
  82      return { unavailable: new Set(), checkIn: new Set() };
  83    }
  ```

  - **Proposed fix:** Keep as a defensive guard, or remove if the legacy shape is confirmed unreachable in prod.

- **C-20** · [`assets/js/site-config.js:8-15`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/site-config.js#L8-L15) · comment-stale · **low** · CONFIRMED (3/3)
  - **In plain terms:** A comment calls the phone/email/social values “placeholders to swap before launch,” but they look like the real, final values now.
  - **The issue:** The “stub” comment is partially stale — phone, email, social and license appear finalized.

  ```js
  8  // Placeholder values: phone / email / social URLs are stubs to be swapped
  9  // before launch via a separate "Contact data finalize" issue. The license
  10  // number and brand name are real and must not be touched without legal review.
  11  export const SITE_CONFIG = {
  12    brand: 'Vayana Bungalows',
  13    license: 'Ц2-0ТИ-В2Т-С0',
  14    phone: { display: '+359 899 873 990', href: 'tel:+359899873990' },
  15    email: { display: 'vayanamare@gmail.com', href: 'mailto:vayanamare@gmail.com' },
  ```

  - **Proposed fix:** Update the comment to reflect that these values are finalized (drop the “stub” framing).

- **C-21** · [`assets/js/util/offer-dates.js:35-65`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/util/offer-dates.js#L35-L65) · bug · **low** · CONFIRMED (3/3)
  - > 🔧 **TO FIX** — Prefer Sofia local time (UTC+3 / +2 winter) or just the user’s local time — align both paths to that.
  - **In plain terms:** One file works in UTC, another parses the same value in local time; today it can’t cause a visible bug (month-only granularity) but it’s an inconsistency waiting to bite.
  - **The issue:** offer-dates builds/formats in UTC while calendar-selection.parseOfferMonth parses `?offerMonth` as a local Date.

  UTC here:
  ```js
  35    const dt = new Date(Date.UTC(year, month - 1, day));
  ```
  Local here:
  ```js
  290    const d = new Date(y, m - 1, 1);
  ```

  - **Proposed fix:** Make both paths use the same timezone basis (both UTC or both local).

- **B-07** · [`scripts/i18n-plugin.js:1650-1669`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L1650-L1669) · bug · **low** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** The build’s charset detector treats an old-style meta tag as “the charset tag” even when it carries no charset — could misplace an inserted block in rare HTML.
  - **The issue:** The HTML4 charset regex matches `meta http-equiv="content-type"` regardless of whether `charset=` is in its content attribute.

  ```js
  1650    const html5 = /<meta\b[^>]*\scharset\s*=[^>]*>/i;
  1651    const html4 = /<meta\b[^>]*\shttp-equiv\s*=\s*["']?content-type["']?[^>]*>/i;
  1652    const html5Match = headBody.match(html5);
  ```

  - **Proposed fix:** Require `charset=` in the content attribute before treating the tag as the charset anchor.

- **B-01** · [`scripts/i18n-plugin.js:55-102`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L55-L102) · comment-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** Several comments say the plugin emits the Bulgarian pages in a hook called `closeBundle`, but the real hook is `writeBundle`.
  - **The issue:** Doc comments reference a `closeBundle` hook; the implemented hook is `writeBundle` (README agrees).

  ```js
  55  // --------------
  56  // The `closeBundle` hook iterates the emitted asset bundle for every
  57  // input page and writes the BG variant to `dist/bg/<path>/index.html`.
  ```

  - **Where:** [`scripts/i18n-plugin.js:1806`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L1806)
  - **Proposed fix:** Replace `closeBundle` with `writeBundle` in the doc comments.

- **B-02** · [`scripts/i18n-plugin.js:17`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L17) · comment-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied) — Remove the whole comment.
  - **In plain terms:** A comment states a fixed key count (“147×2”) that’s long out of date — there are ~586 per locale.
  - **The issue:** Docblock hard-codes “147×2 as of Task #162”; actual leaf-key count is ~586 per locale.

  ```js
  16  //   - locales/bg.json — Bulgarian, MUST declare the exact same keys (147×2
  17  //                        as of Task #162; symmetry hard-fails the build if
  ```

  - **Proposed fix:** Update to 586×2, or drop the hard count in favor of “the exact same key set”.

- **B-03** · [`scripts/i18n-plugin.js:71-78`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L71-L78) · comment-stale · **low** · CONFIRMED (3/3)
  - **In plain terms:** A comment lists the interpolation tokens the plugin supports but is missing 8 that were added later.
  - **The issue:** The “tokens supported today” list omits brand, license, address_street, address_country, min, free, pct, amount.

  The incomplete list:
  ```js
  71  // Locale values may embed `{name}` tokens; they resolve from the
  72  // `context` map passed at plugin registration (see vite.config.js's
  73  // i18nContext block). Tokens supported today:
  74  //   {phone}          — SITE_CONFIG.phone.display
  75  //   {credit}         — brand credit line
  76  //   {privacy_url}    — locale-aware path to /privacy/
  77  //   {email_href}     — mailto:...
  78  //   {email_display}  — plain email address (for visible text)
  ```

  - **Where:** [`vite.config.js:64-67`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/vite.config.js#L64-L67) · [`vite.config.js:78-81`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/vite.config.js#L78-L81)
  - **Proposed fix:** Add the missing tokens (or reference the vite.config context as the source of truth).

- **B-05** · [`scripts/i18n-plugin.js:936-947`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L936-L947) · dead-end · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** — Reclassified: srcset/imagesrcset is NOT dead — it's a security guard that hard-fails a `javascript:`/`data:` payload injected via `data-i18n-attr` (a passing test asserts this). Kept in place; comment clarified to say WHY (guard, not a multi-URL validator). Removing it would weaken the sanitizer.
  - **In plain terms:** The plugin claims to validate `srcset` URLs but its check can only ever reject a real multi-URL srcset — a guard that never passes anything legitimate.
  - **The issue:** `srcset`/`imagesrcset` are validated with `isAllowedHref` on the whole comma-separated value, which has no comma-split.

  ```js
  936  const URL_BEARING_ATTRS = new Set([
  937    'href',
  938    'src',
  939    // srcset + imagesrcset: comma-separated URL lists. isAllowedHref will
  940    // only check the whole value against the scheme allowlist. `data:` in
  941    // <link rel=preload imagesrcset=...> can still fetch and execute in
  942    // some renderer paths (M1), so reject any value not starting with a
  943    // safe scheme. A translator writing a legit srcset with multiple
  944    // /internal urls would need `data-i18n-html` (which sanitises tags)
  945    // instead — but srcset markers are rare in copy and can be added to
  946    // the allowlist later with a proper comma-split check.
  947    'srcset',
  ```

  - **Proposed fix:** Add a comma-split srcset check, or drop srcset from URL_BEARING_ATTRS and require `data-i18n-html`.

- **B-08** · [`scripts/fetch-bookings.mjs:284-289`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/fetch-bookings.mjs#L284-L289) · comment-stale · **low** · CONFIRMED (3/3)
  - **In plain terms:** A comment promises the booking fetch “rolls over to next year automatically,” but it only does so if all three next-year tabs exist — a partial setup is silently ignored.
  - **The issue:** Next-year rollover reads year+1 tabs only if all three (B1/B2/B3) exist; the comment overstates the guarantee.

  ```js
  284    // so December → January rolls over without operator intervention.
  285    const yearsToRead = [CURRENT_YEAR];
  286    if (TAB_KEYS.every((k) => allTabs.has(`${k} ${CURRENT_YEAR + 1}`))) {
  287      yearsToRead.push(CURRENT_YEAR + 1);
  288      info(`  found next-year tabs (${CURRENT_YEAR + 1}), will read both`);
  289    }
  ```

  - **Proposed fix:** Note that all three next-year tabs must exist together, or handle partial next-year tabs.

- **B-09** · [`vite.config.js:66-98`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/vite.config.js#L66-L98) · bug · **low** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** The address “street” value already ends in “Bulgaria,” and there’s a separate “country” value also set to “Bulgaria” — render both together and you get “Bulgaria, Bulgaria.”
  - **The issue:** `address_street` ends in “Bulgaria” and `address_country` is also “Bulgaria”.

  ```js
  66      address_street: 'Arapya, Bulgaria',
  67      address_country: 'Bulgaria',
  ```

  - **Proposed fix:** Drop “Bulgaria” from `address_street` (make it “Arapya”) or omit `address_country` in the combined sentence.

- **B-04** · [`scripts/i18n-plugin.js:403-416`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L403-L416) · dead-code · **nit** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** The same ~7-line explanatory comment is pasted twice, back to back.
  - **The issue:** The `HTML_ENTITY_RE` rationale comment block is duplicated verbatim.

  ```js
  403  // Match any HTML-entity-shaped sequence a translator might write out of
  404  // habit: `&amp;`, `&lt;`, `&#39;`, `&#x27;`, `&copy;`, `&nbsp;`. Locale
  405  // values are stored raw (Unicode) — the plugin escapes on write. A
  406  // translator who pre-escapes creates double-escapes in the emitted HTML
  407  // (e.g. `&copy;` → literal `&copy;` visible in the browser instead of
  408  // `©`). RH3 fails loudly at load time so the failure is a build error,
  409  // not an unnoticed shipped bug.
  410  // Match any HTML-entity-shaped sequence a translator might write out of
  411  // habit: `&amp;`, `&lt;`, `&#39;`, `&#x27;`, `&copy;`, `&nbsp;`. Locale
  412  // values are stored raw (Unicode) — the plugin escapes on write. A
  413  // translator who pre-escapes creates double-escapes in the emitted HTML
  414  // (e.g. `&copy;` → literal `&copy;` visible in the browser instead of
  415  // `©`). RH3 fails loudly at load time so the failure is a build error,
  416  // not an unnoticed shipped bug.
  ```

  - **Proposed fix:** Delete the duplicate copy (keep one).

- **B-06** · [`scripts/i18n-plugin.js:673-678`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js#L673-L678) · dead-code · **nit** · CONFIRMED (3/3)
  - **In plain terms:** A fallback branch for “any other node type” can never run given the parser settings — acknowledged defensive dead code.
  - **The issue:** The “other node type” branch is unreachable under the parser options (only element/text/comment nodes are emitted).

  ```js
  673      // Any other node type (CDataSection, ProcessingInstruction, etc.)
  674      // silently ignored — node-html-parser doesn't emit these under
  675      // PARSER_OPTIONS. If a future parser upgrade starts emitting them,
  676      // the tag-allowlist check will fail-closed on any element wrapping
  677      // them, and the text-check above catches raw `<` in text.
  678    }
  ```

  - **Proposed fix:** Keep as a documented defensive guard, or remove.

- **B-10** · [`vite.config.js:65-96`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/vite.config.js#L65-L96) · nit · **nit** · CONFIRMED (3/3)
  - > ✅ **DONE** — re-indented the license key to 4 spaces;
  - **In plain terms:** One line is indented with 2 spaces where its neighbors use 4 — purely cosmetic.
  - **The issue:** The `license:` key is mis-indented in both the en and bg context blocks.

  ```js
  64      brand: 'Vayana Bungalows',
  65    license: 'Ц2-0ТИ-В2Т-С0',
  66      address_street: 'Arapya, Bulgaria',
  ```

  - **Proposed fix:** Re-indent `license` to 4 spaces.

- **T-02** · [`scripts/__tests__/fetch-bookings.test.mjs:3`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/__tests__/fetch-bookings.test.mjs#L3) · test-gap · **low** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** The booking-fetch script has tests for only one of its functions; error paths and edge cases (bad dates, missing headers, the “completed stay ending today” boundary) are untested.
  - **The issue:** Only `parseReservationTable` is tested; parseDmy errors, validateHeader throw, getSheets env, next-year rollover, and the Completed-ending-today boundary are not.

  Only this one function is imported/tested:
  ```js
  3  import { parseReservationTable } from '../fetch-bookings.mjs';
  ```

  - **Proposed fix:** Add unit tests for the untested functions and the Completed-ending-today boundary.

- **W-07** · [`worker/src/pricing.js:190-193`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/pricing.js#L190-L193) · bug · **med** · CONFIRMED (3/3)
  - **In plain terms:** If someone misconfigures a discount in the spreadsheet to be bigger than the stay’s price, the server returns a NEGATIVE price and accepts it — which could be shown to a guest or stored.
  - **The issue:** `DiscountTotal` pricing has no floor; a discount larger than the subtotal yields a negative total with `applied:true`, which index.js accepts (only rejects null).

  No floor on the total:
  ```js
  190      // hasTotal — flat sum off the in-window portion (no clamp on sign, per spec).
  191      const t = offer.discountTotal;
  192      if (!(Number.isFinite(t) && t > 0)) return { total: plainTotal, applied: false };
  193      return { total: round2((W * rate - t) + extras), applied: true };
  ```

  - **Where:** [`worker/src/index.js:181`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L181) · [`worker/src/index.js:193`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L193)
  - **Proposed fix:** Clamp the total to a non-negative floor (`Math.max(0, …)`) or reject negatives in index.js.

- **W-05** · [`worker/src/offers.js:322-334`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/offers.js#L322-L334) · perf · **med** · CONFIRMED (3/3)
  - **In plain terms:** When the rate table is temporarily empty, the offers endpoint stops caching and hits Google Sheets on every single request — and since that endpoint is open to anyone, it can burn through the Sheets quota.
  - **The issue:** Empty rate-bands disable the `/offers` cache, so it re-reads Sheets per request; the route is unauthenticated and un-rate-limited.

  ```js
  322    // the very next request re-read and self-heal. Offers CAN legitimately be
  323    // empty (all promotions expired), so only `bands` gates caching.
  324    //
  325    // Side effect: while bands are empty, /offers (which reads only .offers via
  326    // getCachedOffers → getCachedData) also won't cache, so it re-reads Sheets
  327    // per request during that window. Benign: empty bands are transient (short
  328    // window), and even a sustained outage just degrades /offers to the
  329    // pre-cache "read every request" behavior — it never breaks /offers.
  330    if (Array.isArray(data.bands) && data.bands.length > 0) {
  331      cachedData = data;
  332      cachedExpiry = now + OFFERS_CACHE_TTL_MS;
  333    }
  334    return data;
  ```

  - **Proposed fix:** Cache even the empty-bands result (short TTL), or add a lock so `/offers` doesn’t re-read Sheets per request.

- **W-08** · [`worker/src/sheets.js:138-161`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/sheets.js#L138-L161) · comment-stale · **med** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied) — Remove the comment (move the pre-deploy step to a runbook).
  - **In plain terms:** A big “DO THIS BEFORE DEPLOYING” note is still sitting in the code: a Price column must be inserted in the live spreadsheet, or the saved data columns shift and misalign. It should be a runbook step, and someone must confirm the sheet actually has that column.
  - **The issue:** An un-actioned “insert Price column L” warning remains in shipped code; a RAW append on A:O misaligns consent/hash/locale if the column is absent.

  The shipped pre-deploy warning:
  ```js
  138    // ⚠️ PRE-DEPLOY ACTION FOR THIS CHANGE — Column L now carries the end PRICE of
  139    // the enquiry (a bare number) from the /stay/ pill or the Offers modal; blank
  140    // when the enquiry came from neither. Inserting price at L shifts the three
  141    // trailing columns one right: consent → M, source_ip_hash → N, locale → O, and
  142    // the range widened A:N → A:O. BEFORE DEPLOYING: insert a new column L in the
  143    // sheet with header "Price" so consent / source_ip_hash / locale move to
  144    // M / N / O and stay aligned with their data — otherwise the schema drifts.
  ```

  - **Where:** [`worker/src/sheets.js:115`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/sheets.js#L115) · [`worker/src/sheets.js:157-160`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/sheets.js#L157-L160)
  - **Proposed fix:** Move the pre-deploy step to a runbook; leave a standing “sheet header must have Price at column L” note; verify the live sheet.

- **W-01** · [`worker/src/index.js:34-422`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L34-L422) · dead-code · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied) — Drop the ref.
  - **In plain terms:** The server still generates a reference code and returns it, but it’s no longer written to the sheet and the site no longer reads it — leftover from a removed feature.
  - **The issue:** `generateRef()` is still called/returned, but the ref no longer occupies a sheet cell and the client no longer reads `data.ref`.

  Generated + returned, but orphaned:
  ```js
  396        const ref = generateRef();
  397        return isJson
  398          ? jsonResponse({ ok: true, ref }, 200, request, env)
  ```

  - **Proposed fix:** Drop the returned ref, or wire it back into the sheet/client if still intended.

- **W-02** · [`worker/src/index.js:387-400`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L387-L400) · comment-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied) — Drop the comment.
  - **In plain terms:** A comment claims the anti-bot honeypot makes a fake submission take the same time as a real one, but a real submission also writes to the sheet (extra time) — so timing can still distinguish them.
  - **The issue:** The honeypot-trip path skips the Sheets append the success path performs, so it only matches the captcha-FAILED timing, not accepted+written.

  ```js
  387      const honeypotVal = typeof body.alt_url === 'string' ? body.alt_url.trim() : '';
  388      if (honeypotVal !== '') {
  389        // Burn a Turnstile round-trip to equalise timing. The result is
  390        // discarded — we always return success on honeypot trip.
  391        await verifyTurnstile(
  392          body['cf-turnstile-response'] || '',
  393          env.TURNSTILE_SECRET,
  394          ip,
  395        ).catch(() => null);
  396        const ref = generateRef();
  397        return isJson
  398          ? jsonResponse({ ok: true, ref }, 200, request, env)
  399          : redirectResponse('/enquiries/thanks/', request, env, locale);
  400      }
  ```

  - **Proposed fix:** Correct the comment to say the trip equalises only to the captcha-failed path, not written-success.

- **W-03** · [`worker/src/index.js:248`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L248) · bug · **low** · CONFIRMED (3/3)
  - **In plain terms:** The 16KB size pre-check reads a header the client controls; omit it and the pre-check reads 0 and passes — the real limit is the downstream per-field caps (so it’s by design, just worth knowing).
  - **The issue:** The pre-cap uses `parseInt(content-length)`; a missing/chunked header yields 0 and passes.

  ```js
  248      const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  249      if (contentLength > 16 * 1024) {
  ```

  - **Proposed fix:** Leave as a documented cheap-reject; rely on per-field caps (or cap the read stream length).

- **W-04** · [`worker/src/offers.js:224-245`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/offers.js#L224-L245) · security · **low** · CONFIRMED (3/3)
  - **In plain terms:** The public offers response includes an internal label (e.g. “Offer 1”) and duplicate date fields that visitors don’t need to see — minor internal-detail leak.
  - **The issue:** `toPublicOffer` ships an internal `label` and redundant `startRaw`/`endRaw` in the public payload.

  ```js
  224  export function toPublicOffer(offer) {
  225    const pub = {
  226      label: offer.label,
  227      startDate: offer.startDate,
  228      endDate: offer.endDate,
  229      startRaw: offer.startRaw,
  230      endRaw: offer.endRaw,
  231      price: offer.rate,           // generic per-night price (tier value; tier NAME hidden)
  232      minimumToBook: offer.minimumToBook,
  ```

  - **Proposed fix:** Strip `label` and the redundant raw fields from the public payload.

- **W-06** · [`worker/src/rate-limit.js:34-38`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/rate-limit.js#L34-L38) · dead-code · **nit** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** A branch that checks for “empty list” can never run because an item was just added — self-admitted dead code.
  - **The issue:** The `recent.length === 0` branch is unreachable because `now` was just pushed.

  ```js
  30    recent.push(now);
  31    // Empty bucket → delete the key entirely so the Map doesn't grow
  32    // unboundedly over isolate lifetime. (Can't actually hit this branch
  33    // because we just pushed `now`; kept for symmetry / future-proofing.)
  34    if (recent.length === 0) {
  35      buckets.delete(ipHash);
  36    } else {
  37      buckets.set(ipHash, recent);
  38    }
  ```

  - **Proposed fix:** Remove the dead branch, or implement real empty/expired-bucket pruning.

- **W-09** · [`worker/src/lib/response.js:99`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/lib/response.js#L99) · config · **low** · CONFIRMED (3/3)
  - **In plain terms:** A fallback redirect address is hardcoded to the current GitHub Pages URL — once the custom domain lands, no-JS form posts could redirect to the wrong place.
  - **The issue:** A hardcoded fallback origin `https://noobcoder1209.github.io` is used for no-Origin redirects, flagged to change at domain launch.

  ```js
  94    // Fallback origin — used when the request had no Origin header (e.g.
  95    // a classic non-CORS form POST from no-JS users). The hardcoded value
  96    // here pins this Worker to the current GitHub Pages hostname; CHANGE
  97    // WHEN CUSTOM DOMAIN LANDS (and add the new origin to ALLOWED_ORIGINS
  98    // in wrangler.toml at the same time).
  99    const origin = pickOrigin(request, env) || 'https://noobcoder1209.github.io';
  ```

  - **Proposed fix:** Move the fallback origin to config/env and update ALLOWED_ORIGINS when the domain lands.

- **S-01** · [`worker/src/index.js:74-195`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L74-L195) · security · **med** · CONFIRMED (3/3)
  - > 🔧 **TO FIX** — Decision: negative-cache the empty rate-bands result in code (~30–60s, also fixes W-05) AND add a Cloudflare dashboard Rate Limiting Rule on /price + /offers.
  - **In plain terms:** The price and offers endpoints have no login, no rate limit, and no captcha, yet each fresh call reads Google Sheets — so an attacker can spam them to exhaust your Sheets quota (which could also block real bookings from being fetched).
  - **The issue:** `/price` and `/offers` are unauthenticated, un-rate-limited, not behind Turnstile; each cold-cache call triggers a Sheets read (60s per-isolate cache; empty-bands disables it).

  `/offers` — no gate before the Sheets read:
  ```js
  74      if (pathname === '/offers') {
  75        if (request.method !== 'GET') {
  76          return jsonResponse({ ok: false, error: 'method' }, 405, request, env);
  77        }
  78        try {
  79          const offers = await getCachedOffers(env);
  80          // Project to the PUBLIC shape before sending — hides the tier name and
  ```

  - **Where:** [`worker/src/index.js:97-127`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L97-L127) · [`worker/src/offers.js:322-334`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/offers.js#L322-L334)
  - **Proposed fix:** Add rate-limiting / caching hardening (edge cache, longer TTL, empty-bands caching) to the read routes.

- **S-02** · [`worker/src/rate-limit.js:17-40`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/rate-limit.js#L17-L40) · security · **med** · CONFIRMED (3/3)
  - > 🔧 **TO FIX** — Decision: covered by the Cloudflare dashboard rate-limit rule (from S-01); no code rebuild — low severity, Turnstile is the real gate.
  - **In plain terms:** The “3 requests per 10 minutes” limit is stored in each server instance’s memory, and Cloudflare runs many instances — so the real limit is much higher, and spam protection actually relies on the captcha.
  - **The issue:** The rate-limiter Map is per-isolate in-memory, so the bound is per-isolate and dilutable across Cloudflare isolates.

  Per-isolate in-memory Map:
  ```js
  17  const WINDOW_MS = 10 * 60 * 1000;
  18  const MAX_REQUESTS = 3;
  19  
  20  const buckets = new Map();
  21  
  22  export function checkRateLimit(ipHash) {
  ```

  - **Proposed fix:** Move to a Durable Object / KV for cross-isolate accuracy if stronger spam bounds are needed.

- **S-03** · [`worker/src/index.js:265-273`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js#L265-L273) · security · **low** · CONFIRMED (3/3)
  - > 🔧 **TO FIX**
  - **In plain terms:** Rate limiting keys off the visitor’s IP header. On Cloudflare’s real edge this is trustworthy, but if the worker were ever reachable directly (a tunnel/preview), an attacker could fake the header to get unlimited fresh limits.
  - **The issue:** Keying trusts `cf-connecting-ip`; safe on the real edge (bails 400 if absent), but client-controlled off-edge.

  ```js
  265      const ip = request.headers.get('cf-connecting-ip');
  266      if (!ip) {
  267        return jsonResponse(
  268          { ok: false, error: 'no-ip' },
  269          400,
  270          request,
  271          env,
  272        );
  273      }
  ```

  - **Proposed fix:** Ensure the Worker is only reachable via the Cloudflare edge (block direct/tunnel access), or add a secondary key.

- **S-04** · [`package.json:16-19`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/package.json#L16-L19) · security · **med** · CONFIRMED (3/3)
  - > ✅ **DONE** — ran npm audit fix (non-breaking dev advisories: 5 → 2; the remaining 2 are the deferred breaking vite@8 bump);
  - **In plain terms:** `npm audit` flags 5 vulnerabilities, but all are in build-time dev tools — zero affect the shipped site (`npm audit --omit=dev` = 0). The one needing a big upgrade (esbuild via vite) is a breaking major bump.
  - **The issue:** 5 dev-toolchain advisories (vite→esbuild, postcss, nanoid, brace-expansion); `--omit=dev` reports 0.

  Only runtime dep is flatpickr; the rest are dev:
  ```json
  13    "dependencies": {
  14      "flatpickr": "^4.6.13"
  15    },
  16    "devDependencies": {
  17      "googleapis": "^173.0.0",
  18      "node-html-parser": "^9.0.0",
  19      "vite": "^5.4.10"
  ```

  - **Proposed fix:** Track the dev-toolchain advisories; schedule the breaking vite bump; no prod action required.

- **S-05** · [`.github/workflows/deploy.yml:49-51`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/.github/workflows/deploy.yml#L49-L51) · bug · **med** · CONFIRMED (2/3)
  - **In plain terms:** A fallback snippet in the deploy workflow writes a file using a shell here-doc whose closing marker is indented — which can fail to end the block in strict shells and may break fork/PR builds. Needs a real run to confirm.
  - **The issue:** The fallback `bookings.json` heredoc uses `<<EOF` (not `<<-EOF`) with an indented body and indented `EOF`.

  ```yaml
  49              cat > public/assets/data/bookings.json <<EOF
  50            {"generatedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","fallback":true,"bungalows":{"B1":{"unavailable":[],"checkIn":[]},"B2":{"unavailable":[],"checkIn":[]},"B3":{"unavailable":[],"checkIn":[]}}}
  51            EOF
  ```

  - **Proposed fix:** Use `<<-EOF` with tab indentation, or de-indent the closing `EOF` to column 0. (Panel 2/3 — verify on the ubuntu runner.)

- **S-06** · [`.github/workflows/deploy.yml:24`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/.github/workflows/deploy.yml#L24) · security · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** — SHA-pinned all GitHub Actions in ci.yml / deploy.yml / refresh-bookings.yml;
  - **In plain terms:** One workflow pins its GitHub Actions to exact commit hashes (safest), but the other three use floating version tags — an inconsistent supply-chain posture.
  - **The issue:** `deploy-worker.yml` SHA-pins actions; ci.yml/deploy.yml/refresh-bookings.yml use floating tags.

  Pinned (good):
  ```yaml
  42          uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4
  ```
  Floating:
  ```yaml
  24        - uses: actions/checkout@v4
  ```

  - **Proposed fix:** SHA-pin actions across all workflows for a consistent posture.

- **S-07** · [`worker/wrangler.toml:29`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/wrangler.toml#L29) · comment-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** A config comment says the offers spreadsheet range is B3:H8, but the code reads A3:N8 (14 columns).
  - **The issue:** wrangler.toml comment says range B3:H8; offers.js reads A3:N8.

  The stale comment:
  ```toml
  29  # Tab name within GSHEETS_SHEET_ID holding the offers table (range B3:H8).
  ```
  The actual range read:
  ```js
  260    const ranges = [`'${tab}'!A3:N8`, `'${tab}'!A16:C25`];
  ```

  - **Proposed fix:** Update the comment to A3:N8 (14 columns).

- **S-08** · [`worker/wrangler.toml:1-15`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/wrangler.toml#L1-L15) · comment-stale · **low** · CONFIRMED (3/3)
  - > ✅ **DONE** (comment fix applied)
  - **In plain terms:** The worker’s deployed name is “vayana-enquiries,” but the header comment, package.json, and README all call it “vayana-enquiries-worker.”
  - **The issue:** wrangler.toml `name` is “vayana-enquiries”; comment/package.json/README say “vayana-enquiries-worker”.

  Authoritative name:
  ```toml
  15  name = "vayana-enquiries"
  ```
  Stale header comment:
  ```toml
  1  # Cloudflare Worker — vayana-enquiries-worker
  ```

  - **Proposed fix:** Reconcile the name across comment/package.json/README to match wrangler.toml (or vice versa).

- **L-01** · [`locales/en.json:5`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/locales/en.json#L5) · consistency · **high** · CONFIRMED (3/3)
  - **In plain terms:** The translator reference codes (“Code 102· …” / “Код 102· …”) are still on the live text and would show to real visitors. They’re also lopsided — 327 remain in English, 531 in Bulgarian — which means the writer is mid-edit. (Per your instruction, left untouched.)
  - **The issue:** Translator `Code·/Код·` prefixes remain on live locale values (would ship to prod), asymmetric (EN 327 / BG 531), no cross-locale leakage.

  EN:
  ```json
  5      "tagline": "Code 102· Boutique Bungalows in Tsarevo, Bulgaria"
  ```
  BG:
  ```json
  5      "tagline": "Код 102· Бутик бунгала в Царево, България"
  ```

  - **Proposed fix:** Strip all `Code·/Код·` translator prefixes from both locale files before launch (owner: deferred — writer still working).

---

## Refuted (appendix)

These claims did **not** survive verification (0/3 confirm). Kept for auditability.

- **C-16** · [`assets/js/offers.js:93-102`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/offers.js#L93-L102) · dead-code · **REFUTED (3/3 refute)**
  - **In plain terms:** The claim said certain offer slots were switched off via empty `setSlot` calls — but there is no `setSlot` function at all, and the “message” slot is in fact actively used. The premise was simply wrong.
  - **What the source shows:** the helper is `add(cls,text)`, dormant slots emit no code, and `buildMessage(text)` is actively invoked for empty/error states.

- **R-01** · [`worker/package.json:15-17`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/package.json#L15-L17) · known-flip check · **REFUTED (3/3 refute)**
  - **Claim tested:** “`jose` is an undeclared dependency, so 3 worker tests fail.”
  - **What the source shows:** `worker/package.json` declares `"jose": "^5.9.6"`. It IS declared. (The real, distinct issue is D-03: it’s in the *worker* package, so a root-only `npm ci` misses it.)

- **R-02** · [`assets/js/booking.js:140-142`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/booking.js#L140-L142) · known-flip check · **REFUTED (3/3 refute)**
  - **Claim tested:** “The home dock Check Availability drops the picked dates and doesn’t forward them to `/stay/`.”
  - **What the source shows:** `setupLinkForm` sets `checkin`/`checkout` search params before `location.assign`, targeting `stay/`. Dates ARE forwarded.

---

## Comment-correctness pass

Per-file summary of comments read, with every stale/wrong/misplaced comment. Files not listed with issues had all comments correct.

**Files with ALL comments correct** (no stale/wrong/misplaced): `assets/js/main.js` (2), `assets/js/parallax.js` (3), `assets/js/reveal.js` (6), `assets/js/util/is-primary-click.js` (4), `assets/js/util/current-locale.js` (6), `assets/js/util/offer-dates.js` (14), `assets/js/hero-carousel.js` (9), `assets/js/bookings-data.js` (10), `assets/js/season-picker.js` (8), `assets/js/season.js` (12), `assets/js/site-config-inject.js` (13), `assets/js/location.js` (9), `assets/js/lang.js` (18), `assets/js/lightbox.js` (11), `assets/js/slider.js` (16), `assets/js/offers.js` (14), `assets/js/offer-modal.js` (12), `assets/js/availability-calendar.js` (22), `assets/js/calendar-selection.js` (45), `scripts/check-no-secrets.sh` (9, one incomplete-not-wrong note below), `worker/src/turnstile.js` (3), `worker/src/lib/response.js` (12), `worker/src/lib/ip-hash.js` (2).

**[`assets/js/site-config.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/site-config.js)** — 9 comments
- L16 · **stale** — describes address as `short`/`full` with "Tsarevo, Bulgaria" + street line, but the actual object is `{ line1:'Arapya', line2:'Bulgaria', country:'Bulgaria', mapEmbed, directionsUrl }` (no short/full, no Tsarevo, no street). Correction: rewrite to describe line1/line2/country.

**[`assets/js/newsletter.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/newsletter.js)** — 16 comments
- L1 · **wrong** — header cites issue #10, but TODO L6 cites #19 and L133 cites "v2 (#14)" for the same ESP work; issue numbers disagree. Correction: reconcile to one correct issue number.
- L133 · **wrong** — cites "v2 (#14)" while the L6 TODO names #19 for wiring the real ESP request. Correction: use the same issue number as the L6 TODO.

**[`assets/js/header.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/header.js)** — 30 comments
- L99 · **stale** — enumerates "4 close paths" but code wires a fifth (explicit × button, self-labelled "close path #5" at L353-354). Correction: list 5 paths.
- (L353 "Explicit × button (close path #5)" is **correct** and is the corroborating evidence.)

**[`assets/js/booking.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/booking.js)** — 30 comments
- L84 · **stale** — "Used by the /enquiries/ bar … and the home floating dock", but `setupLinkForm` is only ever called with `'stay/'` (L58); no `/enquiries/` caller exists. Correction: drop the `/enquiries/` claim.
- L112 · **stale** — "forward to /enquiries/ a reversed date pair" — only wired target is `stay/`. Correction: change `/enquiries/` to `/stay/`.

**[`assets/js/enquiry.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/assets/js/enquiry.js)** — 55 comments
- L684 · **stale** — "In v1 there's no network call… In v2 (#15) the success path will fire the Worker fetch"; but the fetch is already wired in this handler (L767) and the header says #15/#20 are being closed. Correction: rephrase to present tense.
- L146 · **wrong** — "The flag is set further down (line ~131)" but `form.dataset.enquiryInit='1'` is at L201 (L131 is inside BUNGALOW_SLUGS). Correction: change to "line ~201" or drop the number.

**[`scripts/i18n-plugin.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-plugin.js)** — 78 comments
- L16 · **stale** — "147×2 as of Task #162"; actual leaf keys = 586 each. Correction: "586×2" or drop the count.
- L57 · **wrong** — "The `closeBundle` hook … writes the BG variant"; no closeBundle hook exists; emit is in `writeBundle` (L1986). Correction: replace with writeBundle.
- L100 · **wrong** — "the closeBundle hook is where the BG mirror gets emitted"; it's writeBundle. Correction: replace with writeBundle.
- L128 · **wrong** — cites `common.header._note_DO_NOT_TRANSLATE_lang_aria_keys` as the deepest key at "4 segments", but it is 3 segments and not deepest; the deepest is `bungalows.common.booking.checkin_label` (4). Correction: cite the correct deepest key.
- L705 · **wrong** — truncated/garbled sentence ("Vite's transformIndexHtml runs it for" with no completion, running into the "Dev mode:" line). Correction: delete the dangling fragment.
- L984 · **stale** — error message enumerates only srcdoc/style/onload, but FORBIDDEN_ATTR_NAMES also contains `target` (L926-931), so a rejected `target:` prints a misleading sink list. Correction: include `target` or list the set dynamically.
- L1806 · **wrong** — "Registers three Vite hooks: … closeBundle"; factory returns configResolved/transformIndexHtml/writeBundle/configureServer (four, no closeBundle). Correction: rename to writeBundle, fix "three"→"four".
- L410 · **misplaced** — the ~7-line entity-matching comment is duplicated verbatim (403-409 then 410-416). Correction: delete the duplicate at 410-416.

**[`scripts/i18n-lint.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/i18n-lint.js)** — 34 comments
- L64 · **wrong** — "parse5 (used by the plugin) normalises to lowercase…"; the plugin uses `node-html-parser` (i18n-plugin.js L117), not parse5. The `i` flag is still justified, but the stated reason is wrong. Correction: replace "parse5" with "node-html-parser" and base the rationale on attribute-name case-insensitivity.
- L60 · **wrong** — claims the `(?![\w-])` lookahead uniformly excludes `data-i18n-html` across "each attribute name", but that exclusion only holds for the plain-text RE_I18N_TEXT; the HTML/ATTR/META REs intentionally match their longer names. Correction: scope the sentence to the RE_I18N_TEXT case.

**[`scripts/fetch-bookings.mjs`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/fetch-bookings.mjs)** — 30 comments
- L15 · **stale** — labels the column numbers "1-based letters / 0-based indices" but they are purely 0-based indices (AG=32 = COL_ID; AG is 1-based column 33). Correction: drop the "1-based letters" half; label consistently as 0-based indices.
- L85 · **stale** — "only actually reading the sheet [validates env]"; contradicted by `main()` (L268) which calls `getSheets()` eagerly to validate env / prime `_saEmail`. Correction: note main() primes getSheets() eagerly while import alone stays lazy.

**[`scripts/check-no-secrets.sh`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/scripts/check-no-secrets.sh)** — 9 comments
- L33 · **stale (incomplete, not false)** — the token-pattern list omits the `"private_key":\s*"-----BEGIN` JSON-field pattern that the grep at L45 also matches. Correction: add "and JSON private_key fields" to the list.

**[`vite.config.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/vite.config.js)** — 14 comments
- L15 · **stale** — "Hoisted so the i18n plugin can enumerate the same set for BG-mirror emission"; the plugin's writeBundle iterates the emitted `bundle` (i18n-plugin.js L1993), not INPUTS. INPUTS is still passed for plugin validation and Rollup input. Correction: state INPUTS is shared for `build.rollupOptions.input` + plugin validation, while BG mirroring walks the emitted bundle.

**[`worker/src/index.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/index.js)** — 32 comments
- L3-16 · **stale** — the 12-step lifecycle header describes only `/submit` and claims "only /submit accepted", but the code handles GET `/offers` (L74-89) and POST `/price` (L97-195) before the L200 path gate. Correction: add /offers and /price; drop "only /submit accepted".
- L219 · **wrong** — inline "// 3. Content-type detect" duplicates the "// 3. Method gate" at L209, then body-size is 3b and rate-limit jumps to 4 (inconsistent numbering). Correction: renumber content-type to 4 (single monotonic sequence).
- (L37-43 KNOWN_LOCALES cross-file-invariant note is **correct**.)

**[`worker/src/offers.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/offers.js)** — 40 comments
- L6-11 · **stale** — "every catch logs ONLY a generic string"; offers.js's catch blocks (L269, L278) throw generic Errors and do NOT log (no console.error in the file). The getAccessToken/token-cache half is correct. Correction: reword to "every catch throws a generic Error (never err.message)".
- (L23 COL-map "A3:N8 … A is index 0" is **correct**.)

**[`worker/src/validation.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/validation.js)** — 30 comments
- L10 · **stale** — "// Mirrors enquiry.js:21"; EMAIL_RE is at enquiry.js:45 (L21 is an unrelated fragment). Correction: cite enquiry.js:45.
- L12 · **stale** — "// Mirrors enquiry.js:35"; PHONE_RE is at enquiry.js:59. Correction: cite enquiry.js:59.
- L14 · **stale** — "// Mirrors enquiry.js:25,41,47,52"; the four cap constants are at enquiry.js:71/49/65/76. Correction: update the citation (or drop the line numbers).
- (L49-56 ALLOWED_OPTIONAL_COUNT behavioural note is **correct**.)

**[`worker/src/pricing.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/pricing.js)** — 22 comments
- L33-36 · **wrong** — `round2` rounds to whole CENTS (2 decimals), not whole euros; "killing binary-float dust like 669.9999999999999 → 670" with a whole-number example misleads (it can return 437.50). Correction: reword example to `→ 670.00` and note whole-euro rounding is done separately in index.js:193.
- (L10-17 four-discount-formula header is **correct**.)

**[`worker/src/sheets.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/sheets.js)** — 14 comments
- L138-144 · **stale** — the "⚠️ PRE-DEPLOY ACTION … BEFORE DEPLOYING insert column L" block reads as a pending code change, but the code side is already committed (range A:O L115; price at index 11 L157; layout comment "Current layout (A:O, 15 columns)"); only a manual sheet-header edit remains. Correction: demote to a standing "sheet header must have Price at column L" note.
- (L122-136 A:O 15-column layout + ref note is **correct**.)

**[`worker/src/rate-limit.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/rate-limit.js)** — 3 comments
- L1-15 · **stale** — header claims empty-bucket deletion bounds the working set to currently-active IPs, but that delete branch (L34) is unreachable (self-admitted L32-33), so buckets for quiet IPs are never removed; working set = all IPs seen during isolate life. Correction: implement real pruning, or correct the header to say buckets are never actually deleted.
- (L31-33 self-description of the dead branch is **correct** — it is the header above that is stale.)

**[`worker/src/lib/ref.js`](https://github.com/NoobCoder1209/vayana-bungalows/blob/2402fef41215dc4076bbe0d1362190fdfea2cdb3/worker/src/lib/ref.js)** — 2 comments
- L7 · **wrong** — "~48 bits of entropy"; 8 bytes each reduced via `% 32` (uniform 5 bits) = 40 bits, not 48. Correction: change "~48 bits" to "40 bits".
- L6 · **stale** — "12 base32-ish chars derived from 8 random bytes"; only 8 chars derive from the bytes; the 12-char total comes from the `VB-` prefix + an internal `-`. Correction: reword to "8 base32-ish chars … formatted as VB-XXXX-XXXX".

---

## Method

Report-only audit — no code was changed. Every embedded recon finding was re-verified by a **3-verifier zero-context majority panel** (each verifier judges independently against the source; verdict = majority of CONFIRMED / REFUTED / NEEDS_RUNTIME, with the panel vote recorded per finding, e.g. 3/3 or 2/3). Known-flip checks (R-01, R-02) were run to catch confirmation bias by testing the inverse claim. A separate **exhaustive per-file comment-correctness pass** read every comment in each file and classified each as correct / stale / wrong / misplaced with a proposed correction. Fixing is out of scope; this document is the deliverable.