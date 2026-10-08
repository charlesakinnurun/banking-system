import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../../application/ports.js';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keylen: number;
  readonly maxmem: number;
}

/**
 * scrypt password hashing from `node:crypto` (memory-hard, zero native
 * dependencies). The encoded string embeds the parameters, so we can raise the
 * cost later and transparently rehash on next successful login without
 * invalidating existing hashes.
 *
 * Format: `scrypt$N$r$p$<saltBase64>$<hashBase64>`
 */
export class ScryptPasswordHasher implements PasswordHasher {
  constructor(private readonly params: ScryptParams) {}

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(plain.normalize('NFKC'), salt, this.params.keylen, {
      N: this.params.N,
      r: this.params.r,
      p: this.params.p,
      maxmem: this.params.maxmem,
    });
    return [
      'scrypt',
      this.params.N,
      this.params.r,
      this.params.p,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  async verify(plain: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
    const N = Number.parseInt(nStr!, 10);
    const r = Number.parseInt(rStr!, 10);
    const p = Number.parseInt(pStr!, 10);
    const expected = Buffer.from(hashB64!, 'base64');
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const derived = await scrypt(
      plain.normalize('NFKC'),
      Buffer.from(saltB64!, 'base64'),
      expected.length,
      {
        N,
        r,
        p,
        maxmem: this.params.maxmem,
      },
    );
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }
}
