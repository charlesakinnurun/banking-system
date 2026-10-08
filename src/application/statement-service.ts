import type { Account } from '../domain/account.js';
import type { AccountId } from '../domain/enums.js';
import type { Repositories, StatementRow } from './ports.js';
import type { LedgerActor } from './ledger-service.js';
import type { AccountService } from './account-service.js';

export interface StatementRequest {
  readonly accountId: AccountId;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
}

export interface Statement {
  readonly account: Account;
  readonly openingBalanceMinor: bigint;
  readonly closingBalanceMinor: bigint;
  readonly entries: StatementRow[];
}

export class StatementService {
  constructor(private readonly accounts: AccountService) {}

  async get(
    repos: Repositories,
    actor: LedgerActor,
    request: StatementRequest,
  ): Promise<Statement> {
    // Reuses the account authorization rule (ownership) — a customer cannot read
    // another customer's statement.
    const account = await this.accounts.getById(repos, actor, request.accountId);

    const entries = await repos.transactions.listStatement({
      ledgerAccountId: account.ledgerAccountId,
      ...(request.from ? { from: request.from } : {}),
      ...(request.to ? { to: request.to } : {}),
      limit: request.limit,
    });

    // Entries are newest-first. Closing balance is the account's current cached
    // balance; opening = closing minus the signed sum of the returned window.
    const windowDelta = entries.reduce((sum, e) => sum + e.signedAmountMinor, 0n);
    const closingBalanceMinor = account.cachedBalanceMinor;
    const openingBalanceMinor = closingBalanceMinor - windowDelta;

    return { account, openingBalanceMinor, closingBalanceMinor, entries };
  }
}
