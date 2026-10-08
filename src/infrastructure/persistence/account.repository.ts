import type { Account } from '../../domain/account.js';
import type {
  AccountRepository,
  BalanceMismatch,
  CreateAccountInput,
} from '../../application/ports.js';
import type { AccountId, AccountStatus, CustomerId } from '../../domain/enums.js';
import type { Queryable } from '../db/queryable.js';
import type { AccountRow } from '../db/rows.js';
import { toAccount } from './row-mappers.js';

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateAccountInput): Promise<Account> {
    const res = await this.db.query<AccountRow>(
      `INSERT INTO accounts (customer_id, account_number, type, currency, ledger_account_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.customerId, input.accountNumber, input.type, input.currency, input.ledgerAccountId],
    );
    return toAccount(res.rows[0]!);
  }

  async findById(id: AccountId): Promise<Account | null> {
    const res = await this.db.query<AccountRow>(
      `SELECT * FROM accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return res.rows[0] ? toAccount(res.rows[0]) : null;
  }

  async findByAccountNumber(accountNumber: string): Promise<Account | null> {
    const res = await this.db.query<AccountRow>(
      `SELECT * FROM accounts WHERE account_number = $1 AND deleted_at IS NULL`,
      [accountNumber],
    );
    return res.rows[0] ? toAccount(res.rows[0]) : null;
  }

  async listByCustomer(customerId: CustomerId): Promise<Account[]> {
    const res = await this.db.query<AccountRow>(
      `SELECT * FROM accounts WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY created_at, id`,
      [customerId],
    );
    return res.rows.map(toAccount);
  }

  async findByLedgerAccountIds(ids: readonly string[]): Promise<Account[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const res = await this.db.query<AccountRow>(
      `SELECT * FROM accounts WHERE ledger_account_id = ANY($1::uuid[])`,
      [unique],
    );
    return res.rows.map(toAccount);
  }

  /**
   * Lock accounts for update. We sort the ids ourselves AND order the query by
   * id so every caller acquires locks in the same global order — this is what
   * makes two opposite transfers unable to deadlock (see ARCHITECTURE.md §5).
   */
  async lockByIds(ids: readonly AccountId[]): Promise<Account[]> {
    const unique = [...new Set(ids)].sort();
    if (unique.length === 0) return [];
    const res = await this.db.query<AccountRow>(
      `SELECT * FROM accounts
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
        ORDER BY id
        FOR UPDATE`,
      [unique],
    );
    return res.rows.map(toAccount);
  }

  async applyBalanceDelta(id: AccountId, deltaMinor: bigint): Promise<bigint> {
    const res = await this.db.query<{ cached_balance_minor: bigint }>(
      `UPDATE accounts
          SET cached_balance_minor = cached_balance_minor + $2::bigint,
              version = version + 1
        WHERE id = $1
        RETURNING cached_balance_minor`,
      [id, deltaMinor.toString()],
    );
    return res.rows[0]!.cached_balance_minor;
  }

  async setStatus(id: AccountId, status: AccountStatus): Promise<void> {
    await this.db.query(`UPDATE accounts SET status = $2 WHERE id = $1`, [id, status]);
  }

  async findBalanceMismatches(limit: number): Promise<BalanceMismatch[]> {
    const res = await this.db.query<{
      account_id: string;
      cached_balance_minor: bigint;
      ledger_balance_minor: bigint;
    }>(
      `SELECT
         a.id AS account_id,
         a.cached_balance_minor,
         COALESCE(
           SUM(CASE WHEN le.direction = 'credit' THEN le.amount_minor ELSE -le.amount_minor END),
           0
         ) AS ledger_balance_minor
       FROM accounts a
       LEFT JOIN ledger_entries le ON le.ledger_account_id = a.ledger_account_id
      WHERE a.deleted_at IS NULL
      GROUP BY a.id, a.cached_balance_minor
     HAVING a.cached_balance_minor <> COALESCE(
           SUM(CASE WHEN le.direction = 'credit' THEN le.amount_minor ELSE -le.amount_minor END),
           0
         )
      LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      accountId: r.account_id,
      cachedBalanceMinor: r.cached_balance_minor,
      ledgerBalanceMinor: r.ledger_balance_minor,
    }));
  }

  async ledgerBalanceOf(ledgerAccountId: string): Promise<bigint> {
    const res = await this.db.query<{ ledger_balance_minor: bigint }>(
      `SELECT COALESCE(
                SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE -amount_minor END),
                0
              ) AS ledger_balance_minor
         FROM ledger_entries
        WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    return res.rows[0]!.ledger_balance_minor;
  }

  async countByCustomer(customerId: CustomerId): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM accounts WHERE customer_id = $1 AND deleted_at IS NULL`,
      [customerId],
    );
    return Number.parseInt(res.rows[0]!.count, 10);
  }
}
