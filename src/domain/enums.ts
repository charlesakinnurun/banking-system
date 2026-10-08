/**
 * Domain enumerations and identifier aliases.
 *
 * These are plain string unions (not TS `enum`s) so they serialise cleanly and
 * are validated at the boundaries against the arrays below, which are the
 * single source of truth and are mirrored by DB CHECK constraints.
 */

export const ACCOUNT_STATUSES = ['active', 'frozen', 'closed'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_TYPES = ['checking', 'savings'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CUSTOMER_ROLES = ['customer', 'support', 'admin'] as const;
export type CustomerRole = (typeof CUSTOMER_ROLES)[number];

export const CUSTOMER_STATUSES = ['active', 'suspended', 'closed'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const LEDGER_DIRECTIONS = ['debit', 'credit'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

/**
 * Normal balance side by ledger account type. A "liability" (a customer
 * account, from the bank's perspective) increases on the credit side; an
 * "asset" (e.g. the cash/settlement account) increases on the debit side.
 */
export const LEDGER_ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const TRANSACTION_TYPES = ['deposit', 'withdrawal', 'transfer', 'fee', 'reversal'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['posted'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const BENEFICIARY_STATUSES = ['active', 'archived'] as const;
export type BeneficiaryStatus = (typeof BENEFICIARY_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'deposit_completed',
  'withdrawal_completed',
  'transfer_sent',
  'transfer_received',
  'reversal_completed',
  'account_frozen',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// Identifier aliases. UUID v4 strings in the database; aliased for readability
// at call sites so a `TransactionId` cannot be silently passed where a
// `CustomerId` is expected in review.
export type CustomerId = string;
export type AccountId = string;
export type LedgerAccountId = string;
export type TransactionId = string;
export type LedgerEntryId = string;
export type BeneficiaryId = string;
export type NotificationId = string;
export type AuditEventId = string;
export type RefreshTokenId = string;
