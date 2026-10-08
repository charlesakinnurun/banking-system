import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics. Business and HTTP instruments are registered on one
 * registry so `/metrics` exposes process + application signals together.
 */
export class Metrics {
  readonly registry = new Registry();

  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  readonly ledgerTransactionsTotal: Counter<'type' | 'result'>;
  readonly idempotencyTotal: Counter<'result'>;
  readonly authTotal: Counter<'result'>;
  readonly rateLimitHitsTotal: Counter<'route'>;
  readonly riskRejectionsTotal: Counter<'reason'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'banking_' });

    this.httpRequestDuration = new Histogram({
      name: 'banking_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: 'banking_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.ledgerTransactionsTotal = new Counter({
      name: 'banking_ledger_transactions_total',
      help: 'Ledger transactions posted, by type and result',
      labelNames: ['type', 'result'],
      registers: [this.registry],
    });

    this.idempotencyTotal = new Counter({
      name: 'banking_idempotency_total',
      help: 'Idempotency outcomes (reserved, replayed, reused, in_progress)',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.authTotal = new Counter({
      name: 'banking_auth_total',
      help: 'Authentication outcomes',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.rateLimitHitsTotal = new Counter({
      name: 'banking_rate_limit_hits_total',
      help: 'Requests rejected by rate limiting',
      labelNames: ['route'],
      registers: [this.registry],
    });

    this.riskRejectionsTotal = new Counter({
      name: 'banking_risk_rejections_total',
      help: 'Transactions rejected by risk controls',
      labelNames: ['reason'],
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
