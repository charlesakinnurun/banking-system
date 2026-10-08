import type {
  CreateCustomerInput,
  CustomerRecord,
  CustomerRepository,
  ListCustomersQuery,
} from '../../application/ports.js';
import type { CustomerId } from '../../domain/enums.js';
import type { Queryable } from '../db/queryable.js';
import type { CustomerRow } from '../db/rows.js';
import { toCustomerRecord } from './row-mappers.js';

export class PgCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: CustomerId): Promise<CustomerRecord | null> {
    const res = await this.db.query<CustomerRow>(
      `SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return res.rows[0] ? toCustomerRecord(res.rows[0]) : null;
  }

  async findByIdForUpdate(id: CustomerId): Promise<CustomerRecord | null> {
    const res = await this.db.query<CustomerRow>(
      `SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    return res.rows[0] ? toCustomerRecord(res.rows[0]) : null;
  }

  async findByEmail(email: string): Promise<CustomerRecord | null> {
    const res = await this.db.query<CustomerRow>(
      `SELECT * FROM customers WHERE email = $1 AND deleted_at IS NULL`,
      [email.trim().toLowerCase()],
    );
    return res.rows[0] ? toCustomerRecord(res.rows[0]) : null;
  }

  async create(input: CreateCustomerInput): Promise<CustomerRecord> {
    const res = await this.db.query<CustomerRow>(
      `INSERT INTO customers (email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.email.trim().toLowerCase(), input.fullName.trim(), input.passwordHash, input.role],
    );
    return toCustomerRecord(res.rows[0]!);
  }

  async updatePassword(id: CustomerId, passwordHash: string): Promise<void> {
    await this.db.query(
      `UPDATE customers
          SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [id, passwordHash],
    );
  }

  async recordSuccessfulLogin(id: CustomerId): Promise<void> {
    await this.db.query(
      `UPDATE customers
          SET failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [id],
    );
  }

  async recordFailedLogin(
    id: CustomerId,
    maxAttempts: number,
    lockoutSeconds: number,
  ): Promise<{ attempts: number; lockedUntil: Date | null }> {
    const res = await this.db.query<{ failed_login_attempts: number; locked_until: Date | null }>(
      `UPDATE customers
          SET failed_login_attempts = failed_login_attempts + 1,
              locked_until = CASE
                WHEN failed_login_attempts + 1 >= $2 THEN now() + make_interval(secs => $3)
                ELSE locked_until
              END
        WHERE id = $1
        RETURNING failed_login_attempts, locked_until`,
      [id, maxAttempts, lockoutSeconds],
    );
    const row = res.rows[0]!;
    return { attempts: row.failed_login_attempts, lockedUntil: row.locked_until };
  }

  async setStatus(id: CustomerId, status: CustomerRecord['status']): Promise<void> {
    await this.db.query(`UPDATE customers SET status = $2 WHERE id = $1`, [id, status]);
  }

  async list(query: ListCustomersQuery): Promise<{ items: CustomerRecord[]; total: number }> {
    const values: unknown[] = [];
    let where = `WHERE deleted_at IS NULL`;
    if (query.search) {
      values.push(`%${query.search.trim().toLowerCase()}%`);
      where += ` AND (email ILIKE $${values.length} OR full_name ILIKE $${values.length})`;
    }

    const countRes = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM customers ${where}`,
      values,
    );

    values.push(query.limit, query.offset);
    const listRes = await this.db.query<CustomerRow>(
      `SELECT * FROM customers ${where}
        ORDER BY created_at DESC, id
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: listRes.rows.map(toCustomerRecord),
      total: Number.parseInt(countRes.rows[0]!.count, 10),
    };
  }
}
