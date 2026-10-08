import { UnbalancedTransactionError, ValidationError } from './errors.js';
import type {
  LedgerAccountId,
  LedgerAccountType,
  LedgerDirection,
  LedgerEntryId,
  TransactionId,
} from './enums.js';

/**
 * Pure ledger algebra. This module has no I/O and no framework imports; it is
 * the mathematical core that every money movement is built on and is tested
 * independently of the database.
 *
 * Sign convention used internally for balancing:
 *   debit  => +amountMinor
 *   credit => -amountMinor
 * A transaction balances iff the signed sum is exactly zero.
 */

export interface PostingSpec {
  readonly ledgerAccountId: LedgerAccountId;
  readonly direction: LedgerDirection;
  /** Always strictly positive, in minor units. */
  readonly amountMinor: bigint;
}

export interface LedgerEntryRecord {
  readonly id: LedgerEntryId;
  readonly transactionId: TransactionId;
  readonly ledgerAccountId: LedgerAccountId;
  readonly direction: LedgerDirection;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly createdAt: Date;
}

/** Signed contribution of a posting to the balancing check. */
export function signedForBalancing(direction: LedgerDirection, amountMinor: bigint): bigint {
  return direction === 'debit' ? amountMinor : -amountMinor;
}

export function totalDebits(postings: readonly PostingSpec[]): bigint {
  return postings
    .filter((p) => p.direction === 'debit')
    .reduce((sum, p) => sum + p.amountMinor, 0n);
}

export function totalCredits(postings: readonly PostingSpec[]): bigint {
  return postings
    .filter((p) => p.direction === 'credit')
    .reduce((sum, p) => sum + p.amountMinor, 0n);
}

/**
 * The core invariant: Σ debits === Σ credits. Also rejects non-positive
 * amounts and any single-sided posting, which are the two ways a "balanced"
 * transaction can still be nonsense.
 */
export function assertBalanced(postings: readonly PostingSpec[]): void {
  if (postings.length < 2) {
    throw new UnbalancedTransactionError({ postings: postings.length });
  }
  for (const p of postings) {
    if (p.amountMinor <= 0n) {
      throw new ValidationError('Ledger postings must have a positive amount', {
        ledgerAccountId: p.ledgerAccountId,
        amountMinor: p.amountMinor.toString(),
      });
    }
  }
  const debits = totalDebits(postings);
  const credits = totalCredits(postings);
  if (debits !== credits) {
    throw new UnbalancedTransactionError({
      debits: debits.toString(),
      credits: credits.toString(),
    });
  }
  const signed = postings.reduce(
    (sum, p) => sum + signedForBalancing(p.direction, p.amountMinor),
    0n,
  );
  if (signed !== 0n) {
    throw new UnbalancedTransactionError({ signedSum: signed.toString() });
  }
}

/** The side on which a ledger account of `type` increases. */
export function normalBalanceOf(type: LedgerAccountType): LedgerDirection {
  switch (type) {
    case 'asset':
    case 'expense':
      return 'debit';
    case 'liability':
    case 'equity':
    case 'revenue':
      return 'credit';
  }
}

/**
 * Signed change to a ledger account's balance for one posting, i.e. what should
 * be added to a running balance. Positive means the balance increases.
 */
export function balanceDelta(
  type: LedgerAccountType,
  direction: LedgerDirection,
  amountMinor: bigint,
): bigint {
  return direction === normalBalanceOf(type) ? amountMinor : -amountMinor;
}

/**
 * Pure double-entry plans. Amounts are always positive; direction is carried by
 * the posting. Keeping these here (not in a service) means the money math is
 * unit-tested with zero infrastructure.
 */

/** Customer deposit: bank receives cash (asset ↑, debit), customer liability ↑ (credit). */
export function planDeposit(params: {
  customerLedgerAccountId: LedgerAccountId;
  settlementLedgerAccountId: LedgerAccountId;
  amountMinor: bigint;
}): PostingSpec[] {
  return [
    {
      ledgerAccountId: params.settlementLedgerAccountId,
      direction: 'debit',
      amountMinor: params.amountMinor,
    },
    {
      ledgerAccountId: params.customerLedgerAccountId,
      direction: 'credit',
      amountMinor: params.amountMinor,
    },
  ];
}

/** Customer withdrawal: customer liability ↓ (debit), bank pays cash (asset ↓, credit). */
export function planWithdrawal(params: {
  customerLedgerAccountId: LedgerAccountId;
  settlementLedgerAccountId: LedgerAccountId;
  amountMinor: bigint;
}): PostingSpec[] {
  return [
    {
      ledgerAccountId: params.customerLedgerAccountId,
      direction: 'debit',
      amountMinor: params.amountMinor,
    },
    {
      ledgerAccountId: params.settlementLedgerAccountId,
      direction: 'credit',
      amountMinor: params.amountMinor,
    },
  ];
}

/** Internal transfer: sender liability ↓ (debit), receiver liability ↑ (credit). */
export function planTransfer(params: {
  fromLedgerAccountId: LedgerAccountId;
  toLedgerAccountId: LedgerAccountId;
  amountMinor: bigint;
}): PostingSpec[] {
  return [
    {
      ledgerAccountId: params.fromLedgerAccountId,
      direction: 'debit',
      amountMinor: params.amountMinor,
    },
    {
      ledgerAccountId: params.toLedgerAccountId,
      direction: 'credit',
      amountMinor: params.amountMinor,
    },
  ];
}

/** Reversal: same accounts and amounts as the original, with sides swapped. */
export function planReversal(original: readonly PostingSpec[]): PostingSpec[] {
  return original.map((p) => ({
    ledgerAccountId: p.ledgerAccountId,
    direction: p.direction === 'debit' ? 'credit' : 'debit',
    amountMinor: p.amountMinor,
  }));
}
