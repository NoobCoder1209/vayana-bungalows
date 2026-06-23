// Google Sheets append — JWT-bearer service-account flow.
//
// Mints a JWT signed with the service-account's private key (RS256),
// exchanges it at https://oauth2.googleapis.com/token for a short-lived
// access token, then POSTs `values.append` against the spreadsheet.
//
// The access token (15-min lifetime) is cached in module scope per
// Worker isolate, so subsequent requests on the same isolate skip the
// token-mint round-trip. New isolates start with a cold cache; that's
// fine — minting a token is ~150ms.
//
// IMPORTANT: every catch-block here logs ONLY a generic string, never
// `err.message`. The service-account's private key can leak into a
// stack trace or JSON.parse error message; mirroring the pattern in
// scripts/fetch-bookings.mjs (lines 81-88) is deliberate.

import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedPrivateKey = null;
let cachedClientEmail = null;

async function loadServiceAccount(env) {
  // Cache the imported key across calls within the same isolate.
  if (cachedPrivateKey && cachedClientEmail) {
    return { privateKey: cachedPrivateKey, clientEmail: cachedClientEmail };
  }
  let sa;
  try {
    sa = JSON.parse(env.GSHEETS_SA_JSON);
  } catch {
    // Suppress error message — could leak private-key fragments.
    throw new Error('sa-parse-failed');
  }
  if (!sa.private_key || !sa.client_email) {
    throw new Error('sa-shape-invalid');
  }
  let privateKey;
  try {
    privateKey = await importPKCS8(sa.private_key, 'RS256');
  } catch {
    throw new Error('sa-key-import-failed');
  }
  cachedPrivateKey = privateKey;
  cachedClientEmail = sa.client_email;
  return { privateKey, clientEmail: sa.client_email };
}

async function getAccessToken(env) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && nowSec < cachedTokenExpiry - 30) {
    return cachedToken;
  }

  const { privateKey, clientEmail } = await loadServiceAccount(env);

  let jwt;
  try {
    jwt = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(clientEmail)
      .setSubject(clientEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 3600)
      .sign(privateKey);
  } catch {
    throw new Error('jwt-sign-failed');
  }

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
  } catch {
    throw new Error('token-fetch-failed');
  }
  if (!res.ok) {
    throw new Error('token-exchange-failed');
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error('token-parse-failed');
  }
  if (!payload.access_token || !payload.expires_in) {
    throw new Error('token-shape-invalid');
  }

  cachedToken = payload.access_token;
  cachedTokenExpiry = nowSec + Number(payload.expires_in);
  return cachedToken;
}

export async function appendEnquiry(env, row) {
  if (!env.GSHEETS_SHEET_ID || !env.GSHEETS_ENQUIRES_TAB) {
    throw new Error('sheets-config-missing');
  }

  const token = await getAccessToken(env);
  const range = encodeURIComponent(
    `'${env.GSHEETS_ENQUIRES_TAB.replace(/'/g, "''")}'!A:M`,
  );
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(env.GSHEETS_SHEET_ID)}` +
    `/values/${range}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  // Column order — keep in lockstep with the header row in the sheet.
  // Adding a column? Update both the sheet and this array.
  // (Note: no captcha_score column — Turnstile managed mode is binary
  // success/fail with no numeric score. A placeholder column N existed
  // briefly during planning and has been removed from the sheet header.)
  const values = [[
    row.timestamp,
    row.ref,
    row.name,
    row.email,
    row.phone,
    row.checkin,
    row.checkout,
    row.adults,
    row.children,
    row.infants,
    row.message,
    row.consent,
    row.source_ip_hash,
  ]];

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });
  } catch {
    throw new Error('sheets-fetch-failed');
  }
  if (!res.ok) {
    // Read body length only — never the body itself.
    throw new Error(`sheets-append-failed:${res.status}`);
  }
}

// For tests only — wipes the module-scope cache so a fresh isolate is simulated.
export function _resetForTests() {
  cachedToken = null;
  cachedTokenExpiry = 0;
  cachedPrivateKey = null;
  cachedClientEmail = null;
}
