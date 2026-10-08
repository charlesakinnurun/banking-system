import type { Pool, PoolClient } from 'pg';
import type { Logger, Repositories, UnitOfWork } from '../../application/ports.js';
import { PgAccountRepository } from '../persistence/account.repository.js';
import { PgAuditRepository } from '../persistence/audit.repository.js';
import { PgBeneficiaryRepository } from '../persistence/beneficiary.repository.js';
import { PgCustomerRepository } from '../persistence/customer.repository.js';
import { PgIdempotencyRepository } from '../persistence/idempotency.repository.js';
import { PgLedgerAccountRepository } from '../persistence/ledger-account.repository.js';
import { PgNotificationRepository } from '../persistence/notification.repository.js';
import { PgRefreshTokenRepository } from '../persistence/refresh-token.repository.js';
import { PgTransactionRepository } from '../persistence/transaction.repository.js';
import { PgTransferRepository } from '../persistence/transfer.repository.js';
import { isRetryableTransactionError } from './pg-errors.js';

export function buildRepositories(client: PoolClient): Repositories {
  return {
    customers: new PgCustomerRepository(client),
    ledgerAccounts: new PgLedgerAccountRepository(client),
    accounts: new PgAccountRepository(client),
    transactions: new PgTransactionRepository(client),
    transfers: new PgTransferRepository(client),
    idempotency: new PgIdempotencyRepository(client),
    beneficiaries: new PgBeneficiaryRepository(client),
    notifications: new PgNotificationRepository(client),
    audit: new PgAuditRepository(client),
    refreshTokens: new PgRefreshTokenRepository(client),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PgUnitOfWorkOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
}

/**
 * Runs a unit of work inside one database transaction.
 *
 * Retries ONLY on transient serialization/deadlock errors (40001 / 40P01):
 * in those cases the transaction was rolled back, so re-running the whole
 * closure is safe. Business/validation errors are never retried. Combined with
 * the idempotency key on the outer request, this is safe end to end.
 */
export class PgUnitOfWork implements UnitOfWork {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
    options: PgUnitOfWorkOptions = { maxAttempts: 3, baseDelayMs: 10 },
  ) {
    this.maxAttempts = options.maxAttempts;
    this.baseDelayMs = options.baseDelayMs;
  }

  async run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(buildRepositories(client));
        await client.query('COMMIT');
        client.release();
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // A failed ROLLBACK (e.g. connection already gone) must not mask the
          // original error; the client is released below regardless.
        }
        // Release exactly once, before any backoff wait, so a retrying unit of
        // work never holds a pool connection while sleeping.
        client.release();

        if (isRetryableTransactionError(error) && attempt < this.maxAttempts) {
          const delay = this.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 10);
          this.logger.warn(
            { attempt, delayMs: delay, err: error },
            'retrying transaction after transient serialization/deadlock error',
          );
          await sleep(delay);
          continue;
        }

        throw error;
      }
    }
  }
}
