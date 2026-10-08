import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppDependencies } from '../types.js';
import { AuthGuards } from '../plugins/auth.js';
import { runIdempotent } from '../../application/idempotency.js';
import { serializeMoney, serializeTransaction } from '../serializers.js';
import {
  errorResponses,
  idempotencyKeyHeaderSchema,
  transactionSchema,
  uuidSchema,
} from '../schemas.js';

interface AccountParams {
  id: string;
}
interface TransactionParams {
  id: string;
}
interface ListCustomersQuery {
  limit?: number;
  offset?: number;
  search?: string;
}
interface ReverseBody {
  reason?: string;
}

const statusResponse = {
  type: 'object',
  properties: { accountId: uuidSchema, status: { type: 'string' } },
  required: ['accountId', 'status'],
} as const;

export function registerAdminRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const guards = new AuthGuards(deps);

  app.get<{ Querystring: ListCustomersQuery }>(
    '/v1/admin/customers',
    {
      preHandler: guards.requireRole('support', 'admin'),
      schema: {
        tags: ['admin'],
        summary: 'List customers',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            search: { type: 'string', maxLength: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'object', additionalProperties: true } },
              total: { type: 'integer' },
            },
            required: ['items', 'total'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await deps.uow.run((repos) =>
        deps.services.admin.listCustomers(repos, {
          limit: request.query.limit ?? 25,
          offset: request.query.offset ?? 0,
          ...(request.query.search ? { search: request.query.search } : {}),
        }),
      );
      return reply.send({
        items: result.items.map((c) => ({
          id: c.id,
          email: c.email,
          fullName: c.fullName,
          role: c.role,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
        })),
        total: result.total,
      });
    },
  );

  app.post<{ Params: AccountParams }>(
    '/v1/admin/accounts/:id/freeze',
    {
      preHandler: guards.requireRole('admin'),
      schema: {
        tags: ['admin'],
        summary: 'Freeze an account',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: uuidSchema } },
        response: { 200: statusResponse, ...errorResponses },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      const result = await deps.uow.run((repos) =>
        deps.services.admin.setAccountStatus(repos, actor, request.params.id, 'frozen'),
      );
      return reply.send(result);
    },
  );

  app.post<{ Params: AccountParams }>(
    '/v1/admin/accounts/:id/unfreeze',
    {
      preHandler: guards.requireRole('admin'),
      schema: {
        tags: ['admin'],
        summary: 'Unfreeze an account',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: uuidSchema } },
        response: { 200: statusResponse, ...errorResponses },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      const result = await deps.uow.run((repos) =>
        deps.services.admin.setAccountStatus(repos, actor, request.params.id, 'active'),
      );
      return reply.send(result);
    },
  );

  app.post<{ Params: TransactionParams; Body: ReverseBody }>(
    '/v1/admin/transactions/:id/reverse',
    {
      preHandler: guards.requireRole('admin'),
      schema: {
        tags: ['admin'],
        summary: 'Reverse a posted transaction with a compensating entry (idempotent)',
        security: [{ bearerAuth: [] }],
        headers: {
          type: 'object',
          properties: { 'idempotency-key': idempotencyKeyHeaderSchema },
        },
        params: { type: 'object', required: ['id'], properties: { id: uuidSchema } },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { reason: { type: 'string', maxLength: 500 } },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              transaction: transactionSchema,
              affectedAccounts: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
            required: ['transaction', 'affectedAccounts'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply): Promise<FastifyReply> => {
      const actor = AuthGuards.ledgerActor(request);
      const idempotencyKey = AuthGuards.idempotencyKey(request);
      const endpoint = `POST /v1/admin/transactions/${request.params.id}/reverse`;
      const stored = await deps.uow.run((repos) =>
        runIdempotent(
          {
            repos,
            customerId: actor.id,
            endpoint,
            idempotencyKey,
            requestBody: request.body,
            ttlHours: deps.config.idempotencyTtlHours,
          },
          async () => {
            const result = await deps.services.ledger.reverse(repos, actor, {
              originalTransactionId: request.params.id,
              reason: request.body.reason ?? null,
            });
            deps.metrics.ledgerTransactionsTotal.inc({ type: 'reversal', result: 'posted' });
            return {
              response: {
                statusCode: 201,
                body: {
                  transaction: serializeTransaction(result.transaction),
                  affectedAccounts: result.affectedAccounts.map((a) => ({
                    accountId: a.accountId,
                    balance: serializeMoney(a.newBalanceMinor, result.transaction.currency),
                  })),
                },
              },
              transactionId: result.transaction.id,
            };
          },
        ),
      );
      return reply.status(stored.statusCode).send(stored.body);
    },
  );

  app.get(
    '/v1/admin/reconciliation',
    {
      preHandler: guards.requireRole('admin'),
      schema: {
        tags: ['admin'],
        summary: 'Verify the ledger balances and no cached balance has drifted',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              balanced: { type: 'boolean' },
              totalDebitMinor: { type: 'string' },
              totalCreditMinor: { type: 'string' },
              mismatchedAccounts: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
            required: ['balanced', 'totalDebitMinor', 'totalCreditMinor', 'mismatchedAccounts'],
          },
          ...errorResponses,
        },
      },
    },
    async (_request, reply) => {
      const result = await deps.uow.run((repos) => deps.services.reconciliation.overall(repos));
      return reply.send({
        balanced: result.balanced,
        totalDebitMinor: result.totalDebitMinor.toString(),
        totalCreditMinor: result.totalCreditMinor.toString(),
        mismatchedAccounts: result.mismatchedAccounts.map((m) => ({
          accountId: m.accountId,
          cachedBalanceMinor: m.cachedBalanceMinor.toString(),
          ledgerBalanceMinor: m.ledgerBalanceMinor.toString(),
        })),
      });
    },
  );

  app.get<{ Params: AccountParams }>(
    '/v1/admin/accounts/:id/reconcile',
    {
      preHandler: guards.requireRole('admin'),
      schema: {
        tags: ['admin'],
        summary: 'Reconcile a single account against the ledger',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: uuidSchema } },
        response: {
          200: {
            type: 'object',
            properties: {
              accountId: uuidSchema,
              cachedBalanceMinor: { type: 'string' },
              ledgerBalanceMinor: { type: 'string' },
              differenceMinor: { type: 'string' },
              matches: { type: 'boolean' },
            },
            required: [
              'accountId',
              'cachedBalanceMinor',
              'ledgerBalanceMinor',
              'differenceMinor',
              'matches',
            ],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await deps.uow.run((repos) =>
        deps.services.reconciliation.account(repos, request.params.id),
      );
      return reply.send({
        accountId: result.accountId,
        cachedBalanceMinor: result.cachedBalanceMinor.toString(),
        ledgerBalanceMinor: result.ledgerBalanceMinor.toString(),
        differenceMinor: result.differenceMinor.toString(),
        matches: result.matches,
      });
    },
  );
}
