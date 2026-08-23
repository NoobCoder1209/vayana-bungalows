# Vayana Bungalows — Audit Report

## Summary

**Counts by section**
- Fixable-now: 15 findings (all CONFIRMED)
- Report-only: 25 findings (24 CONFIRMED, 0 NEEDS_RUNTIME)
- Refuted (appendix): 3 (C-16, plus known-flip checks R-01, R-02)

**Counts by severity (Fixable-now + Report-only, CONFIRMED/NEEDS_RUNTIME only)**
- high: 2 (C-01, L-01)
- med: 12 (C-02, C-04, C-09, C-10, C-13, C-14, C-15, T-01, D-03, W-05, W-07, W-08, S-01, S-02, S-04, S-05) — see per-cluster breakdown
- low: 18
- nit: 6

**Counts by cluster (Fixable-now + Report-only)**
- client: 20 (C-01…C-15, C-17, C-18, C-19, C-20, C-21; C-16 refuted)
- build: 10 (B-01…B-10)
- test: 2 (T-01, T-02)
- docs: 3 (D-01, D-02, D-03)
- worker: 9 (W-01…W-09)
- config: 6 (S-04, S-05, S-06, S-07, S-08, plus S-01/S-02/S-03 filed under worker)

**Top 5 highest-value items**
1. **L-01** — translator `Code./Kod.` prefixes ship to prod on all locale values (high, asymmetric 327 vs 531).
2. **C-01** — `setupLinkForm` comments reference a nonexistent `/enquiries/` bar; sole caller forwards to `stay/` (high).
3. **W-08** — un-actioned "PRE-DEPLOY: insert Price column L" warning shipped in code; RAW A:O append misaligns consent/hash/locale if the live sheet lacks the column (med).
4. **W-07** — `DiscountTotal` pricing has no floor; a misconfigured discount yields a negative total accepted by `index.js` (med).
5. **S-01 / S-02** — `/price` and `/offers` are unauthenticated, un-rate-limited, not behind Turnstile; each cold-cache call reads Google Sheets (Sheets-quota-drain), and the rate limiter is per-isolate in-memory (med).

**SECURITY POSTURE.** No committed secrets were found — the pre-commit secret scanner is present (`scripts/check-no-secrets.sh`), `npm audit --omit=dev` reports **0** production vulnerabilities (the 5 dev-toolchain findings in S-04 never ship), and `bookings.json` carries no PII (the client data layer treats the legacy array shape as empty, and the IP-hash lib SHA-256s the client IP with a hard-fail short-salt guard). Injection defenses in the i18n build are strong and fail-closed: a tag allowlist (`<a>/<strong>/<em>/<br>`), forbidden XSS-sink attributes, an HTML-entity double-escape guard, and an href scheme allowlist (B-05/B-06/D-01) — though the srcset guard is over-strict (fail-closed, not a hole). The remaining risk is **abuse/availability, not confidentiality**: unauthenticated `/price` + `/offers` funnel to a Google Sheets read with only a 60s per-isolate cache that empty rate-bands disable (S-01, W-05), the "3 req / 10 min / IP" limiter is per-isolate and dilutable across Cloudflare isolates so spam protection leans entirely on Turnstile (S-02), and the `cf-connecting-ip` key is rotatable for unlimited fresh buckets if the Worker is ever reachable off-edge (S-03). The honeypot timing channel (W-02) and the attacker-controlled `Content-Length` pre-cap (W-03) are low-severity and self-documented. Net: confidentiality posture is sound; the actionable exposure is Sheets-quota / spam amplification on the two unauthenticated read routes plus one correctness bug (W-07 negative price) that could persist bad data.

---

## Fixable-now

### client

- [ ] **C-01** · `assets/js/booking.js:81-133` · comment-stale · **high** · CONFIRMED (3/3)
  - **Finding:** `setupLinkForm` comments reference a `/enquiries/` bar and forwarding "to `/enquiries/`", but no such link-bar exists (no `data-booking-mode` in `enquiries/index.html`); the sole caller is the home dock forwarding to `stay/`.
  - **Evidence:** booking.js:84 `// Used by the /enquiries/ bar (legacy detail pages) and the home floating dock`; :112 `// still display (and forward to /enquiries/) a reversed date pair.`; :128 `// Resolve the target (enquiries/ or stay/)…`. `grep data-booking-mode enquiries/` returns nothing. Sole invocation: booking.js:57-58 `.forEach((form) => setupLinkForm(form, 'stay/'));`.
  - **Fix:** Delete the `/enquiries/` references; document the single `stay/` target.

- [ ] **C-10** · `assets/js/newsletter.js:175` · bug · **med** · CONFIRMED (3/3)
  - **Finding:** Escape handler bound at `document` level (cross-page-lifecycle listener leak), whereas enquiry.js was deliberately changed to modal-scoped to fix exactly this.
  - **Evidence:** newsletter.js:175 `document.addEventListener('keydown', …)`; enquiry.js:809 `modal.addEventListener('keydown', …)` with comment 802-808 "Round-2 review finding B-R2-3 — was previously `document.addEventListener`".
  - **Fix:** Scope the keydown listener to `modal` as enquiry.js does.

- [ ] **C-09** · `assets/js/header.js:98-102` · comment-stale · **med** · CONFIRMED (3/3)
  - **Finding:** Drawer doc comment enumerates "4 close paths" but code wires a FIFTH (explicit × button at ~line 353, labelled "close path #5").
  - **Evidence:** header.js:96-102 enumerates paths 1-4; header.js:353-354 `// Explicit × button (close path #5).` `if (closeBtn) closeBtn.addEventListener('click', close);`.
  - **Fix:** Update the enumeration to list 5 paths including the × button.

