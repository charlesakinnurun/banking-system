import { loadConfig } from '../../src/config/env.js';
import { buildContainer, type Container } from '../../src/container.js';
import { buildServer } from '../../src/http/server.js';
import {
  feeRevenueAccountCode,
  settlementAccountCode,
} from '../../src/application/system-accounts.js';
import type { FastifyInstance } from 'fastify';

export interface TestApp {
  readonly app: FastifyInstance;
  readonly container: Container;
}

const TEST_CURRENCIES = ['USD', 'NGN', 'EUR'] as const;

/** Idempotently create the system chart-of-accounts entries the ledger needs. */
async function ensureSystemAccounts(container: Container): Promise<void> {
  await container.deps.uow.run(async (repos) => {
    for (const currency of TEST_CURRENCIES) {
      const cash = settlementAccountCode(currency);
      if (!(await repos.ledgerAccounts.findByCode(cash))) {
        await repos.ledgerAccounts.create({
          code: cash,
          name: `Cash & settlement (${currency})`,
          type: 'asset',
          currency,
          isSystem: true,
        });
      }
      const fee = feeRevenueAccountCode(currency);
      if (!(await repos.ledgerAccounts.findByCode(fee))) {
        await repos.ledgerAccounts.create({
          code: fee,
          name: `Fee revenue (${currency})`,
          type: 'revenue',
          currency,
          isSystem: true,
        });
      }
    }
  });
}

/** Test environment: cheap scrypt, permissive rate limits, silent logs. */
export function testEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'test-secret-value-that-is-at-least-32-characters',
    ACCESS_TOKEN_TTL_SECONDS: '900',
    SCRYPT_COST_N: '1024',
    SCRYPT_MAXMEM_BYTES: '16777216',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '1000000',
    RISK_MAX_SINGLE_TRANSFER_MINOR: '100000000000',
    RISK_DAILY_VELOCITY_MINOR: '1000000000000',
    RISK_MAX_TXN_PER_MINUTE: '1000000',
    METRICS_ENABLED: 'true',
    SEED_DEMO_DATA: 'false',
  };
}

export async function createTestApp(databaseUrl: string): Promise<TestApp> {
  const config = loadConfig(testEnv(databaseUrl));
  const container = buildContainer(config);
  const app = await buildServer(container.deps);
  await app.ready();
  await ensureSystemAccounts(container);
  return { app, container };
}

export async function closeTestApp(harness: TestApp): Promise<void> {
  await harness.app.close();
  await harness.container.shutdown();
}
