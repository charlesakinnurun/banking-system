import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NotFoundError, isAppError } from '../../domain/errors.js';
import type { AppDependencies } from '../types.js';
import { AuthGuards } from '../plugins/auth.js';
import { runIdempotent, type StoredResponse } from '../../application/idempotency.js';
import type { LedgerActor } from '../../application/ledger-service.js';
import type { Repositories } from '../../application/ports.js';
import {
  amountMinorSchema,
  currencySchema,
  errorResponses,
  idempotencyKeyHeaderSchema,
  transactionSchema,
  uuidSchema,
} from '../schemas.js';
import { serializeMoney, serializeTransaction } from '../serializers.js';

interface MoneyBody {
  accountId: string;
  amountMinor: string;
  currency: string;
  description?: string;
}

interface TransferBody {
  fromAccountId: string;
  toAccountNumber: string;
  amountMinor: string;
  currency: string;
  note?: string;
}

interface TransactionParams {
  id: string;
}

const moneyMovementResponse = {
  type: 'object',
  properties: {
    transaction: transactionSchema,
    affectedAccounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          accountId: uuidSchema,
          balance: {
            type: 'object',
            properties: { amountMinor: { type: 'string' }, currency: { type: 'string' } },
          },
        },
        required: ['accountId', 'balance'],
      },
    },
  },
  required: ['transaction', 'affectedAccounts'],
} as const;

const idempotencyHeaders = {
  type: 'object',
  // Required is enforced by our guard so we can return a precise error code
  // rather than the framework's generic validation error.
  properties: { 'idempotency-key': idempotencyKeyHeaderSchema },
} as const;

