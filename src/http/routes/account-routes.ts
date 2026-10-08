import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../../domain/errors.js';
import type { AppDependencies } from '../types.js';
import { AuthGuards } from '../plugins/auth.js';
import { accountSchema, currencySchema, errorResponses, uuidSchema } from '../schemas.js';
import {
  serializeAccount,
  serializeCustomer,
  serializeMoney,
  serializeStatementRow,
} from '../serializers.js';

interface CreateAccountBody {
  type: 'checking' | 'savings';
  currency: string;
  customerId?: string;
}
interface AccountParams {
  id: string;
}
interface StatementQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export function registerAccountRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const guards = new AuthGuards(deps);

  app.get(
    '/v1/me',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['accounts'],
        summary: 'Current authenticated customer',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              id: uuidSchema,
              email: { type: 'string' },
              fullName: { type: 'string' },
              role: { type: 'string' },
              status: { type: 'string' },
            },
            required: ['id', 'email', 'fullName', 'role', 'status'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.actor(request);
      const customer = await deps.uow.run((repos) => repos.customers.findById(actor.id));
      if (!customer) throw new NotFoundError('Customer');
      return reply.send(serializeCustomer(customer));
    },
  );

  app.get(
    '/v1/me/accounts',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['accounts'],
        summary: "List the current customer's accounts",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: { items: { type: 'array', items: accountSchema } },
            required: ['items'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.actor(request);
      const accounts = await deps.uow.run((repos) =>
        deps.services.accounts.listForActor(repos, actor),
      );
      return reply.send({ items: accounts.map(serializeAccount) });
    },
  );

  app.post<{ Body: CreateAccountBody }>(
    '/v1/accounts',
    {
      preHandler: guards.requireRole('customer', 'admin'),
      schema: {
        tags: ['accounts'],
        summary: 'Open a new account',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'currency'],
          properties: {
            type: { type: 'string', enum: ['checking', 'savings'] },
            currency: currencySchema,
            customerId: uuidSchema,
          },
        },
        response: { 201: accountSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      const account = await deps.uow.run((repos) =>
        deps.services.accounts.create(repos, actor, {
          type: request.body.type,
          currency: request.body.currency,
          ...(request.body.customerId ? { customerId: request.body.customerId } : {}),
        }),
      );
      return reply.status(201).send(serializeAccount(account));
    },
  );

  app.get<{ Params: AccountParams }>(
    '/v1/accounts/:id',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['accounts'],
        summary: 'Get one account',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: uuidSchema },
        },
        response: { 200: accountSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      const account = await deps.uow.run((repos) =>
        deps.services.accounts.getById(repos, actor, request.params.id),
      );
      return reply.send(serializeAccount(account));
    },
  );

  app.get<{ Params: AccountParams; Querystring: StatementQuery }>(
    '/v1/accounts/:id/statement',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['accounts'],
        summary: 'Account statement for a date range',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: uuidSchema } },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              account: accountSchema,
              openingBalance: {
                type: 'object',
                properties: { amountMinor: { type: 'string' }, currency: { type: 'string' } },
              },
              closingBalance: {
                type: 'object',
                properties: { amountMinor: { type: 'string' }, currency: { type: 'string' } },
              },
              entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            required: ['account', 'openingBalance', 'closingBalance', 'entries'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      const statement = await deps.uow.run((repos) =>
        deps.services.statements.get(repos, actor, {
          accountId: request.params.id,
          ...(request.query.from ? { from: new Date(request.query.from) } : {}),
          ...(request.query.to ? { to: new Date(request.query.to) } : {}),
          limit: request.query.limit ?? 100,
        }),
      );
      return reply.send({
        account: serializeAccount(statement.account),
        openingBalance: serializeMoney(statement.openingBalanceMinor, statement.account.currency),
        closingBalance: serializeMoney(statement.closingBalanceMinor, statement.account.currency),
        entries: statement.entries.map(serializeStatementRow),
      });
    },
  );
}
