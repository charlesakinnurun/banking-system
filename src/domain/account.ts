import { AccountClosedError, AccountFrozenError } from './errors.js';
import type {
  AccountId,
  AccountStatus,
  AccountType,
  CustomerId,
  LedgerAccountId,
} from './enums.js';

/**
 * A customer-facing bank account. It always maps 1:1 to a *liability* ledger
 * account (the bank owes the customer the balance). `cachedBalanceMinor` is a
 * read-through cache of the ledger; the ledger is the source of truth and the
 * two are checked by reconciliation.
 */
export interface Account {
  readonly id: AccountId;
  readonly customerId: CustomerId;
  readonly accountNumber: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly status: AccountStatus;
  readonly ledgerAccountId: LedgerAccountId;
  readonly cachedBalanceMinor: bigint;
  readonly allowOverdraft: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Business rule: only active accounts can move money. */
export function assertAccountActive(account: Account): void {
  if (account.status === 'frozen') throw new AccountFrozenError();
  if (account.status === 'closed') throw new AccountClosedError();
}

export const ACCOUNT_NUMBER_LENGTH = 10;

/** Basic structural validation. Real banks also use check digits (see README). */
export function isValidAccountNumberFormat(value: string): boolean {
  return /^\d{10}$/.test(value);
}
