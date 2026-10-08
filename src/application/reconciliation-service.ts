import type { AccountId } from '../domain/enums.js';
import { NotFoundError } from '../domain/errors.js';
import type { BalanceMismatch, Repositories } from './ports.js';

export interface AccountReconciliation {
  readonly accountId: AccountId;
  readonly cachedBalanceMinor: bigint;
  readonly ledgerBalanceMinor: bigint;
  readonly differenceMinor: bigint;
  readonly matches: boolean;
}

export interface LedgerReconciliation {
  readonly balanced: boolean;
  readonly totalDebitMinor: bigint;
  readonly totalCreditMinor: bigint;
  readonly mismatchedAccounts: BalanceMismatch[];
}

/**
 * Proves the central invariant: every cached balance equals its ledger-derived
 * balance, and globally Σ debits == Σ credits. A non-empty result is an
 * operational alarm, not a normal outcome.
 */
export class ReconciliationService {
  async account(repos: Repositories, accountId: AccountId): Promise<AccountReconciliation> {
    const account = await repos.accounts.findById(accountId);
    if (!account) throw new NotFoundError('Account');
    const ledgerBalanceMinor = await repos.accounts.ledgerBalanceOf(account.ledgerAccountId);
    const differenceMinor = account.cachedBalanceMinor - ledgerBalanceMinor;
    return {
      accountId,
      cachedBalanceMinor: account.cachedBalanceMinor,
      ledgerBalanceMinor,
      differenceMinor,
      matches: differenceMinor === 0n,
    };
  }

  async overall(repos: Repositories, mismatchLimit = 100): Promise<LedgerReconciliation> {
    const totals = await repos.transactions.ledgerTotals();
    const mismatchedAccounts = await repos.accounts.findBalanceMismatches(mismatchLimit);
    return {
      balanced: totals.debitMinor === totals.creditMinor,
      totalDebitMinor: totals.debitMinor,
      totalCreditMinor: totals.creditMinor,
      mismatchedAccounts,
    };
  }
}
