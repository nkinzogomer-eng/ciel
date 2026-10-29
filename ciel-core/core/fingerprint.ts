// State fingerprints (spec §24 + amendment 4.2).
//
// GUARANTEES
//   - Deterministic: the same logical value always yields the same fingerprint
//     (object key order and `undefined` members are ignored).
//   - Any change in the *observed* value changes the fingerprint (SHA-256).
//
// NON-GUARANTEES (documented in docs/fingerprint.md)
//   - A fingerprint only covers what was observed. If the observation was
//     partial, changes outside the observed slice are invisible.
//   - Identical fingerprints do not prove the world is unchanged, only that the
//     re-observed slice is identical to the recorded one.
//   - Fingerprints do not age. Freshness is tracked separately (last_verified).
//
// Uses Web Crypto (available in Deno, Node >= 18, browsers) — no dependency.

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value === undefined ? null : value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export async function fingerprintMatches(recorded, value) {
  return (await fingerprint(value)) === recorded;
}

export function deepEqual(a, b) {
  return canonicalize(a) === canonicalize(b);
}