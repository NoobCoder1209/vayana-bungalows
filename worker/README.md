# vayana-enquiries-worker

Cloudflare Worker that accepts submissions from the `/enquiries/` form on
[vayana-bungalows](https://github.com/NoobCoder1209/vayana-bungalows),
verifies a Cloudflare Turnstile captcha, and appends a row to the
`Enquires` tab of the team's Google spreadsheet.

This Worker is the server-side half of issue
[#15](https://github.com/NoobCoder1209/vayana-bungalows/issues/15). The
frontend half (form, validation, Turnstile widget, fetch call) lives in
the parent repo under `enquiries/index.html` + `assets/js/enquiry.js`.

## What lives here

```
worker/
├── package.json         # name, deps (jose), scripts (dev/deploy/tail)
├── wrangler.toml        # Worker config; non-secret [vars] only
├── .dev.vars.example    # Local dev secret template — copy to .dev.vars
├── README.md            # this file
└── src/
    ├── index.js         # fetch() handler — CORS, routing, content-type negotiation
    ├── validation.js    # mirrors enquiry.js client validation server-side
    ├── turnstile.js     # POST to challenges.cloudflare.com/.../siteverify
    ├── sheets.js        # JWT mint via jose → access token → values.append
    ├── rate-limit.js    # in-memory Map<ipHash, [timestamps]>; 3 / 10min
    └── lib/
        ├── response.js  # JSON / 303 / CORS response builders
        ├── ref.js       # short id generator for the "ref" field
        └── ip-hash.js   # SHA-256(ip + salt) → hex
```

## Local dev

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # fill with real values from password manager
npx wrangler dev                 # serves at http://localhost:8787
```

Quick smoke against the local Worker — negative paths first (no real
captcha token needed for these):

```bash
# Method gate — 405
curl -i -X GET http://localhost:8787/submit

# Content-type gate — 415
curl -i -X POST -H 'content-type: text/plain' --data 'x' http://localhost:8787/submit

# Validation gate — 400
curl -i -X POST -H 'content-type: application/json' --data '{}' http://localhost:8787/submit

# Missing captcha — 403
curl -i -X POST -H 'content-type: application/json' \
  --data '{"name":"Test","email":"t@example.com","phone":"+1234567","checkin":"2026-07-01","checkout":"2026-07-05","adults":"2","children":"0","infants":"0","message":"hi","consent":"true"}' \
  http://localhost:8787/submit

# Rate-limit — 429 (run the validation-gate curl 4× in a row from the same IP)
for i in 1 2 3 4; do
  curl -s -w "%{http_code}\n" -o /dev/null -X POST \
    -H 'content-type: application/json' --data '{}' \
    http://localhost:8787/submit
done
# expect: 400 400 400 429
```

The golden path (200 + sheet row) needs a real Turnstile token, which is
easier to test from the browser against the dev site — see the parent
repo's verification matrix in the PR body.

## Secrets

Set ONCE per environment via `wrangler secret put` (never committed):

```bash
wrangler secret put TURNSTILE_SECRET
wrangler secret put GSHEETS_SA_JSON
wrangler secret put GSHEETS_SHEET_ID
wrangler secret put GSHEETS_ENQUIRES_TAB
wrangler secret put IP_HASH_SALT
```

Non-secret values (`ALLOWED_ORIGINS`, `SITE_BASE`) live in `[vars]` in
`wrangler.toml` so they're version-controlled.

### Pre-commit credential scan

A defensive shell script at `../scripts/check-no-secrets.sh` blocks
common credential patterns from being staged. Install once per clone:

```bash
ln -s ../../scripts/check-no-secrets.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

After that, `git commit` runs the script and aborts if a credential-shaped
filename or string appears in the staged diff. Bypass with
`git commit --no-verify` only after manual review.

### Salt rotation

`IP_HASH_SALT` is the privacy-bearing secret — rotating it makes
historical `source_ip_hash` values uncorrelatable with any future
submission. The privacy policy at `/privacy/` describes this property.
Rotation is a manual ops task today; run:

```bash
openssl rand -hex 32 | npx wrangler secret put IP_HASH_SALT
```

Cadence: at least once a year, or after any incident that might have
exposed the salt value. No automated schedule exists today (filed as
a future enhancement — once we have a cron Worker for retention sweep,
add salt rotation to the same workflow).

## Deploy

- **Local one-shot**: `npx wrangler deploy`
- **CI (preferred)**: push to `main` with a change under `worker/**`,
  `.github/workflows/deploy-worker.yml` runs `cloudflare/wrangler-action@v3`.

The Worker URL is `https://vayana-enquiries.<account>.workers.dev`. Once
a custom domain is purchased, swap `endpoints.enquiry` in the parent
repo's `assets/js/site-config.js` — no Worker-side change needed.

## Error contract

| Status | `error` key   | When                                                |
| ------ | ------------- | --------------------------------------------------- |
| 200    | —             | Honeypot trip OR genuine success                    |
| 400    | `validation`  | Body missed a required/typed field                  |
| 400    | `content-type`| Wrong / missing content-type                        |
| 403    | `captcha`     | Turnstile token missing or rejected                 |
| 405    | `method`      | Anything other than POST or OPTIONS                 |
| 415    | `content-type`| Content-type not JSON or x-www-form-urlencoded      |
| 429    | `rate-limit`  | Too many requests from this hashed IP               |
| 502    | `downstream`  | Sheets API call failed                              |

JSON responses use `{ ok: bool, error?: string, fields?: string[], ref?: string }`.
Form-urlencoded requests get a 303 redirect to `/enquiries/?err=<code>`
or `/enquiries/thanks/` on success.
