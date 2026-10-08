import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../types.js';

/**
 * Request-id propagation, access logs, and HTTP metrics. Fastify generates
 * `request.id` (honouring a bounded inbound `x-request-id`); we echo it back so
 * a client can quote it in a support ticket and correlate it with logs.
 */
export function registerObservability(app: FastifyInstance, deps: AppDependencies): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    const labels = {
      method: request.method,
      route,
      status: String(reply.statusCode),
    };
    deps.metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    deps.metrics.httpRequestsTotal.inc(labels);

    // Access log: method/route/status/latency only — never bodies, headers,
    // query strings, or anything that could contain PII or credentials.
    deps.logger.info(
      {
        requestId: request.id,
        method: request.method,
        route,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        ...(request.actor ? { customerId: request.actor.id } : {}),
      },
      'request completed',
    );
  });
}
