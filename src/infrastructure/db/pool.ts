import { Pool, types } from 'pg';
import type { AppConfig } from '../../config/env.js';

/**
 * `pg` returns int8 (BIGINT) as a string by default to avoid precision loss.
 * We convert to `bigint` at the driver boundary so the rest of the code can do
 * exact money arithmetic. This runs once, at import time, before any query.
 */
types.setTypeParser(20, (value: string) => BigInt(value));
// numeric (OID 1700) is not used for money, but keep it as a string rather than
// silently becoming a lossy float if anyone ever selects one.
types.setTypeParser(1700, (value: string) => value);

export function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: config.dbPoolIdleTimeoutMs,
    connectionTimeoutMillis: config.dbConnectionTimeoutMs,
    statement_timeout: config.dbStatementTimeoutMs,
    application_name: 'codealpha-banking-system',
  });
}

/**
 * Attach an application logger to pool-level errors. An idle client emitting an
 * error (e.g. server restart) must not crash the process; logging lets the pool
 * replace the connection. MUST be called by every owner of a pool.
 */
export function registerPoolErrorHandler(pool: Pool, handler: (error: Error) => void): void {
  pool.on('error', handler);
}
