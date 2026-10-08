import type { CreateTransferDetailInput, TransferRepository } from '../../application/ports.js';
import type { Queryable } from '../db/queryable.js';

export class PgTransferRepository implements TransferRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateTransferDetailInput): Promise<void> {
    await this.db.query(
      `INSERT INTO transfers (transaction_id, from_account_id, to_account_id, amount_minor, fee_minor, currency, note)
       VALUES ($1, $2, $3, $4::bigint, $5::bigint, $6, $7)`,
      [
        input.transactionId,
        input.fromAccountId,
        input.toAccountId,
        input.amountMinor.toString(),
        input.feeMinor.toString(),
        input.currency,
        input.note,
      ],
    );
  }
}
