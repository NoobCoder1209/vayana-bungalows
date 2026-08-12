# Error-Handling Audit & Optimization Backlog

> **Status:** findings only — nothing has been changed. This is a parked backlog
> to circle back on. Audited against `main` @ `813ec4a` (2026-08-12).
>
> **Goal that prompted this:** make sure every failure a user can hit produces a
> clear indication of *what's wrong* — no silent failures, no misleading states,
> no generic "something went wrong" where a specific message is possible.

All findings are cited `file:line`. Two read-only audits (Worker error inventory
+ frontend surfacing) fed this doc.

---

## TL;DR — what to fix first

The single highest-value fix is **B1** below (a `bookings.json` load failure makes
the calendar show *every* day as available — an error rendered as a misleading
*success* the guest acts on). Then **B2** (silent price-unavailable) and **B4**
(validation says "fix the highlighted fields" but highlights none).

| # | Case | Why it matters | Effort (rough) |
|---|---|---|---|
| B1 | bookings load fail → all days shown available | Wrong-positive; guest enquires for booked dates | Medium |
| B2 | /price fail/timeout → unlabeled "Continue to enquire" | Guest never told pricing failed | Low |
| B4 | server `validation` ignores `fields[]` | "highlighted fields" highlights nothing | Low |
| B3 | `?err=` redirect never read | no-JS/form failures → blank form, no message | Low |
| B5 | legacy widget clears date silently | form "does nothing" | Low (legacy) |
| B6 | `no-ip` / `bad-request` unmapped → generic | wrong-cause message | Trivial |
| B7 | almost all messages hardcoded English | BG visitors see English errors | Medium (i18n) |
| C\* | ambiguous Worker codes (one code = many causes) | clear message impossible downstream | Medium |

---

## Part A — Every error the Worker can return

### Global / catch-all

| HTTP | `error` code | Trigger | file:line |
|---|---|---|---|
| 204 | *(none — bare, no body)* | `OPTIONS` preflight, any path | `worker/src/index.js:63` |
| 404 | `not-found` | any path ≠ `/offers` `/price` `/submit` | `worker/src/index.js:187` |

### `GET /offers`

| HTTP | `error` code | Trigger | file:line |
|---|---|---|---|
| 405 | `method` | non-GET | `worker/src/index.js:75` |
| 502 | `offers-unavailable` | **~10 causes collapsed**: sheet config missing, SA JSON missing/invalid, key-import fail, JWT sign fail, token fetch/exchange/parse/shape fail, sheet fetch/read/parse fail, `sheet-read-incomplete` | `worker/src/index.js:84`; upstream throws `sheets.js:38,40,48,73,87,91,97,101`, `offers.js:256,270,273,279,295` |

### `POST /price`

| HTTP | `error` code | Trigger | file:line |
|---|---|---|---|
| 405 | `method` | non-POST | `worker/src/index.js:98` |
| 415 | `content-type` | body not `application/json` | `worker/src/index.js:101` |
| 400 | `bad-request` | `request.json()` throws, or body null/not-object | `worker/src/index.js:105,111` |
| 400 | `bad-dates` | **triply overloaded** — (a) non-ISO / mis-ordered dates, (b) impossible date (e.g. `2026-02-30`), (c) a night outside every seasonal band | `worker/src/index.js:118,162` |
| 502 | `price-unavailable` | **doubly overloaded** — (a) any sheet/token failure, (b) empty rate table (structurally-valid read, zero bands) | `worker/src/index.js:121,145` |
| 200 | *(success)* | `{ ok:true, total, applied }`, total rounded to whole € | `worker/src/index.js:180` |

### `POST /submit`

JSON callers get `{ ok, ref?, error?, fields? }`. Form-urlencoded callers get a
303 → `/enquiries/?err=<code>` (locale-prefixed once locale is known).

