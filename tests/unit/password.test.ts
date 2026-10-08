import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from '../../src/infrastructure/crypto/password.js';

const hasher = new ScryptPasswordHasher({
  N: 1024,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 16 * 1024 * 1024,
});

describe('ScryptPasswordHasher', () => {
  it('verifies a correct password', async () => {
    const encoded = await hasher.hash('correct horse battery staple 1');
    expect(await hasher.verify('correct horse battery staple 1', encoded)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const encoded = await hasher.hash('correct horse battery staple 1');
    expect(await hasher.verify('wrong password 2', encoded)).toBe(false);
  });

  it('produces a distinct salt and hash every time', async () => {
    const a = await hasher.hash('same password 3');
    const b = await hasher.hash('same password 3');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$1024$8$1$')).toBe(true);
  });

  it('returns false for a malformed encoded hash', async () => {
    expect(await hasher.verify('x', 'not-a-valid-hash')).toBe(false);
  });
});
