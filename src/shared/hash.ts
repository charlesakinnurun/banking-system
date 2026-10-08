import { createHash } from 'node:crypto';

/** Stable hex sha256 over UTF-8 text. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Canonical JSON: object keys sorted recursively so the same logical payload
 * always hashes identically regardless of key order. A reordered property must
 * NOT be treated as a different request.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
  }
  return value;
}

/** Idempotency fingerprint: endpoint + canonical body. */
export function requestFingerprint(endpoint: string, body: unknown): string {
  return sha256Hex(`${endpoint}\n${canonicalJson(body)}`);
}