| HTTP | code / `?err=` | Trigger | JSON body | Form redirect | file:line |
|---|---|---|---|---|---|
| 405 | `method` | non-POST | `{error:"method"}` | JSON (fires before form/JSON split) | `index.js:197` |
| 415 | `content-type` | neither JSON nor form | `{error:"content-type"}` | JSON | `index.js:207` |
| 413 | `too-large` | `Content-Length` > 16 KB | `{error:"too-large"}` | JSON | `index.js:235` |
| 400 | `no-ip` | `cf-connecting-ip` absent | `{error:"no-ip"}` | JSON | `index.js:252` |
| 500 | `downstream` | `hashIp` throws — `IP_HASH_SALT` missing/<32 chars (operator config) | `{error:"downstream"}` | JSON | `index.js:261`, `ip-hash.js:13` |
| 429 | `rate-limit` | >3 req / IP-hash / 10 min (per-isolate) | `{error:"rate-limit"}` | 303 `?err=rate-limit` **forced to `en`** (body not parsed yet) | `index.js:276`, `rate-limit.js:26` |
| 400 | `validation` + `fields:["body"]` | body parse throws / null / not object | `{error:"validation",fields:["body"]}` | 303 `?err=validation` at default locale | `index.js:295,315` |
| 400 | `validation` + `fields:[…names]` | `validateBody` fails | `{error:"validation",fields:[…]}` | 303 `?err=validation` at sniffed locale | `index.js:343` |
| 403 | `captcha` | Turnstile `success:false` — **includes bad/expired token AND infra failure (missing secret, network, non-OK, parse) — all fail-closed** | `{error:"captcha"}` | 303 `?err=captcha` | `index.js:389`, `turnstile.js:11,27,30,35` |
| 502 | `downstream` | `appendEnquiry` throws (config, token, `sheets-append-failed:<status>`, `sheets-fetch-failed`) | `{error:"downstream"}` | 303 `?err=downstream` | `index.js:408`, `sheets.js:109,174,178` |
| 200/303 | *(success)* | valid submit | `{ok:true,ref}` | 303 → `/enquiries/thanks/` | `index.js:431` |
| 200/303 | *(silent success — honeypot)* | `alt_url` honeypot filled | `{ok:true,ref}` **identical to real success, NO sheet write** (even burns a Turnstile round-trip to equalize timing) | 303 → `/enquiries/thanks/` | `index.js:360` |

**Field-level detail on `/submit` validation:** `validateBody`
(`validation.js:130-253`) returns `{ ok:false, invalidFields:[…] }` — it names
*which* fields failed (`name/email/phone/checkin/checkout/adults/children/infants/message/consent`)
but **never why** (no per-field reason). `index.js:347` forwards those names to
JSON callers as `fields`. **Form callers lose the `fields` array entirely** —
they get only `?err=validation`.

---

## Part B — User hits a failure but gets NO clear indication

Ranked worst-first. These are the core of "optimize that part."

### B1 — `bookings.json` load failure → calendar shows ALL days available (misleading fail-open) 🔴
A missing/failed/malformed `bookings.json` makes `loadBookings()` return `null`
(`bookings-data.js:28-45`, `console.warn` only at `:40`). Consumers fail *open*:
`availabilityFor(null,…)` → empty sets → `buildMonthGrid` marks **every future
in-season day `.is-available` (green)** (`availability-calendar.js:191-205`). The
legacy widget (`booking.js:243-288`) and the selection layer
(`calendar-selection.js:761-768`) likewise treat everything as free.
**Effect:** a data failure looks like *full availability*; the guest can select
and enquire for dates that may be booked. No banner, no "availability unknown"
note — the `console.warn` is the only signal. (The fail-open is intentional per
`bookings-data.js:36-41`, but the user is never told.)

### B2 — `/price` failure/timeout → pill silently becomes unlabeled "Continue to enquire" 🔴
On any `/price` non-2xx, bad shape, network error, or the 12 s `PRICE_TIMEOUT_MS`
(`calendar-selection.js:52,529`), `toFallback()` (`:521-525`) renders a normal,
clickable gold pill reading **"Continue to enquire"** with **no price and no
"pricing unavailable" note**. Only trace: `console.warn` at `:556`. From the
guest's view it's indistinguishable from an ordinary CTA — someone who selected
7 nights expecting a total just sees a button with no money mentioned. The SR
announcement (`:524`) also doesn't say pricing failed.

### B3 — the `?err=` redirect is never read by the frontend 🟠
The Worker builds `/enquiries/?err=validation|captcha|rate-limit|downstream`
(`index.js:288,309,320,349,401,424`) and the comment at `index.js:19-20` says
*"so the form page can surface a message."* **Nothing reads `?err=`** — grep of
`assets/js/`, `enquiries/index.html`, and built `dist/` confirms only
`?checkin/?checkout/?villa/?offer/?bungalow/?price` are consumed
(`enquiry.js:325`, `calendar-selection.js:701`). A guest reaching that redirect
(no-JS submit, or a future form path) lands on a blank enquiry form with **zero
indication anything failed**. Every `err` code is effectively unmapped.

### B4 — server-side `validation` shows "check the highlighted fields" but highlights nothing 🟠
On a non-200 the client does `ERROR_MSGS[data.error] || ERROR_MSGS.default`
(`enquiry.js:757`) and **ignores `data.fields`**. So a server `validation`
rejection shows *"Please check the highlighted fields and try again."*
(`enquiry.js:107-117`) while **no field is marked** — `showError(msg)` is called
without a field arg (`:758`), no `aria-invalid` set. The Worker sent the failing
field names (`index.js:347`); the client throws them away.

