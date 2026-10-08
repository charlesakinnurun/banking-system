import type { EnqueueNotificationInput, NotificationRepository } from '../../application/ports.js';
import type { Queryable } from '../db/queryable.js';

export class PgNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Transactional outbox write. Enqueued in the same transaction as the money
   * movement, so a notification is only ever recorded if the movement commits.
   * The unique (transaction_id, type) makes re-enqueueing a no-op.
   */
  async enqueue(input: EnqueueNotificationInput): Promise<void> {
    await this.db.query(
      `INSERT INTO notifications (customer_id, transaction_id, type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (transaction_id, type) DO NOTHING`,
      [input.customerId, input.transactionId, input.type, JSON.stringify(input.payload)],
    );
  }
}
