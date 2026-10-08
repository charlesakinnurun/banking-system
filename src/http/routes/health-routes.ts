import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../types.js';

export function registerHealthRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.get(
    '/health/live',
    {
      schema: {
        tags: ['ops'],
        summary: 'Liveness probe',
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
        },
      },
    },
    async (_request, reply) => reply.send({ status: 'ok' }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['ops'],
        summary: 'Readiness probe (checks the database)',
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
          503: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        const ready = await deps.readiness();
        if (!ready) return reply.status(503).send({ status: 'unavailable' });
        return reply.send({ status: 'ready' });
      } catch {
        return reply.status(503).send({ status: 'unavailable' });
      }
    },
  );

  if (deps.config.metricsEnabled) {
    app.get(
      deps.config.metricsPath,
      {
        schema: {
          tags: ['ops'],
          summary: 'Prometheus metrics',
          hide: false,
        },
      },
      async (_request, reply) => {
        const body = await deps.metrics.render();
        return reply.header('content-type', deps.metrics.contentType).send(body);
      },
    );
  }
}
