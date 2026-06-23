// vayana-enquiries-worker — fetch handler.
//
// Lifecycle of a request:
//   1. OPTIONS preflight → 204 with CORS headers (any path)
//   2. Path gate (only /submit accepted) → 404 otherwise
//   3. Method gate (only POST) → 405
//   4. Content-type gate (JSON or form-urlencoded) → 415
//   4b. Body-size cap (Content-Length > 16 KB) → 413
//   5. cf-connecting-ip presence + salted IP hash → 400 / 500
//   6. Rate-limit (per hashed IP, in-memory) → 429
//   7. Parse body → 400 if malformed
//   8. Server-side validation → 400
//   9. Honeypot trip — silent 200 / 303, no sheet write
//  10. Turnstile siteverify → 403 on failure
//  11. Append to Google Sheet → 502 on downstream failure
//  12. Success → 200 (JSON) / 303 (form-urlencoded)
//
// JSON callers get { ok, ref?, error?, fields? }. Form callers get a 303
// redirect back to the public site — to /enquiries/thanks/ on success or
// /enquiries/?err=<code> on failure so the form page can surface a message.

import { verifyTurnstile } from './turnstile.js';
import { validateBody } from './validation.js';
import { appendEnquiry } from './sheets.js';
import { checkRateLimit } from './rate-limit.js';
import {
  jsonResponse,
  redirectResponse,
  corsHeaders,
} from './lib/response.js';
import { generateRef } from './lib/ref.js';
import { hashIp } from './lib/ip-hash.js';

function bail(isJson, jsonBody, status, redirectPath, request, env) {
  return isJson
    ? jsonResponse(jsonBody, status, request, env)
    : redirectResponse(redirectPath, request, env);
}