- [ ] **C-13** · `assets/js/availability-calendar.js:259-266` · perf · **med** · CONFIRMED (3/3)
  - **Finding:** `renderInstance` rebuilds `weekdayShortNames()` (7× `Intl.DateTimeFormat`) plus a new `Intl.DateTimeFormat` per instance per render; `renderAll` runs all 3 instances on every month-step and click, so locale-constant formatters are re-instantiated many times per interaction.
  - **Evidence:** availability-calendar.js:259-264 build `weekdays` + `dayFormatter` inside `renderInstance`; :76-80 build 7 formatters; renderAll (:321) `instances.forEach(renderInstance)` invoked at stepMonth (:154), prev/next/today (:309/313/316), rerenderCalendars (:60).
  - **Fix:** Hoist the locale-keyed formatters to module scope, rebuilding only when `currentLocale()` changes.

- [ ] **C-11** · `assets/js/newsletter.js:97-98` · bug · **low** · CONFIRMED (3/3)
  - **Finding:** Consent change handler calls `flagConsent(false)` but not `clearError()`, so a consent error pill lingers after the user ticks consent (enquiry.js calls `clearError` on change).
  - **Evidence:** newsletter.js:97-99 handler calls `flagConsent(false)` only; enquiry.js:477-479 also calls `clearError()`. `clearError` (newsletter.js:86-89) sets `errorEl.hidden = true`.
  - **Fix:** Add `clearError();` to the newsletter consent-change handler.

- [ ] **C-05** · `assets/js/enquiry.js:124,219` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** Module-scope `let` bindings are justified by comments citing "a future runtime language swap (issue #47)", but lang.js states a language change is a full navigation, not a runtime string swap — so the justifying comment is stale re: the shipped architecture.
  - **Evidence:** enquiry.js:122-124 / :216-217 / :226-227 cite the runtime swap; contradicted by lang.js:28-29 "A language change is a navigation, not a string swap."
  - **Fix:** Remove the runtime-swap justification (or convert to plain `const`) and reference the build-time i18n architecture.

- [ ] **C-06** · `assets/js/enquiry.js:723-728` · dead-code · **low** · CONFIRMED (3/3)
  - **Finding:** Local `toISO` duplicates `toIso` from bookings-data.js, which the file already imports from.
  - **Evidence:** enquiry.js:723 `const toISO = (d) => {…}` duplicates bookings-data.js:52 `export const toIso`; enquiry.js:39 already `import { parseIso } from './bookings-data.js';`.
  - **Fix:** Import `toIso` from bookings-data.js and delete the local copy.

- [ ] **C-12** · `assets/js/newsletter.js:180` · dead-end · **low** · CONFIRMED (3/3)
  - **Finding:** `openModal(modal, getReturnFocusEl)` declares a second param never used inside `openModal` (focus restore lives in `closeModal`); the caller passes an arg that is discarded.
  - **Evidence:** newsletter.js:180 declares the param, body 181-189 never references it; focus restore at closeModal :198-200; caller :107 passes `() => lastFocusBeforeModal`.
  - **Fix:** Drop the unused parameter and the discarded caller argument.

- [ ] **C-03** · `assets/js/booking.js:158` · dead-code · **nit** · CONFIRMED (3/3)
  - **Finding:** `const today = new Date()` is used exactly once (to compute `tomorrow`), an inlineable binding.
  - **Evidence:** booking.js:158 declared, referenced only at :160 `tomorrow.setDate(today.getDate() + 1);` (the other "today" occurrences are flatpickr string literals).
  - **Fix:** Inline `new Date()` into the `tomorrow` computation.

- [ ] **C-08** · `assets/js/enquiry.js:443-452` · comment-stale · **nit** · CONFIRMED (3/3)
  - **Finding:** Comment lead sentence says the 3 selects are "intentionally omitted from allFields", but a POST-#41 addendum + line 452 show `adults` IS in `allFields`.
  - **Evidence:** enquiry.js:441-442 lead sentence vs :446-448 addendum "Adults is now REQUIRED… It joins allFields" and :452 array includes `adults`.
  - **Fix:** Rewrite the lead sentence to say only children/infants are omitted; adults is required and included.

- [ ] **C-17** · `assets/js/hero-carousel.js:63` · comment-stale · **nit** · CONFIRMED (3/3)
  - **Finding:** Comment says "most visible at the 8→1 wrap" implying 8 slides, but slide count is data-driven (`slides.length`).
  - **Evidence:** hero-carousel.js:62-63 hardcodes "8→1 wrap"; :26/:41 derive from `slides.length` — no literal 8.
  - **Fix:** Change "8→1" to "last→first" (or `slides.length`→1).

- [ ] **C-18** · `assets/js/parallax.js:32-33` · perf · **nit** · CONFIRMED (3/3)
  - **Finding:** Resize listener bound without `{passive:true}` while the scroll listener has it; the resize handler rAF-throttles so impact is negligible (minor inconsistency).
  - **Evidence:** parallax.js:31 scroll `{ passive: true }`; :32 resize omits it; both use `onScroll` (:24-29) which rAF-throttles.
  - **Fix:** Add `{ passive: true }` to the resize listener for consistency.

### test

- [ ] **T-01** · `package.json:test script` · test-gap · **med** · CONFIRMED (3/3)
  - **Finding:** The npm `test` script hand-enumerates test files and OMITS `assets/js/util/__tests__/offer-dates.test.mjs` (present on disk), so offer-dates.js is never exercised by npm test or CI.
  - **Evidence:** package.json:10 enumerates test files without offer-dates; `grep -c "offer-dates" package.json` = 0; file exists (8293 bytes) alongside source (5007 bytes).
  - **Fix:** Add the offer-dates test to the script, or switch to a glob to prevent silent omission.

### docs

- [ ] **D-03** · `README.md:setup` · dx · **med** · CONFIRMED (3/3)
  - **Finding:** A fresh clone running only root `npm ci && npm test` fails 3 worker tests with `ERR_MODULE_NOT_FOUND` because `jose` lives in worker/node_modules; root docs omit `cd worker && npm ci` (CI does it, local docs do not).
  - **Evidence:** package.json:10 pulls worker tests; `jose` imported at worker/src/sheets.js:17, declared only in worker/package.json; 3 worker tests transitively load sheets.js; README.md:13-18/38 give only `npm install`/`npm test`; ci.yml:64-72 does the worker install with an explanatory comment.
  - **Fix:** Add a `cd worker && npm ci` step to the README setup instructions.

