import type { Account } from '../domain/account.js';
import {
  ACCOUNT_TYPES,
  type AccountId,
  type AccountType,
  type CustomerId,
} from '../domain/enums.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../domain/errors.js';
import { currencyExponent } from '../domain/money.js';
import type { Clock, IdGenerator, Repositories } from './ports.js';
import type { LedgerActor } from './ledger-service.js';
import { customerLedgerCode, maskAccountNumber } from './system-accounts.js';

export interface CreateAccountRequest {
  readonly type: AccountType;
  readonly currency: string;
  /** Only honoured for privileged actors; customers always own their own account. */
  readonly customerId?: CustomerId;
}

export interface AccountServiceDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly maxAccountsPerCustomer: number;
}

export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  async create(
    repos: Repositories,
    actor: LedgerActor,
    input: CreateAccountRequest,
  ): Promise<Account> {
    if (!ACCOUNT_TYPES.includes(input.type)) {
      throw new ValidationError(`Unsupported account type: ${input.type}`);
    }
    const currency = input.currency.toUpperCase();
    currencyExponent(currency); // reject unknown currencies up front

    if (actor.role === 'customer' && input.customerId && input.customerId !== actor.id) {
      throw new ForbiddenError('Customers may only open accounts for themselves');
    }
    const ownerId = actor.role === 'customer' ? actor.id : (input.customerId ?? actor.id);

    const owner = await repos.customers.findById(ownerId);
    if (!owner) throw new NotFoundError('Customer');

    const existing = await repos.accounts.countByCustomer(ownerId);
    if (existing >= this.deps.maxAccountsPerCustomer) {
      throw new ConflictError(
        `Account limit of ${this.deps.maxAccountsPerCustomer} reached for this customer`,
      );
    }

    const accountNumber = await this.allocateAccountNumber(repos);
    const ledgerAccount = await repos.ledgerAccounts.create({
      code: customerLedgerCode(accountNumber),
      name: `Customer account ${maskAccountNumber(accountNumber)} (${currency})`,
      type: 'liability',
      currency,
      isSystem: false,
    });
    const account = await repos.accounts.create({
      customerId: ownerId,
      accountNumber,
      type: input.type,
      currency,
      ledgerAccountId: ledgerAccount.id,
    });

    await repos.audit.record({
      actorId: actor.id,
      action: 'account.opened',
      entityType: 'account',
      entityId: account.id,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      metadata: {
        customerId: ownerId,
        type: account.type,
        currency: account.currency,
        accountNumber: maskAccountNumber(account.accountNumber),
      },
    });

    return account;
  }

  async getById(repos: Repositories, actor: LedgerActor, accountId: AccountId): Promise<Account> {
    const account = await repos.accounts.findById(accountId);
    if (!account) throw new NotFoundError('Account');
    if (actor.role === 'customer' && account.customerId !== actor.id) {
      throw new NotFoundError('Account');
    }
    return account;
  }

  async listForActor(
    repos: Repositories,
    actor: LedgerActor,
    customerId?: CustomerId,
  ): Promise<Account[]> {
    if (actor.role === 'customer') {
      return repos.accounts.listByCustomer(actor.id);
    }
    return repos.accounts.listByCustomer(customerId ?? actor.id);
  }

  private async allocateAccountNumber(repos: Repositories): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = this.deps.ids.accountNumber();
      const existingAccount = await repos.accounts.findByAccountNumber(candidate);
      const existingLedger = await repos.ledgerAccounts.findByCode(customerLedgerCode(candidate));
      if (!existingAccount && !existingLedger) return candidate;
    }
    throw new ServiceUnavailableError('Could not allocate a unique account number');
  }
}
