/**
 * Raw database row shapes, exactly as Postgres returns them (`snake_case`,
 * BIGINT as `bigint` thanks to the type parser in `pool.ts`). Repositories map
 * these to domain objects; nothing outside the persistence layer should import
 * this file.
 */

export interface CustomerRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  role: string;
  status: string;
  email_verified_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  password_changed_at: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface RefreshTokenRow {
  id: string;
  customer_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  created_at: Date;
}

export interface LedgerAccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AccountRow {
  id: string;
  customer_id: string;
  ledger_account_id: string;
  account_number: string;
  type: string;
  currency: string;
  status: string;
  cached_balance_minor: bigint;
  allow_overdraft: boolean;
  version: bigint;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TransactionRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  currency: string;
  amount_minor: bigint;
  initiated_by: string;
  description: string | null;
  reversal_of_id: string | null;
  initiated_request_id: string | null;
  created_at: Date;
  posted_at: Date;
}

export interface LedgerEntryRow {
  id: string;
  transaction_id: string;
  ledger_account_id: string;
  direction: string;
  amount_minor: bigint;
  currency: string;
  created_at: Date;
}

export interface StatementRowDb {
  entry_id: string;
  transaction_id: string;
  transaction_type: string;
  reference: string;
  direction: string;
  amount_minor: bigint;
  signed_amount_minor: bigint;
  currency: string;
  description: string | null;
  created_at: Date;
}

export interface IdempotencyRow {
  id: string;
  customer_id: string;
  endpoint: string;
  key: string;
  request_hash: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
  transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

export interface BeneficiaryRow {
  id: string;
  customer_id: string;
  name: string;
  account_number: string;
  bank_code: string;
  currency: string;
  status: string;
  created_at: Date;
  deleted_at: Date | null;
}
