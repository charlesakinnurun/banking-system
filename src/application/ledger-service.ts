import { assertAccountActive, type Account } from '../domain/account.js';
import type { AccountId, CustomerRole, LedgerAccountId } from '../domain/enums.js';
import {
  ConflictError,
  CurrencyMismatchError,
  ForbiddenError,
  InsufficientFundsError,
  NotFoundError,
  RiskRejectedError,
  ServiceUnavailableError,
  ValidationError,
} from '../domain/errors.js';
import {
  assertBalanced,
  balanceDelta,
  planDeposit,
  planReversal,
  planTransfer,
  planWithdrawal,
} from '../domain/ledger.js';
import type {
  Clock,
  IdGenerator,
  LedgerAccountRecord,
  Repositories,
  RiskEngine,
  TransactionHeader,
} from './ports.js';
import { maskAccountNumber, settlementAccountCode } from './system-accounts.js';

export interface LedgerActor {
  readonly id: string;
  readonly role: CustomerRole;
  readonly requestId?: string | null;
  readonly ip?: string | null;
}

export interface LedgerResult {
  readonly transaction: TransactionHeader;
  readonly affectedAccounts: ReadonlyArray<{ accountId: AccountId; newBalanceMinor: bigint }>;
}

export interface DepositInput {
  readonly accountId: AccountId;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly description?: string | null;
}

export interface WithdrawInput {
  readonly accountId: AccountId;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly description?: string | null;
}

export interface TransferInput {
  readonly fromAccountId: AccountId;
  readonly toAccountNumber: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly note?: string | null;
}

export interface ReverseInput {
  readonly originalTransactionId: string;
  readonly reason?: string | null;
}

export interface LedgerServiceDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly risk: RiskEngine;
}

/**
 * The single component permitted to create ledger entries. Every public method
 * performs all of its work inside the caller-provided transaction (`repos` is
 * tx-bound), so either the whole money movement commits or none of it does.
 *
 * Invariants enforced here AND in the database:
 *   - entries balance (assertBalanced + deferred constraint trigger)
 *   - posted records are immutable (DB trigger)
 *   - balances never go negative for non-overdraft accounts (check + constraint)
 *   - affected balances are updated in the same transaction as the entries
 */
export class LedgerService {
  constructor(private readonly deps: LedgerServiceDeps) {}

  async deposit(
    repos: Repositories,
    actor: LedgerActor,
    input: DepositInput,
  ): Promise<LedgerResult> {
    assertPositive(input.amountMinor);
    const account = await this.lockAccount(repos, input.accountId);
    this.assertOwner(actor, account);
    assertAccountActive(account);
    assertCurrency(account.currency, input.currency);
    const settlement = await this.settlement(repos, input.currency);

    const postings = planDeposit({
      customerLedgerAccountId: account.ledgerAccountId,
      settlementLedgerAccountId: settlement.id,
      amountMinor: input.amountMinor,
    });
    assertBalanced(postings);

    const header = await repos.transactions.insertHeader({
      reference: this.deps.ids.transactionReference(),
      type: 'deposit',
      currency: input.currency,
      amountMinor: input.amountMinor,
      initiatedBy: actor.id,
      description: input.description ?? null,
      reversalOfId: null,
      requestId: actor.requestId ?? null,
    });
    await repos.transactions.insertEntries(header.id, input.currency, postings);
    const newBalance = await repos.accounts.applyBalanceDelta(account.id, input.amountMinor);

    await repos.audit.record({
      actorId: actor.id,
      action: 'deposit.posted',
      entityType: 'transaction',
      entityId: header.id,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      metadata: {
        accountId: account.id,
        accountNumber: maskAccountNumber(account.accountNumber),
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
      },
    });
    await repos.notifications.enqueue({
      customerId: account.customerId,
      transactionId: header.id,
      type: 'deposit_completed',
      payload: {
        reference: header.reference,
        accountId: account.id,
        accountNumberMasked: maskAccountNumber(account.accountNumber),
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
        newBalanceMinor: newBalance.toString(),
      },
    });

    return {
      transaction: header,
      affectedAccounts: [{ accountId: account.id, newBalanceMinor: newBalance }],
    };
  }

