// In-memory rate-limit per Worker isolate.
//
// 3 requests per IP-hash per 10 minutes. The map is per-isolate (not
// shared across isolates / regions), so this is a "best effort" defence —
// adequate for v1 because Turnstile is the primary anti-spam layer.
//
// Each call filters out expired timestamps for the bucket BEFORE the
// check. Buckets are NOT deleted when they go quiet, so the Map's working
// set grows to the count of distinct IPs seen over the isolate's lifetime
// (bounded in practice by isolate churn). Acceptable for v1 given the
// per-isolate, best-effort nature of this limiter.
//
// If we ever need cross-isolate accuracy (or true memory bounding), swap
// to a Durable Object or to Cloudflare's built-in Rate Limiting Rules.
// Until then, this is fine.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 3;

const buckets = new Map();

export function checkRateLimit(ipHash) {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (buckets.get(ipHash) || []).filter(t => t > cutoff);
  if (recent.length >= MAX_REQUESTS) {
    buckets.set(ipHash, recent);
    return false;
  }
  recent.push(now);
  buckets.set(ipHash, recent);
  return true;
}

// Exported for tests; never called in production.
export function _resetForTests() {
  buckets.clear();
}
