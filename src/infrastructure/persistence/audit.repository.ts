import type { AuditRepository, RecordAuditInput } from '../../application/ports.js';
import type { Queryable } from '../db/queryable.js';

export class PgAuditRepository implements AuditRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Append-only audit write, in the same transaction as the change it records.
   * The table is protected by an immutability trigger (0002_integrity.sql).
   */
  async record(input: RecordAuditInput): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, request_id, ip, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.actorId,
        input.action,
        input.entityType,
        input.entityId,
        input.requestId,
        input.ip,
        JSON.stringify(input.metadata),
      ],
    );
  }
}
