import type { FastifyRequest } from 'fastify';
import type { CustomerRole } from '../../domain/enums.js';
import {
  ForbiddenError,
  IdempotencyKeyRequiredError,
  UnauthorizedError,
} from '../../domain/errors.js';
import type { AppDependencies, AuthActor } from '../types.js';
import type { LedgerActor } from '../../application/ledger-service.js';

/**
 * Authentication is done with our own tested HS256 TokenService (single JWT
 * implementation in the codebase). Authorization is a small, explicit set of
 * guards rather than a framework magic layer, so every route states its
 * requirements in one line.
 *
 * Guards always return a Promise: Fastify awaits the return value of a
 * pre-handler, and a bare `undefined` from a non-callback-style hook is not a
 * supported completion signal.
 */
export class AuthGuards {
  constructor(private readonly deps: AppDependencies) {}

  authenticate = (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return Promise.reject(new UnauthorizedError());
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const claims = this.deps.tokens.verifyAccessToken(token);
      request.actor = { id: claims.sub, role: claims.role };
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new UnauthorizedError());
    }
  };

  requireRole =
    (...roles: CustomerRole[]) =>
    (request: FastifyRequest): Promise<void> =>
      this.authenticate(request).then(() => {
        const actor = request.actor;
        if (!actor || !roles.includes(actor.role)) {
          throw new ForbiddenError();
        }
      });

  static actor(request: FastifyRequest): AuthActor {
    const actor = request.actor;
    if (!actor) throw new UnauthorizedError();
    return actor;
  }

  static ledgerActor(request: FastifyRequest): LedgerActor {
    const actor = AuthGuards.actor(request);
    return {
      id: actor.id,
      role: actor.role,
      requestId: request.id,
      ip: request.ip,
    };
  }

  static idempotencyKey(request: FastifyRequest): string {
    const raw = request.headers['idempotency-key'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || value.trim().length < 8) {
      throw new IdempotencyKeyRequiredError();
    }
    return value.trim();
  }
}