### B5 — legacy booking widget clears a picked date silently 🟡 (legacy path)
On submit, if a date is unavailable at submit time, `booking.js:314-344` does
`fpIn.clear(); checkin.focus(); return;` — the picked date **vanishes with no
message** and the modal never opens. Only a `console.info` (`:277,285`). The form
appears to "do nothing."

### B6 — unmapped Worker codes fall to the generic catch-all 🟡
`ERROR_MSGS` (`enquiry.js:107-117`) has no entry for **`no-ip`** (`index.js:255`)
or **`bad-request`** → both fall to `ERROR_MSGS.default` ("Sorry, something went
wrong…"), so the shown cause is wrong/vague. Low frequency but genuine gaps.

### B7 — almost all user-facing messages are hardcoded English (not localized) 🟡
Only the offers section's `error`/`empty` are in the i18n files
(`en.json`/`bg.json:99`). Every enquiry-form message (`enquiry.js:81-116`), every
/stay/ pill/dock/announce string (`calendar-selection.js:70-74,599-600,606,610`),
the newsletter strings (`newsletter.js:31-32`), and the legacy-widget strings are
inline English literals. **A `/bg/` visitor sees English error copy** for every
case above. (Offers is the model done right — see Part D.)

---

## Part C — Ambiguous Worker codes (one code = many root causes)

A clear downstream message is impossible while these collapse distinct causes:

- **`bad-dates`** (`/price`) — can't distinguish "your dates are malformed" from
  "your dates are fine but we don't operate that season / that night isn't
  covered." (`index.js:118,162`)
- **`price-unavailable`** (`/price`) — "sheet/token is down" vs "rate table empty"
  are identical to the caller (different server logs only). (`index.js:121,145`)
- **`downstream`** (`/submit`) — same string for a **500** IP-hash-salt config
  error and a **502** Sheets-append failure. (`index.js:261,408`)
- **`captcha`** (`/submit`) — a real bot/expired token and a **legitimate user
  during a Turnstile outage** get the identical `captcha` error (fail-closed).
  (`turnstile.js:11,27,30,35`)
- **`offers-unavailable`** (`/offers`) — one code for ~10 distinct upstream
  failures. (`index.js:84`)
- All 5xx deliberately hide the real cause from the client (server-log only,
  `err.message` never echoed — SA-key-leak protection). Intentional; noted so a
  future "why can't the client see the cause?" question is already answered.

---

## Part D — What's already done RIGHT (don't regress these)

- **Offers section** (`offers.js:163-168`): on GET `/offers` failure it renders a
  **visible, localized** message (`home.offers.error`) — not just a `console.warn`.
  Empty result → localized `home.offers.empty`. This is the model the other flows
  should follow.
- **Client-side enquiry validation** (`enquiry.js:568-658`): per-field, specific
  messages with `aria-invalid` + focus. (Only the *server*-side validation path
  drops this — see B4.)
- **Enquiry status mapping** for `captcha` / `rate-limit` / `too-large` /
  `downstream` / network (`enquiry.js:107-117,761`) — these ARE specific and
  mapped; the gaps are `no-ip`/`bad-request` (B6), `fields` (B4), and i18n (B7).
- **The "dates just became unavailable" case** (`calendar-selection.js:590-602`)
  IS surfaced clearly with a dock message + SR announcement (hardcoded EN though).
- **`price-unavailable` vs `bad-dates` split** for the empty-rate-table case is
  deliberate and correct (that's why B2 is a *frontend* surfacing gap, not a
  Worker gap).

---

## Console-only paths (invisible to the user) — quick reference

| Path | Signal | file:line |
|---|---|---|
| enquiry missing markup → form not wired | `console.warn` | `enquiry.js:196` |
| Turnstile render failure | `console.warn` (deferred to submit 403) | `enquiry.js:262` |
| newsletter missing markup | `console.warn` | `newsletter.js:71` |
| offers load failure | `console.warn` **+ visible localized msg** ✅ | `offers.js:193` |
| bookings load failure | `console.warn` only → misleading calendar (B1) | `bookings-data.js:40` |
| legacy bookings array shape | `console.warn` only | `bookings-data.js:79` |
| legacy widget no-availability / cleared date | `console.info` only (B5) | `booking.js:251,277,285` |
| `/price` failure | `console.warn` only → unlabeled pill (B2) | `calendar-selection.js:556` |

---

*When you circle back: B1 → B2 → B4 are the highest value-per-effort. Fixing the
ambiguous Worker codes (Part C) first would let the frontend show truly specific
messages, but is a bigger change; the frontend gaps (B) can be improved
independently of it.*
