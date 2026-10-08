import type { Pool, PoolClient } from 'pg';

/**
 * Anything a repository can run SQL against: the pool, or a client bound to an
 * open transaction. Repositories take this so the same code path works inside
 * or outside a transaction.
 */
export type Queryable = Pool | PoolClient;