export function registerTransactionRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const guards = new AuthGuards(deps);
  const ttlHours = deps.config.idempotencyTtlHours;

  async function execute(
    request: FastifyRequest,
    reply: FastifyReply,
    endpoint: string,
    body: unknown,
    work: (
      repos: Repositories,
      actor: LedgerActor,
    ) => Promise<{ response: StoredResponse; transactionId: string }>,
  ): Promise<FastifyReply> {
    const actor = AuthGuards.ledgerActor(request);
    const idempotencyKey = AuthGuards.idempotencyKey(request);
    const stored = await deps.uow.run((repos) =>
      runIdempotent(
        { repos, customerId: actor.id, endpoint, idempotencyKey, requestBody: body, ttlHours },
        () => work(repos, actor),
      ),
    );
    return reply.status(stored.statusCode).send(stored.body);
  }

  app.post<{ Body: MoneyBody }>(
    '/v1/transactions/deposit',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['transactions'],
        summary: 'Deposit funds into an account (idempotent)',
        security: [{ bearerAuth: [] }],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['accountId', 'amountMinor', 'currency'],
          properties: {
            accountId: uuidSchema,
            amountMinor: amountMinorSchema,
            currency: currencySchema,
            description: { type: 'string', maxLength: 500 },
          },
        },
        response: { 201: moneyMovementResponse, ...errorResponses },
      },
    },
    async (request, reply) => {
      const body = request.body;
      return execute(
        request,
        reply,
        'POST /v1/transactions/deposit',
        body,
        async (repos, actor) => {
          const result = await deps.services.ledger.deposit(repos, actor, {
            accountId: body.accountId,
            amountMinor: BigInt(body.amountMinor),
            currency: body.currency,
            description: body.description ?? null,
          });
          deps.metrics.ledgerTransactionsTotal.inc({ type: 'deposit', result: 'posted' });
          return {
            response: {
              statusCode: 201,
              body: {
                transaction: serializeTransaction(result.transaction),
                affectedAccounts: result.affectedAccounts.map((a) => ({
                  accountId: a.accountId,
                  balance: serializeMoney(a.newBalanceMinor, body.currency),
                })),
              },
            },
            transactionId: result.transaction.id,
          };
        },
      );
    },
  );

  app.post<{ Body: MoneyBody }>(
    '/v1/transactions/withdraw',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['transactions'],
        summary: 'Withdraw funds from an account (idempotent)',
        security: [{ bearerAuth: [] }],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['accountId', 'amountMinor', 'currency'],
          properties: {
            accountId: uuidSchema,
            amountMinor: amountMinorSchema,
            currency: currencySchema,
            description: { type: 'string', maxLength: 500 },
          },
        },
        response: { 201: moneyMovementResponse, ...errorResponses },
      },
    },
    async (request, reply) => {
      const body = request.body;
      return execute(
        request,
        reply,
        'POST /v1/transactions/withdraw',
        body,
        async (repos, actor) => {
          try {
            const result = await deps.services.ledger.withdraw(repos, actor, {
              accountId: body.accountId,
              amountMinor: BigInt(body.amountMinor),
              currency: body.currency,
              description: body.description ?? null,
            });
            deps.metrics.ledgerTransactionsTotal.inc({ type: 'withdrawal', result: 'posted' });
            return {
              response: {
                statusCode: 201,
                body: {
                  transaction: serializeTransaction(result.transaction),
                  affectedAccounts: result.affectedAccounts.map((a) => ({
                    accountId: a.accountId,
                    balance: serializeMoney(a.newBalanceMinor, body.currency),
                  })),
                },
              },
              transactionId: result.transaction.id,
            };
          } catch (error) {
            if (isAppError(error) && error.code === 'risk_rejected') {
              deps.metrics.riskRejectionsTotal.inc({ reason: 'withdrawal' });
            }
            throw error;
          }
        },
      );
    },
  );

  app.post<{ Body: TransferBody }>(
    '/v1/transfers',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['transfers'],
        summary: 'Transfer between accounts (idempotent)',
        security: [{ bearerAuth: [] }],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['fromAccountId', 'toAccountNumber', 'amountMinor', 'currency'],
          properties: {
            fromAccountId: uuidSchema,
            toAccountNumber: { type: 'string', pattern: '^[0-9]{10}$' },
            amountMinor: amountMinorSchema,
            currency: currencySchema,
            note: { type: 'string', maxLength: 500 },
          },
        },
        response: { 201: moneyMovementResponse, ...errorResponses },
      },
    },
    async (request, reply) => {
      const body = request.body;
      return execute(request, reply, 'POST /v1/transfers', body, async (repos, actor) => {
        try {
          const result = await deps.services.ledger.transfer(repos, actor, {
            fromAccountId: body.fromAccountId,
            toAccountNumber: body.toAccountNumber,
            amountMinor: BigInt(body.amountMinor),
            currency: body.currency,
            note: body.note ?? null,
          });
          deps.metrics.ledgerTransactionsTotal.inc({ type: 'transfer', result: 'posted' });
          return {
            response: {
              statusCode: 201,
              body: {
                transaction: serializeTransaction(result.transaction),
                affectedAccounts: result.affectedAccounts.map((a) => ({
                  accountId: a.accountId,
                  balance: serializeMoney(a.newBalanceMinor, body.currency),
                })),
              },
            },
            transactionId: result.transaction.id,
          };
        } catch (error) {
          if (isAppError(error) && error.code === 'risk_rejected') {
            deps.metrics.riskRejectionsTotal.inc({ reason: 'transfer' });
          }
          throw error;
        }
      });
    },
  );

  app.get<{ Params: TransactionParams }>(
    '/v1/transactions/:id',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['transactions'],
        summary: 'Get one transaction',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: uuidSchema } },
        response: { 200: transactionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.actor(request);
      const transaction = await deps.uow.run((repos) =>
        repos.transactions.findById(request.params.id),
      );
      if (!transaction) throw new NotFoundError('Transaction');
      // A customer may only see transactions they initiated (admin/support may see all).
      if (actor.role === 'customer' && transaction.initiatedBy !== actor.id) {
        throw new NotFoundError('Transaction');
      }
      return reply.send(serializeTransaction(transaction));
    },
  );
}
