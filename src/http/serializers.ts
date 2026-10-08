import type { Account } from '../domain/account.js';
import type { Beneficiary } from '../domain/beneficiary.js';
import type { Customer } from '../domain/customer.js';
import type { AuthTokens } from '../application/auth-service.js';
import type { StatementRow, TransactionHeader } from '../application/ports.js';

/** Convert domain objects into stable, string-safe API payloads. */

export function serializeMoney(
  amountMinor: bigint,
  currency: string,
): {
  amountMinor: string;
  currency: string;
} {
  return { amountMinor: amountMinor.toString(), currency };
}

export function serializeAccount(account: Account): Record<string, unknown> {
  return {
    id: account.id,
    customerId: account.customerId,
    accountNumber: account.accountNumber,
    type: account.type,
    currency: account.currency,
    status: account.status,
    balance: serializeMoney(account.cachedBalanceMinor, account.currency),
    createdAt: account.createdAt.toISOString(),
  };
}

export function serializeTransaction(transaction: TransactionHeader): Record<string, unknown> {
  return {
    id: transaction.id,
    reference: transaction.reference,
    type: transaction.type,
    status: 'posted',
    amount: serializeMoney(transaction.amountMinor, transaction.currency),
    createdAt: transaction.createdAt.toISOString(),
  };
}

export function serializeCustomer(customer: Customer): Record<string, unknown> {
  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.fullName,
    role: customer.role,
    status: customer.status,
    createdAt: customer.createdAt.toISOString(),
  };
}

export function serializeTokens(tokens: AuthTokens): Record<string, unknown> {
  return {
    tokenType: tokens.tokenType,
    accessToken: tokens.accessToken,
    expiresInSeconds: tokens.expiresInSeconds,
    refreshToken: tokens.refreshToken,
    refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
  };
}

export function serializeBeneficiary(beneficiary: Beneficiary): Record<string, unknown> {
  return {
    id: beneficiary.id,
    name: beneficiary.name,
    accountNumber: beneficiary.accountNumber,
    bankCode: beneficiary.bankCode,
    currency: beneficiary.currency,
    status: beneficiary.status,
    createdAt: beneficiary.createdAt.toISOString(),
  };
}

export function serializeStatementRow(row: StatementRow): Record<string, unknown> {
  return {
    entryId: row.entryId,
    transactionId: row.transactionId,
    type: row.transactionType,
    reference: row.reference,
    direction: row.direction,
    amount: serializeMoney(row.amountMinor, row.currency),
    signedAmount: serializeMoney(row.signedAmountMinor, row.currency),
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}