  async withdraw(
    repos: Repositories,
    actor: LedgerActor,
    input: WithdrawInput,
  ): Promise<LedgerResult> {
    assertPositive(input.amountMinor);
    const account = await this.lockAccount(repos, input.accountId);
    this.assertOwner(actor, account);
    assertAccountActive(account);
    assertCurrency(account.currency, input.currency);
    await this.enforceRisk(repos, actor, account, 'withdrawal', input.amountMinor, input.currency);

    this.assertSufficientFunds(account, input.amountMinor);
    const settlement = await this.settlement(repos, input.currency);

    const postings = planWithdrawal({
      customerLedgerAccountId: account.ledgerAccountId,
      settlementLedgerAccountId: settlement.id,
      amountMinor: input.amountMinor,
    });
    assertBalanced(postings);

    const header = await repos.transactions.insertHeader({
      reference: this.deps.ids.transactionReference(),
      type: 'withdrawal',
      currency: input.currency,
      amountMinor: input.amountMinor,
      initiatedBy: actor.id,
      description: input.description ?? null,
      reversalOfId: null,
      requestId: actor.requestId ?? null,
    });
    await repos.transactions.insertEntries(header.id, input.currency, postings);
    const newBalance = await repos.accounts.applyBalanceDelta(account.id, -input.amountMinor);

    await repos.audit.record({
      actorId: actor.id,
      action: 'withdrawal.posted',
      entityType: 'transaction',
      entityId: header.id,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      metadata: {
        accountId: account.id,
        accountNumber: maskAccountNumber(account.accountNumber),
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
      },
    });
    await repos.notifications.enqueue({
      customerId: account.customerId,
      transactionId: header.id,
      type: 'withdrawal_completed',
      payload: {
        reference: header.reference,
        accountId: account.id,
        accountNumberMasked: maskAccountNumber(account.accountNumber),
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
        newBalanceMinor: newBalance.toString(),
      },
    });

    return {
      transaction: header,
      affectedAccounts: [{ accountId: account.id, newBalanceMinor: newBalance }],
    };
  }

