import type {
  CreateLedgerAccountInput,
  LedgerAccountRecord,
  LedgerAccountRepository,
} from '../../application/ports.js';
import type { LedgerAccountId } from '../../domain/enums.js';
import type { Queryable } from '../db/queryable.js';
import type { LedgerAccountRow } from '../db/rows.js';
import { toLedgerAccount } from './row-mappers.js';

export class PgLedgerAccountRepository implements LedgerAccountRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateLedgerAccountInput): Promise<LedgerAccountRecord> {
    const res = await this.db.query<LedgerAccountRow>(
      `INSERT INTO ledger_accounts (code, name, type, currency, is_system)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.code, input.name, input.type, input.currency, input.isSystem],
    );
    return toLedgerAccount(res.rows[0]!);
  }

  async findById(id: LedgerAccountId): Promise<LedgerAccountRecord | null> {
    const res = await this.db.query<LedgerAccountRow>(
      `SELECT * FROM ledger_accounts WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? toLedgerAccount(res.rows[0]) : null;
  }

  async findByIdForUpdate(id: LedgerAccountId): Promise<LedgerAccountRecord | null> {
    const res = await this.db.query<LedgerAccountRow>(
      `SELECT * FROM ledger_accounts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return res.rows[0] ? toLedgerAccount(res.rows[0]) : null;
  }

  async findByCode(code: string): Promise<LedgerAccountRecord | null> {
    const res = await this.db.query<LedgerAccountRow>(
      `SELECT * FROM ledger_accounts WHERE code = $1`,
      [code],
    );
    return res.rows[0] ? toLedgerAccount(res.rows[0]) : null;
  }

  async listSystem(): Promise<LedgerAccountRecord[]> {
    const res = await this.db.query<LedgerAccountRow>(
      `SELECT * FROM ledger_accounts WHERE is_system = true ORDER BY code`,
    );
    return res.rows.map(toLedgerAccount);
  }
}
