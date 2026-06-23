// Short opaque reference for the enquiry. Used in the JSON response so the
// frontend can echo it back to the user ("Your reference: VB-…") and in the
// sheet's `ref` column so the operator can correlate. NOT a security token —
// just a friendly correlation id.
//
// 12 base32-ish chars derived from 8 random bytes. ~48 bits of entropy —
// plenty for de-duplication, way more than enough for a hobby site.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to reduce confusion

export function generateRef() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = 'VB-';
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}