- [ ] **D-01** · `README.md:134-139` · doc-stale · **low** · CONFIRMED (3/3)
  - **Finding:** README says the plugin resolves "five" marker attributes but only four exist; the sanitizer description omits allowed `<a>` and `<strong>`.
  - **Evidence:** README.md:134 "five marker attributes" vs table :138-141 lists four; :139 sanitizer "(`<em>`/`<br>` only)" vs i18n-plugin.js:589 `ALLOWED_HTML_TAGS = ['a','strong','em','br']`.
  - **Fix:** Correct "five"→"four" and list all four allowed tags.

- [ ] **D-02** · `SITEMAP.md:5,35,148` · doc-stale · **low** · CONFIRMED (3/3)
  - **Finding:** SITEMAP says "eight pages" and that privacy/terms/cancellation footer links "today 404", but vite.config defines 12 entries and the policy pages exist and build (smoke test asserts 12 EN + 12 BG).
  - **Evidence:** SITEMAP.md:5/148/146 vs vite.config.js INPUTS (12 entries incl. privacy/terms/cancellation); dirs exist; i18n-smoke.test.mjs:191-192 asserts ≥12 EN pages.
  - **Fix:** Update the page count to 12 and mark the policy pages as built/live.

---

## Report-only

### client

- **C-02** · `assets/js/booking.js:346-356` · i18n-hardcode · **med** · CONFIRMED (3/3)
  - **Finding:** Booking modal success title/body copy is hardcoded English built in JS, bypassing the data-attribute i18n pattern, so it renders English on `/bg/` bungalow pages.
  - **Evidence:** booking.js:349 `A reservations specialist will follow up… ${bungalow}…`; :354 `Thank you — your ${bungalow} request is in.` assigned to `modalBody.textContent`/`modalTitle.textContent`.
  - **Fix:** Source the success copy from localized data attributes / i18n table.

- **C-04** · `assets/js/enquiry.js:353-355` · i18n-hardcode · **med** · CONFIRMED (3/3)
  - **Finding:** The `?villa=` prefill writes hardcoded English "Hello, I'd like to enquire about the ${villaName}." with a live (accurate, not stale) TODO i18n at ~346-348; i18n bypass on `/bg/`.
  - **Evidence:** enquiry.js:354 hardcoded write; :346-348 live TODO citing round-1 finding N1; guarded by `?villa=` allowlist :350-352.
  - **Fix:** Source the opener template from site-config.js / an i18n table when Bulgarian copy lands.

- **C-14** · `assets/js/availability-calendar.js:271-296` · i18n-hardcode · **med** · CONFIRMED (3/3)
  - **Finding:** Hardcoded English UI strings baked into the calendar grid HTML (eyebrow "Availability"; legend Available/Booked/Past/Selected; nav title/aria-labels), rendering English on `/bg/stay/`.
  - **Evidence:** availability-calendar.js:271/293-296/276/280/274 literal strings inside `root.innerHTML` (:269) with no translation call.
  - **Fix:** Route the calendar template strings through the i18n layer.

- **C-15** · `assets/js/offer-modal.js:1-6` · comment-stale · **med** · CONFIRMED (3/3)
  - **Finding:** Header comment says the modal shows the FULL offer including "savings" and "message", but both slots are permanently dormant/absent in the current schema.
  - **Evidence:** offer-modal.js:4 "…savings, nights, message"; :109 `setSlot('save','')  // DORMANT`; :113 `setSlot('message','')  // DORMANT`.
  - **Fix:** Drop savings/message from the header enumeration (or note them dormant).

- **C-07** · `assets/js/enquiry.js:428` · bug · **low** · CONFIRMED (3/3)
  - **Finding:** When only `?checkout` is supplied (no valid checkin), the `d >= today` guard allows prefilling a checkout equal to today while `minDate` is tomorrow, leaving a lone checkout below the picker floor (submit-time validation still catches order).
  - **Evidence:** enquiry.js:332 `minDate: tomorrow`; :428 guard `d >= today` true when d==today; :429-430 prefills; submit check :622 validates order only.
  - **Fix:** Use `d >= tomorrow` (or the picker floor) when no valid checkin is present.

- **C-19** · `assets/js/bookings-data.js:76-83` · dead-code · **low** · CONFIRMED (3/3)
  - **Finding:** The `Array.isArray(entry)` branch handles a legacy array shape (schema regression) that may never ship, making it possibly-dead defensive code (self-documented as a guard).
  - **Evidence:** bookings-data.js:78 `if (Array.isArray(entry))` → warn :79-81 → return empty :82; self-doc :73-74.
  - **Fix:** Keep as defensive guard or remove if the legacy shape is confirmed unreachable in prod.

- **C-20** · `assets/js/site-config.js:8-15` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** Comment calls phone/email/social "stubs to be swapped before launch", but phone, email, social and license appear to be real finalized values — the "placeholder" comment is partially stale.
  - **Evidence:** site-config.js:8-10 comment vs real values at :14 phone, :15 email, :39/:40 social, :13 license.
  - **Fix:** Update the comment to reflect that these values are finalized (drop the "stub" framing).

- **C-21** · `assets/js/util/offer-dates.js:35-65` · bug · **low** · CONFIRMED (3/3)
  - **Finding:** offer-dates builds/formats in UTC while calendar-selection.parseOfferMonth parses `?offerMonth` into a LOCAL Date; only YYYY-MM month granularity crosses the boundary so no off-by-one manifests today, but the UTC/local mix is a latent inconsistency.
  - **Evidence:** offer-dates.js:35 `Date.UTC(…)` + :65 `timeZone:'UTC'`; calendar-selection.js:290 `new Date(y,m-1,1)` (local); :287 confirms YYYY-MM only.
  - **Fix:** Make both paths use the same timezone basis (both UTC or both local).

