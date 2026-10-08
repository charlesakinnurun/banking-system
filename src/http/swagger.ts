import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { AppDependencies } from './types.js';

export async function registerSwagger(app: FastifyInstance, deps: AppDependencies): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CodeAlpha Banking API',
        description:
          'Double-entry banking backend. Money is expressed in integer minor units. ' +
          'All money-movement endpoints require an Idempotency-Key header.',
        version: deps.version,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Registration, login, tokens' },
        { name: 'accounts', description: 'Accounts and statements' },
        { name: 'transactions', description: 'Deposits and withdrawals' },
        { name: 'transfers', description: 'Internal transfers' },
        { name: 'beneficiaries', description: 'Saved payees' },
        { name: 'admin', description: 'Administrative operations' },
        { name: 'ops', description: 'Health and metrics' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}
