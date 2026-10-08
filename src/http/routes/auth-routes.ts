import type { FastifyInstance } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../domain/errors.js';
import type { AppDependencies } from '../types.js';
import { AuthGuards } from '../plugins/auth.js';
import { customerSchema, errorResponses, tokensSchema } from '../schemas.js';
import { serializeCustomer, serializeTokens } from '../serializers.js';

interface RegisterBody {
  email: string;
  fullName: string;
  password: string;
}
interface LoginBody {
  email: string;
  password: string;
}
interface RefreshBody {
  refreshToken: string;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const guards = new AuthGuards(deps);

  app.post<{ Body: RegisterBody }>(
    '/v1/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Register a new customer',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'fullName', 'password'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            fullName: { type: 'string', minLength: 2, maxLength: 200 },
            password: { type: 'string', minLength: 10, maxLength: 200 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: { customer: customerSchema, tokens: tokensSchema },
            required: ['customer', 'tokens'],
          },
          ...errorResponses,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = await deps.uow.run((repos) =>
        deps.services.auth.register(repos, request.body),
      );
      deps.metrics.authTotal.inc({ result: 'register' });
      return reply.status(201).send({
        customer: serializeCustomer(result.customer),
        tokens: serializeTokens(result.tokens),
      });
    },
  );

  app.post<{ Body: LoginBody }>(
    '/v1/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log in and receive access + refresh tokens',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { customer: customerSchema, tokens: tokensSchema },
            required: ['customer', 'tokens'],
          },
          ...errorResponses,
        },
      },
      // Aggressive limit specifically on login to blunt credential brute force.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const outcome = await deps.uow.run((repos) =>
        deps.services.auth.login(repos, {
          email: request.body.email,
          password: request.body.password,
          userAgent: request.headers['user-agent'] ?? null,
          ip: request.ip,
        }),
      );
      if (!outcome.ok) {
        deps.metrics.authTotal.inc({ result: 'login_failed' });
        // Security side effects (failed-attempt counter) are committed by now.
        if (outcome.reason === 'account_locked') {
          throw new UnauthorizedError('Account is temporarily locked; try again later');
        }
        if (outcome.reason === 'inactive') {
          throw new ForbiddenError('Account is not active');
        }
        throw new UnauthorizedError('Invalid email or password');
      }
      deps.metrics.authTotal.inc({ result: 'login_success' });
      return reply.status(200).send({
        customer: serializeCustomer(outcome.customer),
        tokens: serializeTokens(outcome.tokens),
      });
    },
  );

  app.post<{ Body: RefreshBody }>(
    '/v1/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token for a new token pair',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string', minLength: 20, maxLength: 512 } },
        },
        response: { 200: tokensSchema, ...errorResponses },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const outcome = await deps.uow.run((repos) =>
        deps.services.auth.refresh(repos, {
          refreshToken: request.body.refreshToken,
          userAgent: request.headers['user-agent'] ?? null,
          ip: request.ip,
        }),
      );
      if (!outcome.ok) {
        // Reuse revokes the token family as a committed side effect; still 401.
        throw new UnauthorizedError('Invalid refresh token');
      }
      return reply.status(200).send(serializeTokens(outcome.tokens));
    },
  );

  app.post<{ Body: RefreshBody }>(
    '/v1/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string', minLength: 20, maxLength: 512 } },
        },
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      await deps.uow.run((repos) => deps.services.auth.logout(repos, request.body.refreshToken));
      return reply.status(200).send({ status: 'ok' });
    },
  );

  app.post(
    '/v1/auth/logout-all',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'Revoke every refresh token for the current customer',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.actor(request);
      await deps.uow.run((repos) => deps.services.auth.logoutAll(repos, actor.id));
      return reply.status(200).send({ status: 'ok' });
    },
  );
}
