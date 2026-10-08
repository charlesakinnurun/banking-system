import type {
  CreateRefreshTokenInput,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../application/ports.js';
import type { CustomerId } from '../../domain/enums.js';
import type { Queryable } from '../db/queryable.js';
import type { RefreshTokenRow } from '../db/rows.js';

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedById: row.replaced_by_id,
  };
}

export class PgRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const res = await this.db.query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (customer_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.customerId, input.tokenHash, input.expiresAt, input.userAgent, input.ip],
    );
    return toRecord(res.rows[0]!);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const res = await this.db.query<RefreshTokenRow>(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async revoke(id: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
  }

  async revokeWithReplacement(id: string, replacedById: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = $2 WHERE id = $1`,
      [id, replacedById],
    );
  }

  async revokeAllForCustomer(customerId: CustomerId): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL`,
      [customerId],
    );
  }
}