  async transfer(
    repos: Repositories,
    actor: LedgerActor,
    input: TransferInput,
  ): Promise<LedgerResult> {
    assertPositive(input.amountMinor);

    const destination = await repos.accounts.findByAccountNumber(input.toAccountNumber);
    if (!destination) throw new NotFoundError('Destination account');
    if (destination.id === input.fromAccountId) {
      throw new ValidationError('Cannot transfer to the same account');
    }

    // Lock BOTH accounts in deterministic id order (deadlock avoidance).
    const locked = await repos.accounts.lockByIds([input.fromAccountId, destination.id]);
    const source = locked.find((a) => a.id === input.fromAccountId);
    const target = locked.find((a) => a.id === destination.id);
    if (!source) throw new NotFoundError('Source account');
    if (!target) throw new NotFoundError('Destination account');

    this.assertOwner(actor, source);
    assertAccountActive(source);
    assertAccountActive(target);
    assertCurrency(source.currency, input.currency);
    if (source.currency !== target.currency) {
      throw new CurrencyMismatchError(source.currency, target.currency);
    }

    await this.enforceRisk(repos, actor, source, 'transfer', input.amountMinor, input.currency);
    this.assertSufficientFunds(source, input.amountMinor);

    const postings = planTransfer({
      fromLedgerAccountId: source.ledgerAccountId,
      toLedgerAccountId: target.ledgerAccountId,
      amountMinor: input.amountMinor,
    });
    assertBalanced(postings);

    const header = await repos.transactions.insertHeader({
      reference: this.deps.ids.transactionReference(),
      type: 'transfer',
      currency: input.currency,
      amountMinor: input.amountMinor,
      initiatedBy: actor.id,
      description: input.note ?? null,
      reversalOfId: null,
      requestId: actor.requestId ?? null,
    });
    await repos.transactions.insertEntries(header.id, input.currency, postings);
    const sourceBalance = await repos.accounts.applyBalanceDelta(source.id, -input.amountMinor);
    const targetBalance = await repos.accounts.applyBalanceDelta(target.id, input.amountMinor);
    await repos.transfers.create({
      transactionId: header.id,
      fromAccountId: source.id,
      toAccountId: target.id,
      amountMinor: input.amountMinor,
      feeMinor: 0n,
      currency: input.currency,
      note: input.note ?? null,
    });

    await repos.audit.record({
      actorId: actor.id,
      action: 'transfer.posted',
      entityType: 'transaction',
      entityId: header.id,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      metadata: {
        fromAccountId: source.id,
        toAccountId: target.id,
        fromAccountNumber: maskAccountNumber(source.accountNumber),
        toAccountNumber: maskAccountNumber(target.accountNumber),
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
      },
    });
    await repos.notifications.enqueue({
      customerId: source.customerId,
      transactionId: header.id,
      type: 'transfer_sent',
      payload: {
        reference: header.reference,
        accountId: source.id,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
        newBalanceMinor: sourceBalance.toString(),
        counterpartyAccountMasked: maskAccountNumber(target.accountNumber),
      },
    });
    await repos.notifications.enqueue({
      customerId: target.customerId,
      transactionId: header.id,
      type: 'transfer_received',
      payload: {
        reference: header.reference,
        accountId: target.id,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
        newBalanceMinor: targetBalance.toString(),
        counterpartyAccountMasked: maskAccountNumber(source.accountNumber),
      },
    });

    return {
      transaction: header,
      affectedAccounts: [
        { accountId: source.id, newBalanceMinor: sourceBalance },
        { accountId: target.id, newBalanceMinor: targetBalance },
      ],
    };
  }

  /**
   * Compensating reversal. Never mutates the original transaction — it posts a
   * new transaction whose entries mirror the original with sides swapped.
   */
  async reverse(
    repos: Repositories,
    actor: LedgerActor,
    input: ReverseInput,
  ): Promise<LedgerResult> {
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only an administrator can reverse a transaction');
    }
    const original = await repos.transactions.findById(input.originalTransactionId);
    if (!original) throw new NotFoundError('Transaction');
    if (original.type === 'reversal') {
      throw new ValidationError('A reversal transaction cannot itself be reversed');
    }
    if (await repos.transactions.hasReversalOf(original.id)) {
      throw new ConflictError('Transaction has already been reversed');
    }

    const originalPostings = await repos.transactions.getPostings(original.id);
    const reversed = planReversal(originalPostings);
    assertBalanced(reversed);

    // Find and lock the customer accounts touched by the original transaction.
    const ledgerIds = [...new Set(originalPostings.map((p) => p.ledgerAccountId))];
    const affectedAccounts = await repos.accounts.findByLedgerAccountIds(ledgerIds);
    const locked = await repos.accounts.lockByIds(affectedAccounts.map((a) => a.id));
    const byLedgerId = new Map<LedgerAccountId, Account>(locked.map((a) => [a.ledgerAccountId, a]));

    // Signed change per affected customer (liability) account = -originalChange.
    const deltas = new Map<AccountId, bigint>();
    for (const posting of originalPostings) {
      const account = byLedgerId.get(posting.ledgerAccountId);
      if (!account) continue; // system account: no cached balance to update
      const originalChange = balanceDelta('liability', posting.direction, posting.amountMinor);
      deltas.set(account.id, (deltas.get(account.id) ?? 0n) - originalChange);
    }

    for (const [accountId, delta] of deltas) {
      const account = locked.find((a) => a.id === accountId)!;
      if (!account.allowOverdraft && account.cachedBalanceMinor + delta < 0n) {
        throw new ConflictError(
          `Reversal would overdraw account; use the suspense/overdraft flow instead`,
          // details are intentionally generic to avoid leaking balances
        );
      }
    }

