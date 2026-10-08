import type { Beneficiary } from '../../domain/beneficiary.js';
import type { BeneficiaryRepository, CreateBeneficiaryInput } from '../../application/ports.js';
import type { BeneficiaryId, CustomerId } from '../../domain/enums.js';
import type { Queryable } from '../db/queryable.js';
import type { BeneficiaryRow } from '../db/rows.js';
import { toBeneficiary } from './row-mappers.js';

export class PgBeneficiaryRepository implements BeneficiaryRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateBeneficiaryInput): Promise<Beneficiary> {
    const res = await this.db.query<BeneficiaryRow>(
      `INSERT INTO beneficiaries (customer_id, name, account_number, bank_code, currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.customerId,
        input.name.trim(),
        input.accountNumber,
        input.bankCode,
        input.currency.toUpperCase(),
      ],
    );
    return toBeneficiary(res.rows[0]!);
  }

  async listByCustomer(customerId: CustomerId): Promise<Beneficiary[]> {
    const res = await this.db.query<BeneficiaryRow>(
      `SELECT * FROM beneficiaries
        WHERE customer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id`,
      [customerId],
    );
    return res.rows.map(toBeneficiary);
  }

  async findByIdForCustomer(
    id: BeneficiaryId,
    customerId: CustomerId,
  ): Promise<Beneficiary | null> {
    const res = await this.db.query<BeneficiaryRow>(
      `SELECT * FROM beneficiaries
        WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
      [id, customerId],
    );
    return res.rows[0] ? toBeneficiary(res.rows[0]) : null;
  }

  async archive(id: BeneficiaryId, customerId: CustomerId): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE beneficiaries
          SET status = 'archived', deleted_at = now()
        WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
      [id, customerId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
