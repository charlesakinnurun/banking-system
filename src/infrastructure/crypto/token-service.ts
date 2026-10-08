import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  AccessTokenClaims,
  Clock,
  IdGenerator,
  TokenService,
} from '../../application/ports.js';
import { CUSTOMER_ROLES, type CustomerRole } from '../../domain/enums.js';
import { UnauthorizedError } from '../../domain/errors.js';

/**
 * Compact HS256 JWT implementation over `node:crypto`.
 *
 * We deliberately keep this tiny and dependency-free, and test it directly
 * (round-trip, tamper detection, expiry, issuer/audience, algorithm
 * confusion). Only HS256 is accepted — the header `alg` is checked — so an
 * attacker cannot downgrade to `none` or swap to an asymmetric alg.
 *
 * Access tokens are short-lived; revocation is handled by the rotating refresh
 * token, not by the JWT (see ADR-0007).
 */

interface JwtPayload {
  sub: string;
  role: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface Hs256TokenServiceOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const base64urlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

export class Hs256TokenService implements TokenService {
  constructor(private readonly options: Hs256TokenServiceOptions) {}

  signAccessToken(claims: AccessTokenClaims): string {
    const nowSeconds = Math.floor(this.options.clock.now().getTime() / 1000);
    const payload: JwtPayload = {
      sub: claims.sub,
      role: claims.role,
      iss: this.options.issuer,
      aud: this.options.audience,
      iat: nowSeconds,
      exp: nowSeconds + this.options.ttlSeconds,
      jti: this.options.idGenerator.uuid(),
    };
    const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
    const body = base64urlJson(payload);
    const signature = this.sign(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedError('Malformed token');
    const [headerPart, bodyPart, signaturePart] = parts as [string, string, string];

    const expected = this.sign(`${headerPart}.${bodyPart}`);
    const provided = Buffer.from(signaturePart, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
      throw new UnauthorizedError('Invalid token signature');
    }

    let header: { alg?: string };
    let payload: JwtPayload;
    try {
      header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
        alg?: string;
      };
      payload = JSON.parse(Buffer.from(bodyPart, 'base64url').toString('utf8')) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Malformed token payload');
    }

    if (header.alg !== 'HS256') throw new UnauthorizedError('Unsupported token algorithm');
    if (payload.iss !== this.options.issuer) throw new UnauthorizedError('Invalid token issuer');
    if (payload.aud !== this.options.audience)
      throw new UnauthorizedError('Invalid token audience');
    if (
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(this.options.clock.now().getTime() / 1000)
    ) {
      throw new UnauthorizedError('Token expired');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedError('Invalid token subject');
    }
    if (!CUSTOMER_ROLES.includes(payload.role as CustomerRole)) {
      throw new UnauthorizedError('Invalid token role');
    }

    return { sub: payload.sub, role: payload.role as CustomerRole };
  }

  private sign(data: string): string {
    return createHmac('sha256', this.options.secret).update(data).digest('base64url');
  }
}
