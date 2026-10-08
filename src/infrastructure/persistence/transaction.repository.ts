import type {
  InsertTransactionInput,
  RecentActivity,
  StatementQuery,
  StatementRow,
  TransactionHeader,
  TransactionRepository,
} from '../../application/ports.js';
import type { LedgerAccountId, TransactionId } from '../../domain/enums.js';
import type { PostingSpec } from '../../domain/ledger.js';
import type { Queryable } from '../db/queryable.js';
import type { StatementRowDb, TransactionRow } from '../db/rows.js';
import { toStatementRow, toTransactionHeader } from './row-mappers.js';

export class PgTransactionRepository implements TransactionRepository {
  constructor(private readonly db: Queryable) {}

  async insertHeader(input: InsertTransactionInput): Promise<TransactionHeader> {
    const res = await this.db.query<TransactionRow>(
      `INSERT INTO transactions
         (reference, type, currency, amount_minor, initiated_by, description, reversal_of_id, initiated_request_id)
       VALUES ($1, $2, $3, $4::bigint, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.reference,
        input.type,
        input.currency,
        input.amountMinor.toString(),
        input.initiatedBy,
        input.description,
        input.reversalOfId,
        input.requestId,
      ],
    );
    return toTransactionHeader(res.rows[0]!);
  }

  async insertEntries(
    transactionId: TransactionId,
    currency: string,
    postings: readonly PostingSpec[],
  ): Promise<void> {
    if (postings.length === 0) return;
    const values: unknown[] = [transactionId, currency];
    const tuples = postings.map((p) => {
      const base = values.length + 1;
      values.push(p.ledgerAccountId, p.direction, p.amountMinor.toString());
      return `($1, $${base}::uuid, $${base + 1}, $${base + 2}::bigint, $2)`;
    });

    await this.db.query(
      `INSERT INTO ledger_entries (transaction_id, ledger_account_id, direction, amount_minor, currency)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  }

  async findById(id: TransactionId): Promise<TransactionHeader | null> {
    const res = await this.db.query<TransactionRow>(`SELECT * FROM transactions WHERE id = $1`, [
      id,
    ]);
    return res.rows[0] ? toTransactionHeader(res.rows[0]) : null;
  }

  async getPostings(transactionId: TransactionId): Promise<PostingSpec[]> {
    const res = await this.db.query<{
      ledger_account_id: string;
      direction: string;
      amount_minor: bigint;
    }>(
      `SELECT ledger_account_id, direction, amount_minor
         FROM ledger_entries
        WHERE transaction_id = $1
        ORDER BY ledger_account_id, direction`,
      [transactionId],
    );
    return res.rows.map((r) => ({
      ledgerAccountId: r.ledger_account_id,
      direction: r.direction as PostingSpec['direction'],
      amountMinor: r.amount_minor,
    }));
  }

  async hasReversalOf(transactionId: TransactionId): Promise<boolean> {
    const res = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM transactions WHERE reversal_of_id = $1) AS exists`,
      [transactionId],
    );
    return res.rows[0]!.exists;
  }

  async listStatement(query: StatementQuery): Promise<StatementRow[]> {
    const values: unknown[] = [query.ledgerAccountId];
    let filters = ``;
    if (query.from) {
      values.push(query.from);
      filters += ` AND le.created_at >= $${values.length}`;
    }
    if (query.to) {
      values.push(query.to);
      filters += ` AND le.created_at < $${values.length}`;
    }
    values.push(query.limit);

    const res = await this.db.query<StatementRowDb>(
      `SELECT
         le.id                 AS entry_id,
         le.transaction_id     AS transaction_id,
         t.type                AS transaction_type,
         t.reference           AS reference,
         le.direction          AS direction,
         le.amount_minor       AS amount_minor,
         CASE
           WHEN la.type IN ('asset', 'expense')
             THEN (CASE WHEN le.direction = 'debit' THEN le.amount_minor ELSE -le.amount_minor END)
             ELSE (CASE WHEN le.direction = 'credit' THEN le.amount_minor ELSE -le.amount_minor END)
         END                   AS signed_amount_minor,
         le.currency           AS currency,
         t.description         AS description,
         le.created_at         AS created_at
       FROM ledger_entries le
       JOIN transactions   t  ON t.id  = le.transaction_id
       JOIN ledger_accounts la ON la.id = le.ledger_account_id
      WHERE le.ledger_account_id = $1${filters}
      ORDER BY le.created_at DESC, le.id DESC
      LIMIT $${values.length}`,
      values,
    );
    return res.rows.map(toStatementRow);
  }

  async recentActivity(
    ledgerAccountId: LedgerAccountId,
    minuteSince: Date,
    daySince: Date,
  ): Promise<RecentActivity> {
    const res = await this.db.query<{ txns_recent: string; debits_recent: bigint }>(
      `SELECT
         count(*) FILTER (WHERE created_at >= $2)::text AS txns_recent,
         COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit' AND created_at >= $3), 0) AS debits_recent
       FROM ledger_entries
       WHERE ledger_account_id = $1`,
      [ledgerAccountId, minuteSince, daySince],
    );
    const row = res.rows[0]!;
    return {
      txnsLastMinute: Number.parseInt(row.txns_recent, 10),
      debitsLastDayMinor: row.debits_recent ?? 0n,
    };
  }

  async ledgerTotals(): Promise<{ debitMinor: bigint; creditMinor: bigint }> {
    const res = await this.db.query<{ debit_minor: bigint; credit_minor: bigint }>(
      `SELECT
         COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0) AS debit_minor,
         COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0) AS credit_minor
       FROM ledger_entries`,
    );
    const row = res.rows[0]!;
    return { debitMinor: row.debit_minor, creditMinor: row.credit_minor };
  }
}
