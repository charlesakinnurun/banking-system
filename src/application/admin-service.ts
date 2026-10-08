import type { Customer } from '../domain/customer.js';
import type { AccountStatus, CustomerId } from '../domain/enums.js';
import { NotFoundError } from '../domain/errors.js';
import type { CustomerRecord, ListCustomersQuery, Repositories } from './ports.js';
import type { LedgerActor } from './ledger-service.js';

export interface ListCustomersResult {
  readonly items: Customer[];
  readonly total: number;
}

function toPublicCustomer(record: CustomerRecord): Customer {
  return {
    id: record.id,
    email: record.email,
    fullName: record.fullName,
    role: record.role,
    status: record.status,
    emailVerifiedAt: record.emailVerifiedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  };
}

export class AdminService {
  async listCustomers(
    repos: Repositories,
    query: ListCustomersQuery,
  ): Promise<ListCustomersResult> {
    const { items, total } = await repos.customers.list(query);
    return { items: items.map(toPublicCustomer), total };
  }

  /** Freeze (or unfreeze) a customer account. Idempotent and audited. */
  async setAccountStatus(
    repos: Repositories,
    actor: LedgerActor,
    accountId: string,
    status: AccountStatus,
  ): Promise<{ accountId: string; status: AccountStatus }> {
    const [account] = await repos.accounts.lockByIds([accountId]);
    if (!account) throw new NotFoundError('Account');
    if (account.status !== status) {
      await repos.accounts.setStatus(accountId, status);
      await repos.audit.record({
        actorId: actor.id,
        action: 'account.status_changed',
        entityType: 'account',
        entityId: accountId,
        requestId: actor.requestId ?? null,
        ip: actor.ip ?? null,
        metadata: { from: account.status, to: status, customerId: account.customerId },
      });
      if (status === 'frozen') {
        await repos.notifications.enqueue({
          customerId: account.customerId,
          transactionId: null,
          type: 'account_frozen',
          payload: { accountId, previousStatus: account.status },
        });
      }
    }
    return { accountId, status };
  }

  async setCustomerStatus(
    repos: Repositories,
    actor: LedgerActor,
    customerId: CustomerId,
    status: Customer['status'],
  ): Promise<void> {
    const customer = await repos.customers.findByIdForUpdate(customerId);
    if (!customer) throw new NotFoundError('Customer');
    await repos.customers.setStatus(customerId, status);
    if (status !== 'active') {
      // Suspending a customer must not leave live sessions behind.
      await repos.refreshTokens.revokeAllForCustomer(customerId);
    }
    await repos.audit.record({
      actorId: actor.id,
      action: 'customer.status_changed',
      entityType: 'customer',
      entityId: customerId,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      metadata: { from: customer.status, to: status },
    });
  }
}