### build

- **B-07** · `scripts/i18n-plugin.js:1650-1669` · bug · **low** · CONFIRMED (3/3)
  - **Finding:** `insertAfterHead` HTML4 charset detection matches a `meta http-equiv="content-type"` tag as the charset anchor regardless of whether `charset=` is present in its content attribute.
  - **Evidence:** i18n-plugin.js:1651 regex requires only `http-equiv="content-type"`, trailing `[^>]*>` matches any/no content; used as anchor :1659-1661.
  - **Fix:** Require `charset=` in the content attribute before treating the tag as the charset anchor.

- **B-01** · `scripts/i18n-plugin.js:55-102,1806` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** Doc comments say the BG mirror is emitted in `closeBundle`, but the implemented hook is `writeBundle` (README agrees).
  - **Evidence:** comments :56/:102/:1801/:1806 say closeBundle; registered hooks are only transformIndexHtml (:1918), writeBundle (:1986), configureServer (:2139); mirror write at :2107; README.md:130 says writeBundle.
  - **Fix:** Replace `closeBundle` with `writeBundle` in the doc comments.

- **B-02** · `scripts/i18n-plugin.js:17` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** Docblock states a hard key count ("147×2 as of Task #162") but the actual leaf-key count is ~586 per locale.
  - **Evidence:** i18n-plugin.js:16-17 "147×2"; en.json=586, bg.json=586 leaf keys.
  - **Fix:** Update to 586×2 or drop the hard count in favor of "the exact same key set".

- **B-03** · `scripts/i18n-plugin.js:71-78` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** "Tokens supported today" list is incomplete: omits `brand, license, address_street, address_country, min, free, pct, amount` that the live vite.config.js context ships.
  - **Evidence:** i18n-plugin.js:73-79 lists only phone/credit/privacy_url/email_href/email_display; vite.config.js:64-67,78-81 ship the omitted tokens.
  - **Fix:** Add the missing tokens to the list (or reference the vite.config context as the source of truth).

- **B-05** · `scripts/i18n-plugin.js:936-947` · dead-end · **low** · CONFIRMED (3/3)
  - **Finding:** `URL_BEARING_ATTRS` includes srcset/imagesrcset but validates via `isAllowedHref` on the whole comma-separated value, which can only fail-closed for a real multi-URL srcset — a guard that never passes a legitimate srcset.
  - **Evidence:** i18n-plugin.js:947-948 add srcset/imagesrcset; :1012 validates whole value; isAllowedHref :692-699 no comma-split; self-conceded :939-946.
  - **Fix:** Add a comma-split srcset check, or remove srcset from URL_BEARING_ATTRS and require `data-i18n-html`.

- **B-08** · `scripts/fetch-bookings.mjs:284-289` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** Next-year rollover reads year+1 tabs only if ALL THREE (B1/B2/B3) exist, but the comment claims it "rolls over without operator intervention", overstating the all-or-nothing guard (partial next-year tabs silently ignored).
  - **Evidence:** fetch-bookings.mjs:53 `TAB_KEYS`; :286 `.every(...)`; comment :283-284 (and :49-50) overstate the guarantee.
  - **Fix:** Note that all three next-year tabs must exist together, or handle partial next-year tabs.

- **B-09** · `vite.config.js:66-67,97-98` · bug · **low** · CONFIRMED (3/3)
  - **Finding:** `address_street` already ends in "Bulgaria" and `address_country` is also "Bulgaria", so rendering both in one sentence duplicates the country.
  - **Evidence:** vite.config.js:66-67 (en) and :97-98 (bg) both `'Arapya, Bulgaria'` / `'Bulgaria'`; comments :56-63 confirm both are separate legal-prose tokens.
  - **Fix:** Drop "Bulgaria" from `address_street` (make it "Arapya") or omit `address_country` in the combined sentence.

- **B-04** · `scripts/i18n-plugin.js:403-416` · dead-code · **nit** · CONFIRMED (3/3)
  - **Finding:** The ~7-line `HTML_ENTITY_RE` rationale comment block is duplicated verbatim (two identical copies back-to-back).
  - **Evidence:** i18n-plugin.js:403-409 and :410-416 byte-for-byte identical.
  - **Fix:** Delete the duplicate copy (keep one).

- **B-06** · `scripts/i18n-plugin.js:673-678` · dead-code · **nit** · CONFIRMED (3/3)
  - **Finding:** The "any other node type silently ignored" branch is unreachable under `PARSER_OPTIONS` (`{comment:true}`), since node-html-parser only emits element/text/comment (self-acknowledged defensive dead code).
  - **Evidence:** i18n-plugin.js:673-677 fall-through with no else; PARSER_OPTIONS :123-126.
  - **Fix:** Keep as documented defensive guard, or remove.

- **B-10** · `vite.config.js:65,96` · nit · **nit** · CONFIRMED (3/3)
  - **Finding:** The `license:` key is mis-indented (2 spaces vs surrounding 4) in both the en and bg context blocks; harmless formatting slip.
  - **Evidence:** vite.config.js:64-66 (en) and :95-97 (bg) show 2-space `license` between 4-space neighbors.
  - **Fix:** Re-indent `license` to 4 spaces.

### test

- **T-02** · `scripts/__tests__/fetch-bookings.test.mjs:whole` · test-gap · **low** · CONFIRMED (3/3)
  - **Finding:** Only `parseReservationTable` is tested; `parseDmy` error paths, `validateHeader` throw, `getSheets` env validation, next-year rollover, and the Completed-ending-exactly-today boundary are untested.
  - **Evidence:** test imports only parseReservationTable (:3); source exports only that (fetch-bookings.mjs:182); untested units at :139/143/147, :174, :92, :55/286-288; only boundary test :76-84 is an Ongoing stay.
  - **Fix:** Add unit tests for the untested functions and the Completed-ending-today boundary.

### worker

