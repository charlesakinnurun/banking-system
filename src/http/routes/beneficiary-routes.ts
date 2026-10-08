import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../types.js';
import { AuthGuards } from '../plugins/auth.js';
import { currencySchema, errorResponses, uuidSchema } from '../schemas.js';
import { serializeBeneficiary } from '../serializers.js';

interface CreateBeneficiaryBody {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
}
interface BeneficiaryParams {
  id: string;
}

const beneficiarySchema = {
  type: 'object',
  properties: {
    id: uuidSchema,
    name: { type: 'string' },
    accountNumber: { type: 'string' },
    bankCode: { type: 'string' },
    currency: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'string' },
  },
  required: ['id', 'name', 'accountNumber', 'bankCode', 'currency', 'status'],
} as const;

export function registerBeneficiaryRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const guards = new AuthGuards(deps);

  app.get(
    '/v1/beneficiaries',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['beneficiaries'],
        summary: 'List saved beneficiaries',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: { items: { type: 'array', items: beneficiarySchema } },
            required: ['items'],
          },
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      const items = await deps.uow.run((repos) => deps.services.beneficiaries.list(repos, actor));
      return reply.send({ items: items.map(serializeBeneficiary) });
    },
  );

  app.post<{ Body: CreateBeneficiaryBody }>(
    '/v1/beneficiaries',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['beneficiaries'],
        summary: 'Create a beneficiary',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'accountNumber', 'bankCode', 'currency'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120 },
            accountNumber: { type: 'string', pattern: '^[0-9]{10}$' },
            bankCode: { type: 'string', pattern: '^[A-Za-z0-9]{3,11}$' },
            currency: currencySchema,
          },
        },
        response: { 201: beneficiarySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      const beneficiary = await deps.uow.run((repos) =>
        deps.services.beneficiaries.create(repos, actor, request.body),
      );
      return reply.status(201).send(serializeBeneficiary(beneficiary));
    },
  );

  app.delete<{ Params: BeneficiaryParams }>(
    '/v1/beneficiaries/:id',
    {
      preHandler: guards.authenticate,
      schema: {
        tags: ['beneficiaries'],
        summary: 'Archive a beneficiary',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: uuidSchema } },
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    async (request, reply) => {
      const actor = AuthGuards.ledgerActor(request);
      await deps.uow.run((repos) =>
        deps.services.beneficiaries.archive(repos, actor, request.params.id),
      );
      return reply.status(204).send();
    },
  );
}
