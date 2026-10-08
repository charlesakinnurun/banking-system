import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../src/domain/errors.js';
import { Hs256TokenService } from '../../src/infrastructure/crypto/token-service.js';
import { FixedClock } from '../../src/infrastructure/system/clock.js';
import { CryptoIdGenerator } from '../../src/infrastructure/system/id.js';

function makeService(overrides: Partial<{ audience: string; ttlSeconds: number }> = {}) {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const service = new Hs256TokenService({
    secret: 'unit-test-secret-value-at-least-32-chars',
    issuer: 'issuer',
    audience: overrides.audience ?? 'audience',
    ttlSeconds: overrides.ttlSeconds ?? 60,
    clock,
    idGenerator: new CryptoIdGenerator(),
  });
  return { service, clock };
}

describe('Hs256TokenService', () => {
  it('round-trips claims', () => {
    const { service } = makeService();
    const token = service.signAccessToken({ sub: 'customer-1', role: 'admin' });
    expect(service.verifyAccessToken(token)).toEqual({ sub: 'customer-1', role: 'admin' });
  });

  it('rejects a tampered payload', () => {
    const { service } = makeService();
    const token = service.signAccessToken({ sub: 'customer-1', role: 'customer' });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker', role: 'admin' })).toString(
      'base64url',
    );
    expect(() => service.verifyAccessToken(`${header}.${forged}.${signature}`)).toThrow(
      UnauthorizedError,
    );
  });

  it('rejects a malformed token', () => {
    const { service } = makeService();
    expect(() => service.verifyAccessToken('not.a.jwt')).toThrow(UnauthorizedError);
    expect(() => service.verifyAccessToken('only-one-part')).toThrow(UnauthorizedError);
  });

  it('rejects an expired token', () => {
    const { service, clock } = makeService({ ttlSeconds: 30 });
    const token = service.signAccessToken({ sub: 'customer-1', role: 'customer' });
    clock.advance(31_000);
    expect(() => service.verifyAccessToken(token)).toThrow(UnauthorizedError);
  });

  it('rejects a token minted for a different audience', () => {
    const { service: signer } = makeService({ audience: 'mobile' });
    const { service: verifier } = makeService({ audience: 'web' });
    const token = signer.signAccessToken({ sub: 'customer-1', role: 'customer' });
    expect(() => verifier.verifyAccessToken(token)).toThrow(UnauthorizedError);
  });
});