- **W-07** · `worker/src/pricing.js:190-193` · bug · **med** · CONFIRMED (3/3)
  - **Finding:** `DiscountTotal` pricing has no floor, so a misconfigured discount larger than the in-window subtotal yields a negative total with `applied:true`, which index.js accepts (only rejects `total===null`), returning/possibly storing a negative price.
  - **Evidence:** pricing.js:190-193 guards only `t>0`, no floor; index.js:152 accepts, :181 only rejects null, :193 preserves negatives, :194 returns `{ok:true,total}`.
  - **Fix:** Clamp the total to a non-negative floor (e.g. `Math.max(0, …)`) or reject negatives in index.js.

- **W-05** · `worker/src/offers.js:322-334` · perf · **med** · CONFIRMED (3/3)
  - **Finding:** While rate bands are transiently empty, `/offers` does not cache and re-reads Google Sheets every request; combined with `/offers` being unauthenticated and un-rate-limited, a Sheets-quota amplification vector.
  - **Evidence:** offers.js:330-333 cache write gated on non-empty bands; :334 returns uncached when empty; self-doc :325-326; getCachedOffers routes through getCachedData :341-343.
  - **Fix:** Cache even the empty-bands result (short TTL) or add a floor/lock so `/offers` doesn't re-read Sheets per request.

- **W-08** · `worker/src/sheets.js:138-161` · comment-stale · **med** · CONFIRMED (3/3)
  - **Finding:** An un-actioned in-code "PRE-DEPLOY ACTION: insert Price column L" warning remains in shipped code; if the live sheet lacks that column, a RAW append on A:O misaligns consent/hash/locale (schema drift). Should be a runbook item, not a shipped comment.
  - **Evidence:** sheets.js:138-144 warning; RAW append A:O (:115/:120); values array places `row.price` before consent/hash/locale (:157-160).
  - **Fix:** Move the pre-deploy step to a runbook; leave a standing "sheet header must have Price at column L" note.

- **W-01** · `worker/src/index.js:34,396,422` · dead-code · **low** · CONFIRMED (3/3)
  - **Finding:** `generateRef()` is still called and returned in the JSON, but the ref no longer occupies a sheet cell and the client success path no longer reads `data.ref`, making the returned ref largely orphaned.
  - **Evidence:** index.js:396/398 and :422/446 generate+return ref; sheets.js:145-161 has no ref cell (self-doc :134-135); enquiry.js:776-777 reads only ok/error, `.ref` grep = 0.
  - **Fix:** Drop the returned ref, or wire it back into the sheet/client if still intended.

- **W-02** · `worker/src/index.js:387-400` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** The honeypot comment claims burning a Turnstile round-trip makes the trip path roughly the same wall-clock as a successful submit, but the trip path never does a Sheets append while the success path does, so a latency-measuring attacker can distinguish accepted+written from tripped.
  - **Evidence:** index.js:391-399 trip (verify only, no append) vs success :404 + :424 append; comment :379-380/:385-386 equalises to the captcha-FAILED path, not accepted+written.
  - **Fix:** Correct the comment to say the trip equalises only to the captcha-failed path, not the written-success path.

- **W-03** · `worker/src/index.js:248` · bug · **low** · CONFIRMED (3/3)
  - **Finding:** The 16KB pre-cap uses `parseInt(content-length)`, an attacker-controlled header; a request with no Content-Length or chunked encoding yields 0 and passes the pre-cap (real bound is then only the downstream per-field caps).
  - **Evidence:** index.js:248-249 `parseInt(get('content-length')||'0')`; null→'0'→0, passes; self-doc :245-247.
  - **Fix:** Leave as documented cheap-reject; rely on per-field caps (or cap the read stream length) — noting it is by-design.

- **W-04** · `worker/src/offers.js:224-245` · security · **low** · CONFIRMED (3/3)
  - **Finding:** `toPublicOffer` ships an internal label ("Offer 1" naming) and redundant `startRaw`/`endRaw` (equal to startDate/endDate for eligible offers) in the public `/offers` payload — minor internal-info exposure and dead duplicate fields.
  - **Evidence:** offers.js:226 ships `label` (:25 documents it as display/debug); :229-230 ship startRaw/endRaw; :148-150 build them equal to startDate/endDate.
  - **Fix:** Strip `label` and the redundant raw fields from the public payload.

- **W-06** · `worker/src/rate-limit.js:34-38` · dead-code · **nit** · CONFIRMED (3/3)
  - **Finding:** The `recent.length === 0` branch is unreachable because `now` was just pushed (self-admitted "kept for symmetry").
  - **Evidence:** rate-limit.js:30 `recent.push(now)` → length ≥1 at :34; self-admission :32-33.
  - **Fix:** Remove the dead branch or implement real empty/expired-bucket pruning.

- **W-09** · `worker/src/lib/response.js:99` · config · **low** · CONFIRMED (3/3)
  - **Finding:** A hardcoded fallback origin `https://noobcoder1209.github.io` is used for no-Origin (no-JS) POST redirects, flagged to change when the custom domain lands; on a different Pages host it redirects to the wrong origin.
  - **Evidence:** response.js:99 hardcoded fallback; :94-98 "CHANGE WHEN CUSTOM DOMAIN LANDS"; :111 builds 303 Location from it.
  - **Fix:** Move the fallback origin to config/env and update ALLOWED_ORIGINS when the domain lands.

- **S-01** · `worker/src/index.js:74-195` · security · **med** · CONFIRMED (3/3)
  - **Finding:** `/price` and `/offers` are unauthenticated, un-rate-limited, and not behind Turnstile, yet each cold-cache call triggers a Google Sheets read, enabling resource-exhaustion / Sheets-quota-drain abuse (cache is 60s and per-isolate; empty-bands disables it).
  - **Evidence:** index.js:70-72/92-95 (no gates), neither invokes checkRateLimit/verifyTurnstile/hashIp before :200; :79/:127 funnel to getCachedData → fetchSheetData; TTL :306, per-isolate :307-308, empty-bands disables :330-333.
  - **Fix:** Add rate-limiting / caching hardening (edge cache, longer TTL, empty-bands caching) to the read routes.

