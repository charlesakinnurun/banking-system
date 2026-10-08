import type {
  CompleteIdempotencyInput,
  CreateIdempotencyInput,
  IdempotencyRecord,
  IdempotencyRepository,
  ReserveIdempotencyResult,
} from '../../application/ports.js';
import type { CustomerId } from '../../domain/enums.js';
import type { Queryable } from '../db/queryable.js';
import type { IdempotencyRow } from '../db/rows.js';

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    id: row.id,
    status: row.status as IdempotencyRecord['status'],
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    transactionId: row.transaction_id,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

export class PgIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Atomically claim an idempotency key.
   *
   * The upsert either inserts a fresh key, or — only if the existing key has
   * EXPIRED — reclaims it for this request. If a live key already exists it is
   * left untouched and we return `reserved: false` so the caller can inspect it
   * (replay, reuse-error, or in-progress). Because everything commits with the
   * money movement in one transaction, a crash can never leave a half-recorded
   * key (see ARCHITECTURE.md §6).
   */
  async reserve(input: CreateIdempotencyInput): Promise<ReserveIdempotencyResult> {
    const upsert = await this.db.query<IdempotencyRow>(
      `INSERT INTO idempotency_keys (customer_id, endpoint, key, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'in_progress', now() + make_interval(hours => $5))
       ON CONFLICT (customer_id, endpoint, key) DO UPDATE
         SET request_hash     = EXCLUDED.request_hash,
             status           = 'in_progress',
             response_status  = NULL,
             response_body    = NULL,
             transaction_id   = NULL,
             updated_at       = now(),
             expires_at       = EXCLUDED.expires_at
         WHERE idempotency_keys.expires_at < now()
       RETURNING *`,
      [input.customerId, input.endpoint, input.key, input.requestHash, input.ttlHours],
    );

    if (upsert.rows[0]) {
      return { reserved: true, record: toRecord(upsert.rows[0]) };
    }

    // A live key already exists (held or completed). Lock and read it so the
    // caller can decide replay vs. reuse-error vs. concurrent-in-progress.
    const existing = await this.db.query<IdempotencyRow>(
      `SELECT * FROM idempotency_keys
        WHERE customer_id = $1 AND endpoint = $2 AND key = $3
        FOR UPDATE`,
      [input.customerId, input.endpoint, input.key],
    );
    if (!existing.rows[0]) {
      // Extremely unlikely: the row vanished between conflict and select.
      // Fall through by re-inserting once.
      const retry = await this.db.query<IdempotencyRow>(
        `INSERT INTO idempotency_keys (customer_id, endpoint, key, request_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, 'in_progress', now() + make_interval(hours => $5))
         RETURNING *`,
        [input.customerId, input.endpoint, input.key, input.requestHash, input.ttlHours],
      );
      return { reserved: true, record: toRecord(retry.rows[0]!) };
    }
    return { reserved: false, record: toRecord(existing.rows[0]) };
  }

  async findByKey(
    customerId: CustomerId,
    endpoint: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const res = await this.db.query<IdempotencyRow>(
      `SELECT * FROM idempotency_keys WHERE customer_id = $1 AND endpoint = $2 AND key = $3`,
      [customerId, endpoint, key],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async complete(input: CompleteIdempotencyInput): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_keys
          SET status = 'completed',
              response_status = $2,
              response_body = $3::jsonb,
              transaction_id = $4,
              updated_at = now()
        WHERE id = $1`,
      [input.id, input.responseStatus, JSON.stringify(input.responseBody), input.transactionId],
    );
  }

  async deleteExpired(now: Date): Promise<number> {
    const res = await this.db.query(`DELETE FROM idempotency_keys WHERE expires_at < $1`, [now]);
    return res.rowCount ?? 0;
  }
}
