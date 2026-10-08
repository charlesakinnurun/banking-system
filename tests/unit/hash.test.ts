import { describe, expect, it } from 'vitest';
import { canonicalJson, requestFingerprint, sha256Hex } from '../../src/shared/hash.js';

describe('hashing utilities', () => {
  it('computes a known sha256', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('canonicalises object key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('drops undefined properties so absent fields do not change the fingerprint', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('produces the same fingerprint regardless of key order', () => {
    const left = requestFingerprint('POST /v1/transfers', { to: 'x', amountMinor: '100' });
    const right = requestFingerprint('POST /v1/transfers', { amountMinor: '100', to: 'x' });
    expect(left).toBe(right);
  });

  it('produces different fingerprints for different payloads and endpoints', () => {
    expect(requestFingerprint('e', { a: 1 })).not.toBe(requestFingerprint('e', { a: 2 }));
    expect(requestFingerprint('e1', { a: 1 })).not.toBe(requestFingerprint('e2', { a: 1 }));
  });
});
