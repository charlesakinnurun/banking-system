import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { AppDependencies } from './types.js';
import { registerErrorHandler } from './plugins/errors.js';
import { registerObservability } from './plugins/observability.js';
import { registerSwagger } from './swagger.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { registerAccountRoutes } from './routes/account-routes.js';
import { registerTransactionRoutes } from './routes/transaction-routes.js';
import { registerBeneficiaryRoutes } from './routes/beneficiary-routes.js';
import { registerAdminRoutes } from './routes/admin-routes.js';
import { registerHealthRoutes } from './routes/health-routes.js';

export async function buildServer(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    // We own structured logging (deps.logger) and access logs (observability
    // plugin), so Fastify's built-in logger is disabled to avoid double logging.
    logger: false,
    trustProxy: deps.config.trustProxy,
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      const value = Array.isArray(inbound) ? inbound[0] : inbound;
      return value && value.length <= 128 ? value : randomUUID();
    },
    bodyLimit: 128 * 1024,
  });

  // Security headers. CSP is disabled only because the bundled Swagger UI uses
  // inline scripts; a real deployment should either serve docs separately or
  // provide a strict CSP (see SECURITY.md).
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: deps.config.corsOrigins.length > 0 ? deps.config.corsOrigins : false,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE'],
  });

  await app.register(rateLimit, {
    global: true,
    max: deps.config.rateLimitMax,
    timeWindow: deps.config.rateLimitWindow,
    errorResponseBuilder: (request: FastifyRequest, context: { after: string }) => ({
      error: {
        code: 'rate_limited',
        message: 'Too many requests; please slow down.',
        requestId: request.id,
        details: { retryAfter: context.after },
      },
    }),
    onExceeded: (request: FastifyRequest) => {
      deps.metrics.rateLimitHitsTotal.inc({ route: request.routeOptions?.url ?? request.url });
    },
  });

  await registerSwagger(app, deps);
  registerObservability(app, deps);
  registerErrorHandler(app, deps);

  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerTransactionRoutes(app, deps);
  registerBeneficiaryRoutes(app, deps);
  registerAdminRoutes(app, deps);

  return app;
}
