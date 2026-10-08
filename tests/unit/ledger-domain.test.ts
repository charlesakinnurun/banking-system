import { describe, expect, it } from 'vitest';
import { UnbalancedTransactionError, ValidationError } from '../../src/domain/errors.js';
import {
  assertBalanced,
  balanceDelta,
  normalBalanceOf,
  planDeposit,
  planReversal,
  planTransfer,
  planWithdrawal,
  type PostingSpec,
} from '../../src/domain/ledger.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('double-entry algebra', () => {
  it('accepts every balanced plan', () => {
    expect(() =>
      assertBalanced(
        planDeposit({
          customerLedgerAccountId: A,
          settlementLedgerAccountId: B,
          amountMinor: 100n,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertBalanced(
        planWithdrawal({
          customerLedgerAccountId: A,
          settlementLedgerAccountId: B,
          amountMinor: 100n,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertBalanced(
        planTransfer({ fromLedgerAccountId: A, toLedgerAccountId: B, amountMinor: 100n }),
      ),
    ).not.toThrow();
  });

  it('rejects a transaction whose debits and credits differ', () => {
    const postings: PostingSpec[] = [
      { ledgerAccountId: A, direction: 'debit', amountMinor: 100n },
      { ledgerAccountId: B, direction: 'credit', amountMinor: 50n },
    ];
    expect(() => assertBalanced(postings)).toThrow(UnbalancedTransactionError);
  });

  it('rejects a single-entry transaction', () => {
    expect(() =>
      assertBalanced([{ ledgerAccountId: A, direction: 'debit', amountMinor: 100n }]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('rejects non-positive amounts even when they appear balanced', () => {
    const postings: PostingSpec[] = [
      { ledgerAccountId: A, direction: 'debit', amountMinor: 0n },
      { ledgerAccountId: B, direction: 'credit', amountMinor: 0n },
    ];
    expect(() => assertBalanced(postings)).toThrow(ValidationError);
  });

  it('reversal flips sides and remains balanced', () => {
    const original = planTransfer({
      fromLedgerAccountId: A,
      toLedgerAccountId: B,
      amountMinor: 250n,
    });
    const reversed = planReversal(original);
    expect(reversed).toContainEqual({ ledgerAccountId: A, direction: 'credit', amountMinor: 250n });
    expect(reversed).toContainEqual({ ledgerAccountId: B, direction: 'debit', amountMinor: 250n });
    expect(() => assertBalanced(reversed)).not.toThrow();
  });

  it('signs balance changes by the account normal balance', () => {
    expect(normalBalanceOf('liability')).toBe('credit');
    expect(normalBalanceOf('asset')).toBe('debit');
    expect(balanceDelta('liability', 'credit', 100n)).toBe(100n);
    expect(balanceDelta('liability', 'debit', 100n)).toBe(-100n);
    expect(balanceDelta('asset', 'debit', 100n)).toBe(100n);
  });
});