- **S-02** · `worker/src/rate-limit.js:17-40` · security · **med** · CONFIRMED (3/3)
  - **Finding:** The rate-limiter Map is per-isolate in-memory, so the "3 req / 10 min / IP" bound is effectively per-isolate and easily diluted across Cloudflare isolates; `/submit` spam protection therefore leans entirely on Turnstile.
  - **Evidence:** rate-limit.js:20 module-level Map; :3-5 "best effort… Turnstile is the primary anti-spam layer"; bounds :17-18; :14-15 note Durable Object as the cross-isolate fix.
  - **Fix:** Move to a Durable Object / KV for cross-isolate accuracy if stronger spam bounds are needed.

- **S-03** · `worker/src/index.js:265-273` · security · **low** · CONFIRMED (3/3)
  - **Finding:** Rate-limit keying trusts `cf-connecting-ip`; correct and non-spoofable on the real Cloudflare edge (bails 400 when absent), but off-edge (tunnel/preview) the header is client-controlled and can be rotated for unlimited fresh buckets.
  - **Evidence:** index.js:265 reads header; :266-272 bails 400; :276/:289 key off it; comment :259-260.
  - **Fix:** Ensure the Worker is only reachable via the Cloudflare edge (block direct/tunnel access), or add a secondary key.

### config

- **S-04** · `package.json:devDeps` · security · **med** · CONFIRMED (3/3)
  - **Finding:** `npm audit` reports 5 vulnerabilities (1 moderate, 4 high) all in the dev toolchain (vite→esbuild, postcss, nanoid, brace-expansion); `npm audit --omit=dev` reports 0, so nothing shipped to prod is vulnerable; the esbuild one needs a breaking vite major bump.
  - **Evidence:** package.json:13-15 runtime dep flatpickr only; :16-19 devDeps; audit "5 vulnerabilities (1 moderate, 4 high)"; `--omit=dev` "0 vulnerabilities"; esbuild fix "vite@8.2.2 breaking".
  - **Fix:** Track the dev-toolchain advisories; schedule the breaking vite bump; no prod action required.

- **S-05** · `.github/workflows/deploy.yml:49-51` · bug · **med** · CONFIRMED (2/3)
  - **Finding:** The fallback `bookings.json` heredoc is written with an indented body and an indented closing `EOF` (`<<EOF`, not `<<-EOF`), risking non-termination in strict POSIX sh and possibly breaking fork/PR builds (needs a run to confirm on bash/ubuntu).
  - **Evidence:** deploy.yml:49 `<<EOF`; :50 indented body; :51 indented `EOF`. A plain `<<EOF` requires the closing delimiter with no leading whitespace.
  - **Fix:** Use `<<-EOF` with tab indentation, or de-indent the closing `EOF` to column 0. (Panel 2/3 — verify on bash/ubuntu runner.)

- **S-06** · `.github/workflows:pinning` · security · **low** · CONFIRMED (3/3)
  - **Finding:** `deploy-worker.yml` SHA-pins every action, but ci.yml, deploy.yml and refresh-bookings.yml use floating tags (`actions/checkout@v4` etc.) — inconsistent supply-chain-pinning posture.
  - **Evidence:** deploy-worker.yml:42/45/61 SHA-pinned; ci.yml:57/59, deploy.yml:24/26/62/64/76, refresh-bookings.yml:42/44/69/72/86 floating tags.
  - **Fix:** SHA-pin actions across all workflows for a consistent posture.

- **S-07** · `worker/wrangler.toml:29` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** A wrangler.toml comment says the Offers tab range is B3:H8 but the code reads A3:N8 (14 columns).
  - **Evidence:** wrangler.toml:29 "range B3:H8"; offers.js:260 reads `A3:N8` (corroborated :3/:23/:248/:282, test :10/:446).
  - **Fix:** Update the comment to A3:N8 (14 columns).

- **S-08** · `worker/wrangler.toml:1,15` · comment-stale · **low** · CONFIRMED (3/3)
  - **Finding:** The worker name in wrangler.toml is "vayana-enquiries" but the header comment, package.json name and README title say "vayana-enquiries-worker"; wrangler.toml is authoritative so the others are stale.
  - **Evidence:** wrangler.toml:15 `name = "vayana-enquiries"` vs :1 comment, worker/package.json:2, worker/README.md:1 "vayana-enquiries-worker".
  - **Fix:** Reconcile the name across comment/package.json/README to match wrangler.toml (or vice versa).

### locale

- **L-01** · `locales/en.json + bg.json:many` · consistency · **high** · CONFIRMED (3/3)
  - **Finding:** Translator `Code./Kod.` prefixes are still present on live locale values (would ship to prod) and are ASYMMETRIC: en.json carries the prefix on ~327 values while bg.json carries it on ~531, with no cross-locale leakage (0 Cyrillic prefixes in en, 0 Latin in bg).
  - **Evidence:** en.json:5 `"Code 102· …"`, bg.json:5 `"Код 102· …"`; `grep '"Code [0-9]+·' en.json`=327, `grep '"Код [0-9]+·' bg.json`=531; cross-leakage both 0; both valid JSON with live keys.
  - **Fix:** Strip all `Code./Код.` translator prefixes from both locale files before launch.

---

## Refuted (appendix)

- **C-16** · `assets/js/offers.js:93-102` · dead-code · REFUTED (0/3 confirm, 3/3 refute)
  - **Claimed:** The struck-price / save-pill / message slots are dormant via `setSlot` passed empty strings, and offers.js skips them.
  - **What the source shows:** No `setSlot` function exists in offers.js (grep "NO setSlot FOUND"). The helper is `add(cls,text)` and dormant slots emit NO code at all — offers.js:93 and :102 are bare comments with no call. The "message" slot is NOT dormant: `buildMessage(text)` (:133-138) is actively invoked for empty/error states (:156, :167). The premise (empty-string `setSlot` calls) is factually wrong.