export default {
  async fetch(request, env, ctx) {
    // 1. CORS preflight — answer OPTIONS on ANY path (the path gate
    //    below is a hardener for actual requests, not for preflight).
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    // 2. Path gate — Worker has exactly one route. Refuse everything else
    //    with 404 so future additional routes can't be accidentally
    //    exposed by a path-traversal-style POST.
    const { pathname } = new URL(request.url);
    if (pathname !== '/submit') {
      return jsonResponse(
        { ok: false, error: 'not-found' },
        404,
        request,
        env,
      );
    }

    // 3. Method gate
    if (request.method !== 'POST') {
      return jsonResponse(
        { ok: false, error: 'method' },
        405,
        request,
        env,
      );
    }

    // 3. Content-type detect
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    const isJson = ct.startsWith('application/json');
    const isForm = ct.startsWith('application/x-www-form-urlencoded');
    if (!isJson && !isForm) {
      return jsonResponse(
        { ok: false, error: 'content-type' },
        415,
        request,
        env,
      );
    }

    // 3b. Body-size cap — fast reject before parsing.
    //     Workers' default body cap is ~100 MB which would let an attacker
    //     send a 50 MB JSON, get it materialised into memory inside the
    //     isolate, and only THEN be rejected at the MAX_MESSAGE_LEN=2000
    //     gate in validation.js. Pre-cap on Content-Length closes that
    //     DoS amplification path before we touch the body.
    //
    //     Realistic upper bound: name(120) + email(254) + phone(40) +
    //     dates(2×10) + party(3×2) + message(2000) + consent(5) +
    //     captcha token(~600) + alt_url(254) + framing(JSON keys,
    //     quotes, commas) ≈ 4 KB. We use 16 KB to leave room for
    //     URL-encoded form padding and future captcha-token growth.
    //
    //     Content-Length is attacker-controlled so this is "cheap reject
    //     for the honest case", not a hard guarantee. The validator below
    //     enforces the per-field caps that DO bind.
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 16 * 1024) {
      return jsonResponse(
        { ok: false, error: 'too-large' },
        413,
        request,
        env,
      );
    }

    // 4. Rate-limit (per hashed IP)
    //    cf-connecting-ip is set on every request that reaches a Cloudflare
    //    Worker from a real client. If it's missing, we're being hit by
    //    something off-band (a local-dev proxy, a misconfigured tunnel) —
    //    bail with 400 rather than lumping all anonymous callers into one
    //    shared rate-limit bucket (which would let one abusive caller
    //    starve everyone else).
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) {
      return jsonResponse(
        { ok: false, error: 'no-ip' },
        400,
        request,
        env,
      );
    }
    let ipHash;
    try {
      ipHash = await hashIp(ip, env.IP_HASH_SALT);
    } catch {
      // Salt missing / too short — refuse to write unsalted hashes (the
      // privacy policy promises salted). 500 because this is a config
      // issue we (the operator) caused, not a client-correctable one.
      console.error('ip-hash-salt-missing — refusing to proceed without salted IP hashes');
      return jsonResponse(
        { ok: false, error: 'downstream' },
        500,
        request,
        env,
      );
    }
    if (!checkRateLimit(ipHash)) {
      return bail(
        isJson,
        { ok: false, error: 'rate-limit' },
        429,
        '/enquiries/?err=rate-limit',
        request,
        env,
      );
    }

    // 5. Parse body
    let body;
    try {
      if (isJson) {
        body = await request.json();
      } else {
        const fd = await request.formData();
        body = Object.fromEntries(fd.entries());
      }
    } catch {
      return bail(
        isJson,
        { ok: false, error: 'validation', fields: ['body'] },
        400,
        '/enquiries/?err=validation',
        request,
        env,
      );
    }
    if (!body || typeof body !== 'object') {
      return bail(
        isJson,
        { ok: false, error: 'validation', fields: ['body'] },
        400,
        '/enquiries/?err=validation',
        request,
        env,
      );
    }

    // 6. Server-side validation
    //    Must run BEFORE the honeypot trip — otherwise a bot that
    //    submits ONLY the honeypot (empty body otherwise) gets a 200/303
    //    success while a real user with the same empty body gets a 400.
    //    That divergence is exactly the signal a probing bot can read.
    //    By validating first, both bots and real users must produce a
    //    complete body before the honeypot is even checked; only then
    //    can the silent-trip pretend-to-succeed without giving any
    //    observable signal back. Mirrors enquiry.js's client-side
    //    ordering (see enquiry.js honeypot/silent-success handling).
    const validation = validateBody(body);
    if (!validation.ok) {
      return bail(
        isJson,
        { ok: false, error: 'validation', fields: validation.invalidFields },
        400,
        '/enquiries/?err=validation',
        request,
        env,
      );
    }

    // 7. Honeypot — silently treat as success WITHOUT writing.
    //    Matches enquiry.js's client-side silent trip so bots can't
    //    distinguish trip from real success. Note this fires only AFTER
    //    validation has passed, so the success response is
    //    indistinguishable from a genuine valid submit.
    //
    //    Timing side-channel mitigation: the real success path takes
    //    ~300-800 ms (Turnstile siteverify + Sheets append). Returning
    //    immediately on honeypot trip would leak the trip via response
    //    latency. We burn a Turnstile siteverify against the supplied
    //    token (which is guaranteed to fail if it's a real bot token —
    //    bots rarely have a real token — but is processed identically
    //    by Cloudflare regardless), so the trip path takes roughly the
    //    same wall-clock as a captcha-failed real submit.
    const honeypotVal = typeof body.alt_url === 'string' ? body.alt_url.trim() : '';
    if (honeypotVal !== '') {
      // Burn a Turnstile round-trip to equalise timing. The result is
      // discarded — we always return success on honeypot trip.
      await verifyTurnstile(
        body['cf-turnstile-response'] || '',
        env.TURNSTILE_SECRET,
        ip,
      ).catch(() => null);
      const ref = generateRef();
      return isJson
        ? jsonResponse({ ok: true, ref }, 200, request, env)
        : redirectResponse('/enquiries/thanks/', request, env);
    }

    // 8. Turnstile verify
    const captchaToken = body['cf-turnstile-response'] || '';
    const captchaResult = await verifyTurnstile(
      captchaToken,
      env.TURNSTILE_SECRET,
      ip,
    );
    if (!captchaResult.success) {
      return bail(
        isJson,
        { ok: false, error: 'captcha' },
        403,
        '/enquiries/?err=captcha',
        request,
        env,
      );
    }

    // 9. Append to sheet
    const ref = generateRef();
    try {
      await appendEnquiry(env, {
        timestamp: new Date().toISOString(),
        ref,
        ...validation.cleaned,
        source_ip_hash: ipHash,
      });
    } catch {
      // Generic log only — never echo the underlying error (could leak SA fragments).
      console.error('sheets.append failed');
      return bail(
        isJson,
        { ok: false, error: 'downstream' },
        502,
        '/enquiries/?err=downstream',
        request,
        env,
      );
    }

    // 10. Success
    return isJson
      ? jsonResponse({ ok: true, ref }, 200, request, env)
      : redirectResponse('/enquiries/thanks/', request, env);
  },
};
