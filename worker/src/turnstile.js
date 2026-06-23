// Cloudflare Turnstile siteverify.
//
// Managed-mode tokens are short-lived (~300s) and single-use. The Worker
// posts the token + the server secret + the user's IP and reads back
// { success: true|false, ... }. There is no score to threshold (unlike
// reCAPTCHA v3) — managed mode is binary.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token, secret, ip) {
  if (!token || !secret) return { success: false };

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);

  let res;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    // Network error talking to Cloudflare — fail closed.
    return { success: false };
  }
  if (!res.ok) return { success: false };

  try {
    return await res.json();
  } catch {
    return { success: false };
  }
}
