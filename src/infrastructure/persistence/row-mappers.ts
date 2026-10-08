import type { Account } from '../../domain/account.js';
import type { Beneficiary } from '../../domain/beneficiary.js';
import type { Customer } from '../../domain/customer.js';
import type {
  AccountStatus,
  AccountType,
  BeneficiaryStatus,
  CustomerRole,
  CustomerStatus,
  LedgerAccountType,
} from '../../domain/enums.js';
import type {
  CustomerRecord,
  LedgerAccountRecord,
  StatementRow,
  TransactionHeader,
} from '../../application/ports.js';
import type {
  AccountRow,
  BeneficiaryRow,
  CustomerRow,
  LedgerAccountRow,
  StatementRowDb,
  TransactionRow,
} from '../db/rows.js';

/**
 * Explicit row -> domain mappers. We deliberately avoid implicit casting so a
 * column rename is a compile error, not a runtime surprise in the money path.
 */

export function toCustomerRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as CustomerRole,
    status: row.status as CustomerStatus,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    passwordHash: row.password_hash,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    passwordChangedAt: row.password_changed_at,
  };
}

export function toCustomer(row: CustomerRow): Customer {
  const {
    passwordHash: _p,
    failedLoginAttempts: _f,
    lockedUntil: _l,
    passwordChangedAt: _c,
    ...customer
  } = toCustomerRecord(row);
  return customer;
}

export function toLedgerAccount(row: LedgerAccountRow): LedgerAccountRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as LedgerAccountType,
    currency: row.currency,
    isSystem: row.is_system,
    createdAt: row.created_at,
  };
}

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    customerId: row.customer_id,
    accountNumber: row.account_number,
    type: row.type as AccountType,
    currency: row.currency,
    status: row.status as AccountStatus,
    ledgerAccountId: row.ledger_account_id,
    cachedBalanceMinor: row.cached_balance_minor,
    allowOverdraft: row.allow_overdraft,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function toTransactionHeader(row: TransactionRow): TransactionHeader {
  return {
    id: row.id,
    reference: row.reference,
    type: row.type as TransactionHeader['type'],
    currency: row.currency,
    amountMinor: row.amount_minor,
    initiatedBy: row.initiated_by,
    description: row.description,
    reversalOfId: row.reversal_of_id,
    createdAt: row.created_at,
    postedAt: row.posted_at,
  };
}

export function toStatementRow(row: StatementRowDb): StatementRow {
  return {
    entryId: row.entry_id,
    transactionId: row.transaction_id,
    transactionType: row.transaction_type as StatementRow['transactionType'],
    reference: row.reference,
    direction: row.direction as StatementRow['direction'],
    amountMinor: row.amount_minor,
    signedAmountMinor: row.signed_amount_minor,
    currency: row.currency,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function toBeneficiary(row: BeneficiaryRow): Beneficiary {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    accountNumber: row.account_number,
    bankCode: row.bank_code,
    currency: row.currency,
    status: row.status as BeneficiaryStatus,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}