    const header = await repos.transactions.insertHeader({
      reference: this.deps.ids.transactionReference(),
      type: 'reversal',
      currency: original.currency,
      amountMinor: original.amountMinor,
      initiatedBy: actor.id,
      description: input.reason ?? `Reversal of ${original.reference}`,
      reversalOfId: original.id,
      requestId: actor.requestId ?? null,
    });
    await repos.transactions.insertEntries(header.id, original.currency, reversed);

    const affected: Array<{ accountId: AccountId; newBalanceMinor: bigint }> = [];
    for (const [accountId, delta] of deltas) {
      const newBalance = await repos.accounts.applyBalanceDelta(accountId, delta);
      affected.push({ accountId, newBalanceMinor: newBalance });
    }

    await repos.audit.record({
      actorId: actor.id,
      action: 'reversal.posted',
      entityType: 'transaction',
      entityId: header.id,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      metadata: {
        reversalOf: original.id,
        originalReference: original.reference,
        amountMinor: original.amountMinor.toString(),
        currency: original.currency,
      },
    });

    for (const [accountId] of deltas) {
      const account = locked.find((a) => a.id === accountId)!;
      await repos.notifications.enqueue({
        customerId: account.customerId,
        transactionId: header.id,
        type: 'reversal_completed',
        payload: {
          reference: header.reference,
          accountId: account.id,
          amountMinor: original.amountMinor.toString(),
          currency: original.currency,
          originalReference: original.reference,
        },
      });
    }

    return { transaction: header, affectedAccounts: affected };
  }

  // -------------------------------------------------------------------------

  private async lockAccount(repos: Repositories, id: AccountId): Promise<Account> {
    const [account] = await repos.accounts.lockByIds([id]);
    if (!account) throw new NotFoundError('Account');
    return account;
  }

  private assertOwner(actor: LedgerActor, account: Account): void {
    if (actor.role === 'customer' && account.customerId !== actor.id) {
      // 404 rather than 403 to avoid confirming the existence of others' accounts.
      throw new NotFoundError('Account');
    }
  }

  private assertSufficientFunds(account: Account, amountMinor: bigint): void {
    if (!account.allowOverdraft && account.cachedBalanceMinor - amountMinor < 0n) {
      throw new InsufficientFundsError({ accountId: account.id });
    }
  }

  private async settlement(repos: Repositories, currency: string): Promise<LedgerAccountRecord> {
    const code = settlementAccountCode(currency);
    const account = await repos.ledgerAccounts.findByCode(code);
    if (!account) {
      throw new ServiceUnavailableError(`Settlement ledger account ${code} is not configured`);
    }
    return account;
  }

  private async enforceRisk(
    repos: Repositories,
    actor: LedgerActor,
    account: Account,
    type: 'withdrawal' | 'transfer',
    amountMinor: bigint,
    currency: string,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const minuteSince = new Date(now.getTime() - 60_000);
    const daySince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const activity = await repos.transactions.recentActivity(
      account.ledgerAccountId,
      minuteSince,
      daySince,
    );
    const decision = this.deps.risk.assess({
      customerId: account.customerId,
      type,
      amountMinor,
      currency,
      txnsLastMinute: activity.txnsLastMinute,
      debitsLastDayMinor: activity.debitsLastDayMinor,
    });
    if (!decision.allowed) {
      throw new RiskRejectedError(decision.reason ?? 'rejected', { accountId: account.id, type });
    }
  }
}

function assertPositive(amountMinor: bigint): void {
  if (amountMinor <= 0n) throw new ValidationError('Amount must be greater than zero');
}

function assertCurrency(accountCurrency: string, requestCurrency: string): void {
  if (accountCurrency !== requestCurrency.toUpperCase()) {
    throw new CurrencyMismatchError(requestCurrency.toUpperCase(), accountCurrency);
  }
}
