// In-memory rate-limit per Worker isolate.
//
// 3 requests per IP-hash per 10 minutes. The map is per-isolate (not
// shared across isolates / regions), so this is a "best effort" defence —
// adequate for v1 because Turnstile is the primary anti-spam layer.
//
// Each call filters out expired timestamps for the bucket BEFORE the
// check, AND deletes the bucket entirely when it drops to empty — so
// the Map's working set is bounded by the count of IPs currently
// active within the 10-minute window, not by everyone-ever-seen on
// this isolate. Empty-bucket deletion keeps memory honest over long
// isolate lifetimes.
//
// If we ever need cross-isolate accuracy, swap to a Durable Object or
// to Cloudflare's built-in Rate Limiting Rules. Until then, this is fine.

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
  // Empty bucket → delete the key entirely so the Map doesn't grow
  // unboundedly over isolate lifetime. (Can't actually hit this branch
  // because we just pushed `now`; kept for symmetry / future-proofing.)
  if (recent.length === 0) {
    buckets.delete(ipHash);
  } else {
    buckets.set(ipHash, recent);
  }
  return true;
}

// Exported for tests; never called in production.
export function _resetForTests() {
  buckets.clear();
}
