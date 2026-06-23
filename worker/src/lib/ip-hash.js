// SHA-256(ip + salt) → 64-char lowercase hex.
//
// The IP is concatenated with the salt as a UTF-8 string; salt is a 32-byte
// hex value coming from env.IP_HASH_SALT. Rotating that salt is the GDPR-
// friendly way to "forget" historical hashes — they become uncorrelatable
// with any future IP.
//
// We HARD-FAIL if the salt is missing or too short: an unsalted SHA-256(ip)
// is rainbow-table-trivial for the entire IPv4 space, and our privacy policy
// (§3.2) explicitly promises a salted hash. Fail-closed > silently degrade.

export async function hashIp(ip, salt) {
  if (typeof salt !== 'string' || salt.length < 32) {
    throw new Error('ip-hash-salt-missing');
  }
  const input = new TextEncoder().encode(`${ip}|${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