- **R-01** · `worker/package.json` · known-flip check · REFUTED (0/3 confirm, 3/3 refute)
  - **Claim under test:** "`jose` is an undeclared dependency, so 3 worker tests fail."
  - **What the source shows:** worker/package.json:15-17 declares `"jose": "^5.9.6"` as a production dependency — `jose` IS declared, refuting the "undeclared" claim. (Note: D-03 correctly documents the real, distinct issue — `jose` is declared only in the *worker* package, not root, so a root-only `npm ci` misses it.)

- **R-02** · `assets/js/booking.js` · known-flip check · REFUTED (0/3 confirm, 3/3 refute)
  - **Claim under test:** "The home dock Check Availability drops the picked `?checkin`/`?checkout` and does not forward them to `/stay/`."
  - **What the source shows:** booking.js:140-142 in `setupLinkForm`'s submit handler sets `url.searchParams.set('checkin', …)` and `('checkout', …)` before `window.location.assign(url.toString())`, with the target built to `stay/` (:137, called with `'stay/'` at :58). Dates ARE forwarded — the claim is refuted.

---

## Comment-correctness pass

Per-file summary of comments read, with every stale/wrong/misplaced comment. Files not listed with issues had all comments correct.

**Files with ALL comments correct** (no stale/wrong/misplaced): `assets/js/main.js` (2), `assets/js/parallax.js` (3), `assets/js/reveal.js` (6), `assets/js/util/is-primary-click.js` (4), `assets/js/util/current-locale.js` (6), `assets/js/util/offer-dates.js` (14), `assets/js/hero-carousel.js` (9), `assets/js/bookings-data.js` (10), `assets/js/season-picker.js` (8), `assets/js/season.js` (12), `assets/js/site-config-inject.js` (13), `assets/js/location.js` (9), `assets/js/lang.js` (18), `assets/js/lightbox.js` (11), `assets/js/slider.js` (16), `assets/js/offers.js` (14), `assets/js/offer-modal.js` (12), `assets/js/availability-calendar.js` (22), `assets/js/calendar-selection.js` (45), `scripts/check-no-secrets.sh` (9, one incomplete-not-wrong note below), `worker/src/turnstile.js` (3), `worker/src/lib/response.js` (12), `worker/src/lib/ip-hash.js` (2).

**assets/js/site-config.js** — 9 comments
- L16 · **stale** — describes address as `short`/`full` with "Tsarevo, Bulgaria" + street line, but the actual object is `{ line1:'Arapya', line2:'Bulgaria', country:'Bulgaria', mapEmbed, directionsUrl }` (no short/full, no Tsarevo, no street). Correction: rewrite to describe line1/line2/country.

**assets/js/newsletter.js** — 16 comments
- L1 · **wrong** — header cites issue #10, but TODO L6 cites #19 and L133 cites "v2 (#14)" for the same ESP work; issue numbers disagree. Correction: reconcile to one correct issue number.
- L133 · **wrong** — cites "v2 (#14)" while the L6 TODO names #19 for wiring the real ESP request. Correction: use the same issue number as the L6 TODO.

**assets/js/header.js** — 30 comments
- L99 · **stale** — enumerates "4 close paths" but code wires a fifth (explicit × button, self-labelled "close path #5" at L353-354). Correction: list 5 paths.
- (L353 "Explicit × button (close path #5)" is **correct** and is the corroborating evidence.)

**assets/js/booking.js** — 30 comments
- L84 · **stale** — "Used by the /enquiries/ bar … and the home floating dock", but `setupLinkForm` is only ever called with `'stay/'` (L58); no `/enquiries/` caller exists. Correction: drop the `/enquiries/` claim.
- L112 · **stale** — "forward to /enquiries/ a reversed date pair" — only wired target is `stay/`. Correction: change `/enquiries/` to `/stay/`.

**assets/js/enquiry.js** — 55 comments
- L684 · **stale** — "In v1 there's no network call… In v2 (#15) the success path will fire the Worker fetch"; but the fetch is already wired in this handler (L767) and the header says #15/#20 are being closed. Correction: rephrase to present tense.
- L146 · **wrong** — "The flag is set further down (line ~131)" but `form.dataset.enquiryInit='1'` is at L201 (L131 is inside BUNGALOW_SLUGS). Correction: change to "line ~201" or drop the number.

**scripts/i18n-plugin.js** — 78 comments
- L16 · **stale** — "147×2 as of Task #162"; actual leaf keys = 586 each. Correction: "586×2" or drop the count.
- L57 · **wrong** — "The `closeBundle` hook … writes the BG variant"; no closeBundle hook exists; emit is in `writeBundle` (L1986). Correction: replace with writeBundle.
- L100 · **wrong** — "the closeBundle hook is where the BG mirror gets emitted"; it's writeBundle. Correction: replace with writeBundle.
- L128 · **wrong** — cites `common.header._note_DO_NOT_TRANSLATE_lang_aria_keys` as the deepest key at "4 segments", but it is 3 segments and not deepest; the deepest is `bungalows.common.booking.checkin_label` (4). Correction: cite the correct deepest key.
- L705 · **wrong** — truncated/garbled sentence ("Vite's transformIndexHtml runs it for" with no completion, running into the "Dev mode:" line). Correction: delete the dangling fragment.
- L984 · **stale** — error message enumerates only srcdoc/style/onload, but FORBIDDEN_ATTR_NAMES also contains `target` (L926-931), so a rejected `target:` prints a misleading sink list. Correction: include `target` or list the set dynamically.
- L1806 · **wrong** — "Registers three Vite hooks: … closeBundle"; factory returns configResolved/transformIndexHtml/writeBundle/configureServer (four, no closeBundle). Correction: rename to writeBundle, fix "three"→"four".
- L410 · **misplaced** — the ~7-line entity-matching comment is duplicated verbatim (403-409 then 410-416). Correction: delete the duplicate at 410-416.

