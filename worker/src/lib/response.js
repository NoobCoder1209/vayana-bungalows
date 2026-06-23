// Uniform response builders for the Worker.
//
// - jsonResponse() — JSON body for `application/json` requests. ALWAYS
//   includes the CORS headers so the browser can read the body.
// - redirectResponse() — 303 redirect for the no-JS `application/x-www-form-urlencoded`
//   path. Points back to the public site under env.SITE_BASE.
// - corsHeaders() — origin allowlist echoer used by OPTIONS preflight and
//   by every other response (so a CORS failure still returns the right
//   status code to inspect, not a network error).

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

export function redirectResponse(path, request, env) {
  // 303 — "see other", makes the browser switch from POST to GET so the
  // user's reload of the thanks page doesn't resubmit the form.
  const base = env.SITE_BASE || '';
  // Fallback origin — used when the request had no Origin header (e.g.
  // a classic non-CORS form POST from no-JS users). The hardcoded value
  // here pins this Worker to the current GitHub Pages hostname; CHANGE
  // WHEN CUSTOM DOMAIN LANDS (and add the new origin to ALLOWED_ORIGINS
  // in wrangler.toml at the same time).
  const origin = pickOrigin(request, env) || 'https://noobcoder1209.github.io';
  const location = `${origin}${base}${path}`;
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
