import type { Pool } from 'pg';
import type { AppConfig } from './config/env.js';
import { createPool, registerPoolErrorHandler } from './infrastructure/db/pool.js';
import { PgUnitOfWork } from './infrastructure/db/unit-of-work.js';
import { SystemClock } from './infrastructure/system/clock.js';
import { CryptoIdGenerator } from './infrastructure/system/id.js';
import { ScryptPasswordHasher } from './infrastructure/crypto/password.js';
import { Hs256TokenService } from './infrastructure/crypto/token-service.js';
import { RuleBasedRiskEngine } from './infrastructure/risk/risk-engine.js';
import { createLogger } from './observability/logger.js';
import { Metrics } from './observability/metrics.js';
import { AccountService } from './application/account-service.js';
import { AdminService } from './application/admin-service.js';
import { AuthService } from './application/auth-service.js';
import { BeneficiaryService } from './application/beneficiary-service.js';
import { LedgerService } from './application/ledger-service.js';
import { ReconciliationService } from './application/reconciliation-service.js';
import { StatementService } from './application/statement-service.js';
import type { AppDependencies } from './http/types.js';

export const APP_VERSION = '0.1.0';
const MAX_ACCOUNTS_PER_CUSTOMER = 20;

export interface Container {
  readonly deps: AppDependencies;
  readonly pool: Pool;
  shutdown(): Promise<void>;
}

/**
 * Composition root. This is the ONLY place that knows how ports map to
 * concrete adapters. Everything downstream receives interfaces.
 */
export function buildContainer(config: AppConfig): Container {
  const logger = createLogger(config);
  const metrics = new Metrics();

  const pool = createPool(config);
  registerPoolErrorHandler(pool, (error) => logger.error({ err: error }, 'postgres pool error'));

  const uow = new PgUnitOfWork(pool, logger);
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  const hasher = new ScryptPasswordHasher(config.scrypt);
  const tokens = new Hs256TokenService({
    secret: config.jwtSecret,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    ttlSeconds: config.accessTokenTtlSeconds,
    clock,
    idGenerator: ids,
  });

  const risk = new RuleBasedRiskEngine({
    maxSingleTransferMinor: config.risk.maxSingleTransferMinor,
    dailyVelocityMinor: config.risk.dailyVelocityMinor,
    maxTxnPerMinute: config.risk.maxTxnPerMinute,
  });

  const accounts = new AccountService({
    clock,
    ids,
    maxAccountsPerCustomer: MAX_ACCOUNTS_PER_CUSTOMER,
  });
  const ledger = new LedgerService({ clock, ids, risk });

  const deps: AppDependencies = {
    config,
    logger,
    metrics,
    uow,
    clock,
    ids,
    tokens,
    hasher,
    services: {
      auth: new AuthService({
        clock,
        ids,
        hasher,
        tokens,
        accessTtlSeconds: config.accessTokenTtlSeconds,
        refreshTokenTtlDays: config.refreshTokenTtlDays,
        loginMaxFailedAttempts: config.loginMaxFailedAttempts,
        loginLockoutSeconds: config.loginLockoutSeconds,
      }),
      accounts,
      ledger,
      beneficiaries: new BeneficiaryService(),
      statements: new StatementService(accounts),
      reconciliation: new ReconciliationService(),
      admin: new AdminService(),
    },
    readiness: async () => {
      try {
        const client = await pool.connect();
        try {
          await client.query('SELECT 1');
        } finally {
          client.release();
        }
        return true;
      } catch {
        return false;
      }
    },
    version: APP_VERSION,
  };

  return {
    deps,
    pool,
    shutdown: async () => {
      await pool.end();
    },
  };
}
