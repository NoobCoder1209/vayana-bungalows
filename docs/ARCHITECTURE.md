# Architecture — Vayana Bungalows

> **New here? Start with this file.** It explains what the project is, how the
> pieces fit together, and where each process lives — using diagrams. It pairs
> with the [README](../README.md) (setup, scripts, deploy commands). Diagrams
> are [Mermaid](https://mermaid.js.org/) and render automatically on GitHub.

---

## 1. What this is, in one picture

Vayana Bungalows is a **boutique-resort marketing site** with a booking-enquiry
flow. There is **no database and no backend server** in the traditional sense:

- The **website** is static files (HTML/CSS/vanilla JS) built by Vite and hosted
  on **GitHub Pages**.
- A single **Cloudflare Worker** handles the three dynamic things: taking enquiry
  submissions, serving special offers, and pricing a stay.
- **Google Sheets is the "database."** The resort owner edits a spreadsheet;
  everything dynamic reads from or writes to it.

```mermaid
flowchart LR
    Guest([Guest's browser])

    subgraph GH["GitHub Pages (static site)"]
      Pages["HTML / CSS / JS<br/>bundled by Vite"]
      Bookings["bookings.json<br/>(availability snapshot)"]
    end

    subgraph CF["Cloudflare Worker (vayana-enquiries)"]
      Worker["/submit · /offers · /price"]
    end

    Sheet[("Google Sheet<br/>Offers · Enquires · B1/B2/B3 tabs")]

    Guest -->|loads pages| Pages
    Guest -->|reads availability| Bookings
    Guest -->|POST enquiry / GET offers / POST price| Worker
    Worker <-->|read offers & rates / append enquiry| Sheet
    Sheet -.->|every 10 min, GitHub Action<br/>regenerates| Bookings
```

**The one idea to hold onto:** the owner only ever touches the **Google Sheet**.
Guests see a fast static site; the Worker is the thin, secured bridge between the
two.

---

## 2. Where everything lives (repo map)

```mermaid
flowchart TD
    Root["vayana-bungalows/"]

    Root --> Pages["index.html + page folders<br/>stay/ · enquiries/ · 3× bungalow/ · contacts/ …"]
    Root --> Assets["assets/"]
    Root --> Worker["worker/"]
    Root --> Locales["locales/<br/>en.json · bg.json"]
    Root --> Scripts["scripts/<br/>fetch-bookings · i18n-plugin · i18n-lint"]
    Root --> WF[".github/workflows/<br/>4 pipelines"]
    Root --> Docs["docs/<br/>ARCHITECTURE.md · specs/"]

    Assets --> CSS["css/ — hand-written styles"]
    Assets --> JS["js/ — vanilla ES modules"]
    Assets --> Data["data/bookings.json<br/>(generated, not hand-edited)"]

    JS --> JScore["main.js — boots each page's modules"]
    JS --> JSbook["calendar-selection.js · availability-calendar.js<br/>booking.js · season.js — date picking"]
    JS --> JSenq["enquiry.js — the enquiry form + captcha"]
    JS --> JSoffer["offers.js · offer-modal.js — home offers"]
    JS --> JScfg["site-config.js — Worker endpoint URLs"]

    Worker --> Widx["src/index.js — the router + all request gates"]
    Worker --> Wmod["src/offers.js · pricing.js · sheets.js<br/>validation.js · turnstile.js · rate-limit.js"]
    Worker --> Wlib["src/lib/ — response · ip-hash · ref helpers"]
```

**Rule of thumb for a new dev:**
- Changing how a page *looks* → `assets/css` + the page's `index.html`.
- Changing page *behavior* → the matching module in `assets/js`.
- Changing what the Worker *accepts / returns* → `worker/src/index.js` (+ the
  helper it calls).
- Changing *copy* (any visible text) → `locales/en.json` **and** `locales/bg.json`.

---

## 3. The three Worker routes at a glance

The Worker is one script (`worker/src/index.js`) with exactly three routes plus a
CORS preflight. Everything else 404s.

```mermaid
flowchart TD
    Req([Incoming request]) --> CORS{"OPTIONS?"}
    CORS -->|yes| P204["204 + CORS headers"]
    CORS -->|no| Route{"path?"}

    Route -->|GET /offers| Offers["Read offers from the Sheet<br/>(hide tier/rate)<br/>→ public offer list"]
    Route -->|POST /price| Price["Compute the total for<br/>the selected dates<br/>→ just a number"]
    Route -->|POST /submit| Submit["Validate + captcha +<br/>append the enquiry row"]
    Route -->|anything else| P404["404 not-found"]

    Offers --> Sheet[("Google Sheet")]
    Price --> Sheet
    Submit --> Sheet
```

- **`GET /offers`** — public, cacheable. Powers the home-page offers section.
- **`POST /price`** — public. Given check-in/out, returns *only* the total euro
  price (the per-night tier rates never reach the browser).
- **`POST /submit`** — the enquiry form action. Guarded (see §6).

All three read the **same Google Sheet**; `/offers` and `/price` share one cached
read (see §5).

---

## 4. Enquiry flow (the money path)

What happens when a guest picks dates and sends an enquiry.

```mermaid
sequenceDiagram
    autonumber
    participant G as Guest (browser)
    participant Stay as /stay/ page
    participant W as Cloudflare Worker
    participant Enq as /enquiries/ page
    participant S as Google Sheet (Enquires tab)

    G->>Stay: pick a ≥5-night range on the calendar
    Stay->>W: POST /price {checkin, checkout, bungalow}
    Note over Stay: pill shows spinner "Pricing your stay…"
    W-->>Stay: { total } (or fails → no price)
    Note over Stay: pill → "Stay with us only for X€"
    G->>Stay: click the pill
    Stay->>Enq: navigate with ?checkin&checkout&bungalow&price
    Note over Enq: prefills hidden fields (incl. price → Column L)
    G->>Enq: fill name/email/phone, solve Turnstile captcha, submit
    Enq->>W: POST /submit (form data + captcha token)
    W->>W: validate · rate-limit · captcha · honeypot (see §6)
    W->>S: append a row (name … price … locale)
    W-->>Enq: 200 ok → "Thank you" screen
```

**Key point:** the price shown on `/stay/` is carried to the enquiry as a URL
param, dropped into a hidden field, and written by the Worker into the **Price
column (L)** of the Enquires tab. If `/price` can't produce a number, the guest
can still enquire — the price is just left blank for the owner to fill.

---

## 5. Offers & pricing — how the Sheet drives money

Both `/offers` and `/price` read the **Offers tab** in one round-trip and cache it
for 60 seconds. The tab holds two things:

- **Rows 3–8 (`A3:N8`) — the offers/promotions** (e.g. "stay 9 nights, pay 6").
- **Rows 16–25 (`A16:C25`) — the seasonal rate table** (date band → €/night),
  used to price a stay when *no* offer applies.

```mermaid
flowchart TD
    subgraph Sheet["Google Sheet — Offers tab"]
      OffersRows["A3:N8 — promotions"]
      Bands["A16:C25 — seasonal rate bands<br/>(Start · End · €/night)"]
    end

    Sheet -->|one batchGet| Cache["60s in-memory cache<br/>{ offers, bands }"]

    Cache --> OffersRoute["GET /offers<br/>→ hide tier/rate, return public list"]
    Cache --> PriceRoute["POST /price"]

    PriceRoute --> Match{"does an offer<br/>apply to these dates?"}
    Match -->|yes| OfferCalc["price via the offer<br/>(discount / pay-X-get-Y)"]
    Match -->|no| Standard["standardPrice():<br/>sum each night at its<br/>seasonal band rate"]
    OfferCalc --> Total["round to whole € → total"]
    Standard --> Total
```

**Two things a new dev must know here:**

1. **The cache never stores an *empty* rate table.** An empty read is treated as a
   transient glitch (the table is a permanent fixture), so it isn't cached — the
   next request re-reads and recovers. This is what keeps the price from
   intermittently going blank. See `getCachedData` in `worker/src/offers.js`.
2. **Rate-band dates are matched by month/day, ignoring the year** — the sheet's
   2026 dates are a *template* that applies to April–September of any year. Band
   **End is inclusive** (the last night charged), which is the *opposite* of an
   offer window's end (the checkout day, exclusive). Don't conflate them.

---

## 6. Enquiry security gates (`POST /submit`)

`/submit` runs a fixed sequence of cheap-to-expensive gates. Anything that fails
short-circuits; the expensive captcha call only runs if everything before it
passed. This mirrors the numbered comments at the top of `worker/src/index.js`.

```mermaid
flowchart TD
    In([POST /submit]) --> M{"method POST?"} -->|no| E405[405]
    M -->|yes| CT{"JSON / form?"} -->|no| E415[415]
    CT -->|yes| Size{"body ≤ 16KB?"} -->|no| E413[413]
    Size -->|yes| IP{"has client IP?"} -->|no| E400a[400]
    IP -->|yes| RL{"under rate limit?<br/>(per hashed IP)"} -->|no| E429[429]
    RL -->|yes| Parse{"body parses?"} -->|no| E400b[400]
    Parse -->|yes| Valid{"fields valid?"} -->|no| E400c[400]
    Valid -->|yes| Honey{"honeypot filled?<br/>(bot trap)"} -->|yes| Fake["200 / 303<br/>(fake success, NO write)"]
    Honey -->|no| Cap{"Turnstile captcha ok?"} -->|no| E403[403]
    Cap -->|yes| Append["append row to Sheet"] -->|ok| OK["200 / 303 success"]
    Append -->|sheet error| E502[502]
```

**Why this order matters:** bots and abuse are rejected before the Worker spends
a network call on captcha verification or a Sheets write. The **honeypot** is a
hidden field no human fills; if it's filled, the Worker fakes success (so the bot
can't tell it was caught) but writes nothing. Errors never echo internal details
to the client (no leaking of the service-account key, etc.).

---

## 7. Availability — how booked dates reach the calendar

The owner records reservations on the **B1/B2/B3 2026 tabs** of the same Sheet. A
scheduled GitHub Action turns those into a static `bookings.json` the site reads —
so the calendar knows which nights are taken *without* any live call at page load.

```mermaid
flowchart LR
    Owner([Owner edits reservations<br/>on B1/B2/B3 tabs]) --> Sheet[("Google Sheet")]
    Sheet -->|"every 10 min (cron)<br/>fetch-bookings.mjs"| Action["GitHub Action:<br/>Refresh bookings"]
    Action -->|"commits/deploys"| JSON["assets/data/bookings.json<br/>{ unavailable[], checkIn[] } per bungalow"]
    JSON -->|"page load fetch"| Cal["availability-calendar.js<br/>greys out booked nights"]
```

`bookings.json` is **generated, never hand-edited**. If availability looks stale,
the fix is the sheet + the refresh job, not the JSON file.

---

## 8. Internationalization (EN / BG)

The site ships in English and Bulgarian. Translation happens at **build time**, not
in the browser: elements carry `data-i18n` markers, and a Vite plugin
(`scripts/i18n-plugin.js`) bakes the right strings from `locales/*.json` into the
output, interpolating `{tokens}`.

```mermaid
flowchart LR
    HTML["HTML with<br/>data-i18n='key' markers"] --> Plugin["Vite i18n plugin<br/>(build time)"]
    EN["locales/en.json"] --> Plugin
    BG["locales/bg.json"] --> Plugin
    Plugin --> Out["dist/ — EN + BG pages,<br/>tokens substituted"]
    Lint["i18n-lint (CI + npm run i18n:lint)"] -. "fails build if a marker<br/>has no key, or keys<br/>differ EN↔BG" .-> Plugin
```

**The rule new devs trip on:** any visible text must exist in **both** `en.json`
and `bg.json` with matching keys, or `i18n:lint` (and CI) fails. Exception: a few
JS-generated strings (e.g. the `/stay/` price pill labels) are hardcoded English
in the module — that component isn't wired to the i18n dictionary.

---

## 9. Build, test & deploy pipelines

Four GitHub Actions workflows in `.github/workflows/`:

```mermaid
flowchart TD
    subgraph OnPR["On every push / PR (any branch)"]
      CI["CI (ci.yml)<br/>build · npm test · i18n:lint"]
    end

    subgraph OnMain["On merge to main"]
      DeployPages["Deploy to GitHub Pages (deploy.yml)<br/>fetch bookings → build → publish dist/"]
      DeployWorker["Deploy Worker to Cloudflare (deploy-worker.yml)<br/>wrangler deploy"]
    end

    subgraph Cron["Every 10 minutes"]
      Refresh["Refresh bookings (refresh-bookings.yml)<br/>fetch-bookings.mjs → commit if changed"]
    end

    PR([Feature branch + PR]) --> CI
    CI -->|green + review| Merge([Merge to main])
    Merge --> DeployPages
    Merge --> DeployWorker
```

**Developer workflow:** branch (`feature/…`, `fix/…`, `docs/…`) → PR → CI green +
review → squash-merge to `main` → the site and/or Worker auto-deploy. Never push
straight to `main`.

---

## 10. Cheat-sheet: "I want to change X"

| I want to… | Touch this | Then |
|---|---|---|
| Edit a promotion / its discount | The **Offers tab** (rows 3–8) in the Sheet | Live within ~60s (cache) |
| Change the standard nightly price | The **rate table** (rows 16–25) in the Sheet | Live within ~60s |
| Change a booked-date / availability | The **B1/B2/B3 tabs** in the Sheet | Live after the 10-min refresh job |
| Change visible copy | `locales/en.json` **and** `bg.json` | PR → merge (deploys the site) |
| Change a page's layout/look | that page's `index.html` + `assets/css` | PR → merge |
| Change page behavior (calendar, form) | the module in `assets/js` | PR → merge; add/adjust tests |
| Change what the Worker accepts/returns | `worker/src/index.js` (+ helpers) | PR → merge (deploys the Worker) |
| Add a Worker secret (keys, sheet id) | `wrangler secret put …` (not in git) | Redeploy the Worker |

---

## 11. Glossary

- **Worker** — the Cloudflare serverless script (`worker/`); the only thing that
  talks to Google Sheets with credentials.
- **Offers tab** — one sheet tab holding both promotions and the seasonal rate
  table.
- **Enquires tab** — where submitted enquiries land as rows (price = Column L).
- **bookings.json** — a generated availability snapshot the calendar reads; refreshed
  by a cron Action, never hand-edited.
- **Turnstile** — Cloudflare's captcha, verified server-side before any sheet write.
- **Honeypot** — a hidden form field; if a bot fills it, the Worker fakes success
  and writes nothing.
- **i18n plugin** — the Vite build step that bakes EN/BG copy into the static pages.

---

*Keep this file honest: if you change a flow, update the matching diagram in the
same PR. Diagrams that lie are worse than no diagrams.*
