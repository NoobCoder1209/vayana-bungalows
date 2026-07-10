// Uniform response builders for the Worker.
//
// - jsonResponse() — JSON body for `application/json` requests. ALWAYS
//   includes the CORS headers so the browser can read the body.
// - redirectResponse() — 303 redirect for the no-JS `application/x-www-form-urlencoded`
//   path. Points back to the public site under env.SITE_BASE. Locale-
//   aware: when the caller passes a non-default locale, the path is
//   prefixed with `/<locale>` so a BG user is redirected to the BG
//   mirror page rather than dropped back on the EN page.
// - corsHeaders() — origin allowlist echoer used by OPTIONS preflight and
//   by every other response (so a CORS failure still returns the right
//   status code to inspect, not a network error).

// Locale set the Worker's redirect layer knows about. Must stay in sync
// with the site's locales/*.json set AND the client-side ALLOWED_LOCALES
// in worker/src/validation.js. Kept as a small hardcoded literal here
// because the Worker has no filesystem / plugin to discover locales
// dynamically — a third locale requires touching this file + validation.js.
const DEFAULT_LOCALE = 'en';
const KNOWN_LOCALES = new Set(['en', 'bg']);

function pickOrigin(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const origin = request.headers.get('origin');
  if (origin && allowed.includes(origin)) return origin;
  return null;
}

export function corsHeaders(request, env) {
  const origin = pickOrigin(request, env);
  const headers = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

export function jsonResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // CSP — the Worker only ever returns JSON and 303 redirects.
      // Even though browsers shouldn't render a JSON body as HTML in
      // any modern context, setting `default-src 'none'` is free
      // defence-in-depth against a future code path that accidentally
      // returns text/html.
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      ...corsHeaders(request, env),
    },
  });
}

export function redirectResponse(path, request, env, locale) {
  // 303 — "see other", makes the browser switch from POST to GET so the
  // user's reload of the thanks page doesn't resubmit the form.
  const base = env.SITE_BASE || '';
  // Fallback origin — used when the request had no Origin header (e.g.
  // a classic non-CORS form POST from no-JS users). The hardcoded value
  // here pins this Worker to the current GitHub Pages hostname; CHANGE
  // WHEN CUSTOM DOMAIN LANDS (and add the new origin to ALLOWED_ORIGINS
  // in wrangler.toml at the same time).
  const origin = pickOrigin(request, env) || 'https://noobcoder1209.github.io';
  // Locale prefix (Task #167): for a non-default emit-locale, insert
  // `/<locale>` between base and the path so a BG user's no-JS submit
  // lands on /bg/enquiries/... — matching the mirror page they came
  // from. The path itself is a "site-relative slug" like /enquiries/
  // that mirrors both locales at the same relative position.
  //
  // Unknown / missing locale silently falls back to the default (EN, no
  // prefix). validation.js also degrades unknown locales to the default,
  // so callers can pass the raw client value here without pre-validating.
  const loc = KNOWN_LOCALES.has(locale) ? locale : DEFAULT_LOCALE;
  const localePrefix = loc === DEFAULT_LOCALE ? '' : `/${loc}`;
  const location = `${origin}${base}${localePrefix}${path}`;
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      ...corsHeaders(request, env),
    },
  });
}