**scripts/i18n-lint.js** — 34 comments
- L64 · **wrong** — "parse5 (used by the plugin) normalises to lowercase…"; the plugin uses `node-html-parser` (i18n-plugin.js L117), not parse5. The `i` flag is still justified, but the stated reason is wrong. Correction: replace "parse5" with "node-html-parser" and base the rationale on attribute-name case-insensitivity.
- L60 · **wrong** — claims the `(?![\w-])` lookahead uniformly excludes `data-i18n-html` across "each attribute name", but that exclusion only holds for the plain-text RE_I18N_TEXT; the HTML/ATTR/META REs intentionally match their longer names. Correction: scope the sentence to the RE_I18N_TEXT case.

**scripts/fetch-bookings.mjs** — 30 comments
- L15 · **stale** — labels the column numbers "1-based letters / 0-based indices" but they are purely 0-based indices (AG=32 = COL_ID; AG is 1-based column 33). Correction: drop the "1-based letters" half; label consistently as 0-based indices.
- L85 · **stale** — "only actually reading the sheet [validates env]"; contradicted by `main()` (L268) which calls `getSheets()` eagerly to validate env / prime `_saEmail`. Correction: note main() primes getSheets() eagerly while import alone stays lazy.

**scripts/check-no-secrets.sh** — 9 comments
- L33 · **stale (incomplete, not false)** — the token-pattern list omits the `"private_key":\s*"-----BEGIN` JSON-field pattern that the grep at L45 also matches. Correction: add "and JSON private_key fields" to the list.

**vite.config.js** — 14 comments
- L15 · **stale** — "Hoisted so the i18n plugin can enumerate the same set for BG-mirror emission"; the plugin's writeBundle iterates the emitted `bundle` (i18n-plugin.js L1993), not INPUTS. INPUTS is still passed for plugin validation and Rollup input. Correction: state INPUTS is shared for `build.rollupOptions.input` + plugin validation, while BG mirroring walks the emitted bundle.

**worker/src/index.js** — 32 comments
- L3-16 · **stale** — the 12-step lifecycle header describes only `/submit` and claims "only /submit accepted", but the code handles GET `/offers` (L74-89) and POST `/price` (L97-195) before the L200 path gate. Correction: add /offers and /price; drop "only /submit accepted".
- L219 · **wrong** — inline "// 3. Content-type detect" duplicates the "// 3. Method gate" at L209, then body-size is 3b and rate-limit jumps to 4 (inconsistent numbering). Correction: renumber content-type to 4 (single monotonic sequence).
- (L37-43 KNOWN_LOCALES cross-file-invariant note is **correct**.)

**worker/src/offers.js** — 40 comments
- L6-11 · **stale** — "every catch logs ONLY a generic string"; offers.js's catch blocks (L269, L278) throw generic Errors and do NOT log (no console.error in the file). The getAccessToken/token-cache half is correct. Correction: reword to "every catch throws a generic Error (never err.message)".
- (L23 COL-map "A3:N8 … A is index 0" is **correct**.)

**worker/src/validation.js** — 30 comments
- L10 · **stale** — "// Mirrors enquiry.js:21"; EMAIL_RE is at enquiry.js:45 (L21 is an unrelated fragment). Correction: cite enquiry.js:45.
- L12 · **stale** — "// Mirrors enquiry.js:35"; PHONE_RE is at enquiry.js:59. Correction: cite enquiry.js:59.
- L14 · **stale** — "// Mirrors enquiry.js:25,41,47,52"; the four cap constants are at enquiry.js:71/49/65/76. Correction: update the citation (or drop the line numbers).
- (L49-56 ALLOWED_OPTIONAL_COUNT behavioural note is **correct**.)

**worker/src/pricing.js** — 22 comments
- L33-36 · **wrong** — `round2` rounds to whole CENTS (2 decimals), not whole euros; "killing binary-float dust like 669.9999999999999 → 670" with a whole-number example misleads (it can return 437.50). Correction: reword example to `→ 670.00` and note whole-euro rounding is done separately in index.js:193.
- (L10-17 four-discount-formula header is **correct**.)

**worker/src/sheets.js** — 14 comments
- L138-144 · **stale** — the "⚠️ PRE-DEPLOY ACTION … BEFORE DEPLOYING insert column L" block reads as a pending code change, but the code side is already committed (range A:O L115; price at index 11 L157; layout comment "Current layout (A:O, 15 columns)"); only a manual sheet-header edit remains. Correction: demote to a standing "sheet header must have Price at column L" note.
- (L122-136 A:O 15-column layout + ref note is **correct**.)

**worker/src/rate-limit.js** — 3 comments
- L1-15 · **stale** — header claims empty-bucket deletion bounds the working set to currently-active IPs, but that delete branch (L34) is unreachable (self-admitted L32-33), so buckets for quiet IPs are never removed; working set = all IPs seen during isolate life. Correction: implement real pruning, or correct the header to say buckets are never actually deleted.
- (L31-33 self-description of the dead branch is **correct** — it is the header above that is stale.)

**worker/src/lib/ref.js** — 2 comments
- L7 · **wrong** — "~48 bits of entropy"; 8 bytes each reduced via `% 32` (uniform 5 bits) = 40 bits, not 48. Correction: change "~48 bits" to "40 bits".
- L6 · **stale** — "12 base32-ish chars derived from 8 random bytes"; only 8 chars derive from the bytes; the 12-char total comes from the `VB-` prefix + an internal `-`. Correction: reword to "8 base32-ish chars … formatted as VB-XXXX-XXXX".

---

## Method

Report-only audit — no code was changed. Every embedded recon finding was re-verified by a **3-verifier zero-context majority panel** (each verifier judges independently against the source; verdict = majority of CONFIRMED / REFUTED / NEEDS_RUNTIME, with the panel vote recorded per finding, e.g. 3/3 or 2/3). Known-flip checks (R-01, R-02) were run to catch confirmation bias by testing the inverse claim. A separate **exhaustive per-file comment-correctness pass** read every comment in each file and classified each as correct / stale / wrong / misplaced with a proposed correction. Fixing is out of scope; this document is the deliverable.