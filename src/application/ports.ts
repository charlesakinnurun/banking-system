import type { Account } from '../domain/account.js';
import type { Beneficiary } from '../domain/beneficiary.js';
import type { Customer } from '../domain/customer.js';
import type {
  AccountId,
  AccountStatus,
  AccountType,
  BeneficiaryId,
  CustomerId,
  CustomerRole,
  LedgerAccountId,
  LedgerAccountType,
  LedgerDirection,
  NotificationType,
  TransactionId,
  TransactionType,
} from '../domain/enums.js';
import type { PostingSpec } from '../domain/ledger.js';

/**
 * Ports (interfaces owned by the application layer). Infrastructure provides
 * implementations; application services depend only on these. This is what lets
 * the entire money path be unit-tested with in-memory fakes and keeps SQL and
 * HTTP out of the business logic.
 */

// ---------------------------------------------------------------------------
// Cross-cutting ports
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
  accountNumber(): string;
  transactionReference(): string;
  /** URL-safe random token for refresh tokens / opaque secrets. */
  opaqueToken(bytes?: number): string;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, encoded: string): Promise<boolean>;
}

export interface AccessTokenClaims {
  readonly sub: CustomerId;
  readonly role: CustomerRole;
}

export interface TokenService {
  signAccessToken(claims: AccessTokenClaims): string;
  /** Throws UnauthorizedError on any invalid/expired token. */
  verifyAccessToken(token: string): AccessTokenClaims;
}

export type LogContext = Record<string, unknown>;
export interface Logger {
  debug(ctx: LogContext, msg?: string): void;
  info(ctx: LogContext, msg?: string): void;
  warn(ctx: LogContext, msg?: string): void;
  error(ctx: LogContext, msg?: string): void;
  child(bindings: LogContext): Logger;
}

// ---------------------------------------------------------------------------
// Repository DTOs
// ---------------------------------------------------------------------------

export interface CustomerRecord extends Customer {
  readonly passwordHash: string;
  readonly failedLoginAttempts: number;
  readonly lockedUntil: Date | null;
  readonly passwordChangedAt: Date;
}

export interface CreateCustomerInput {
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly role: CustomerRole;
}

export interface ListCustomersQuery {
  readonly limit: number;
  readonly offset: number;
  readonly search?: string;
}

export interface LedgerAccountRecord {
  readonly id: LedgerAccountId;
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  readonly currency: string;
  readonly isSystem: boolean;
  readonly createdAt: Date;
}

export interface CreateLedgerAccountInput {
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  readonly currency: string;
  readonly isSystem: boolean;
}

export interface CreateAccountInput {
  readonly customerId: CustomerId;
  readonly accountNumber: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly ledgerAccountId: LedgerAccountId;
}

export interface InsertTransactionInput {
  readonly reference: string;
  readonly type: TransactionType;
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly initiatedBy: CustomerId;
  readonly description: string | null;
  readonly reversalOfId: TransactionId | null;
  readonly requestId: string | null;
}

export interface TransactionHeader {
  readonly id: TransactionId;
  readonly reference: string;
  readonly type: TransactionType;
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly initiatedBy: CustomerId;
  readonly description: string | null;
  readonly reversalOfId: TransactionId | null;
  readonly createdAt: Date;
  readonly postedAt: Date;
}

export interface StatementRow {
  readonly entryId: string;
  readonly transactionId: TransactionId;
  readonly transactionType: TransactionType;
  readonly reference: string;
  readonly direction: LedgerDirection;
  readonly amountMinor: bigint;
  readonly signedAmountMinor: bigint;
  readonly currency: string;
  readonly description: string | null;
  readonly createdAt: Date;
}

export interface StatementQuery {
  readonly ledgerAccountId: LedgerAccountId;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
}

export interface CreateIdempotencyInput {
  readonly customerId: CustomerId;
  readonly endpoint: string;
  readonly key: string;
  readonly requestHash: string;
  readonly ttlHours: number;
}

export interface IdempotencyRecord {
  readonly id: string;
  readonly status: 'in_progress' | 'completed';
  readonly requestHash: string;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
  readonly transactionId: TransactionId | null;
  readonly expiresAt: Date;
  readonly updatedAt: Date;
}

export interface ReserveIdempotencyResult {
  /** true when this caller created (or reclaimed) the key and must run the work. */
  readonly reserved: boolean;
  readonly record: IdempotencyRecord;
}

export interface CompleteIdempotencyInput {
  readonly id: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly transactionId: TransactionId | null;
}

export interface CreateBeneficiaryInput {
  readonly customerId: CustomerId;
  readonly name: string;
  readonly accountNumber: string;
  readonly bankCode: string;
  readonly currency: string;
}

export interface EnqueueNotificationInput {
  readonly customerId: CustomerId;
  readonly transactionId: TransactionId | null;
  readonly type: NotificationType;
  readonly payload: Record<string, unknown>;
}

export interface RecordAuditInput {
  readonly actorId: CustomerId | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly requestId: string | null;
  readonly ip: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly customerId: CustomerId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedById: string | null;
}

export interface CreateRefreshTokenInput {
  readonly customerId: CustomerId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface CustomerRepository {
  findById(id: CustomerId): Promise<CustomerRecord | null>;
  findByIdForUpdate(id: CustomerId): Promise<CustomerRecord | null>;
  findByEmail(email: string): Promise<CustomerRecord | null>;
  create(input: CreateCustomerInput): Promise<CustomerRecord>;
  updatePassword(id: CustomerId, passwordHash: string): Promise<void>;
  recordSuccessfulLogin(id: CustomerId): Promise<void>;
  recordFailedLogin(
    id: CustomerId,
    maxAttempts: number,
    lockoutSeconds: number,
  ): Promise<{ attempts: number; lockedUntil: Date | null }>;
  setStatus(id: CustomerId, status: Customer['status']): Promise<void>;
  list(query: ListCustomersQuery): Promise<{ items: CustomerRecord[]; total: number }>;
}

export interface LedgerAccountRepository {
  create(input: CreateLedgerAccountInput): Promise<LedgerAccountRecord>;
  findById(id: LedgerAccountId): Promise<LedgerAccountRecord | null>;
  findByIdForUpdate(id: LedgerAccountId): Promise<LedgerAccountRecord | null>;
  findByCode(code: string): Promise<LedgerAccountRecord | null>;
  listSystem(): Promise<LedgerAccountRecord[]>;
}

export interface AccountRepository {
  create(input: CreateAccountInput): Promise<Account>;
  findById(id: AccountId): Promise<Account | null>;
  findByAccountNumber(accountNumber: string): Promise<Account | null>;
  listByCustomer(customerId: CustomerId): Promise<Account[]>;
  /** Resolve the customer accounts backing a set of ledger accounts. */
  findByLedgerAccountIds(ids: readonly LedgerAccountId[]): Promise<Account[]>;
  /**
   * Lock the given accounts for update, acquiring locks in a deterministic
   * (sorted) order to avoid deadlocks. Returns the locked rows.
   */
  lockByIds(ids: readonly AccountId[]): Promise<Account[]>;
  /** Apply a signed delta to the cached balance and return the new value. */
  applyBalanceDelta(id: AccountId, deltaMinor: bigint): Promise<bigint>;
  /** Accounts whose cached balance disagrees with the ledger (should be empty). */
  findBalanceMismatches(limit: number): Promise<BalanceMismatch[]>;
  /** Ledger-derived balance of a single ledger account. */
  ledgerBalanceOf(ledgerAccountId: LedgerAccountId): Promise<bigint>;
  setStatus(id: AccountId, status: AccountStatus): Promise<void>;
  countByCustomer(customerId: CustomerId): Promise<number>;
}

export interface BalanceMismatch {
  readonly accountId: AccountId;
  readonly cachedBalanceMinor: bigint;
  readonly ledgerBalanceMinor: bigint;
}

export interface RecentActivity {
  readonly txnsLastMinute: number;
  readonly debitsLastDayMinor: bigint;
}

export interface CreateTransferDetailInput {
  readonly transactionId: TransactionId;
  readonly fromAccountId: AccountId;
  readonly toAccountId: AccountId;
  readonly amountMinor: bigint;
  readonly feeMinor: bigint;
  readonly currency: string;
  readonly note: string | null;
}

export interface TransferRepository {
  create(input: CreateTransferDetailInput): Promise<void>;
}

export interface TransactionRepository {
  insertHeader(input: InsertTransactionInput): Promise<TransactionHeader>;
  insertEntries(
    transactionId: TransactionId,
    currency: string,
    postings: readonly PostingSpec[],
  ): Promise<void>;
  findById(id: TransactionId): Promise<TransactionHeader | null>;
  getPostings(transactionId: TransactionId): Promise<PostingSpec[]>;
  hasReversalOf(transactionId: TransactionId): Promise<boolean>;
  listStatement(query: StatementQuery): Promise<StatementRow[]>;
  recentActivity(
    ledgerAccountId: LedgerAccountId,
    minuteSince: Date,
    daySince: Date,
  ): Promise<RecentActivity>;
  /** Global double-entry totals; debits must always equal credits. */
  ledgerTotals(): Promise<{ debitMinor: bigint; creditMinor: bigint }>;
}

// ---------------------------------------------------------------------------
// Risk / fraud
// ---------------------------------------------------------------------------

export interface RiskContext {
  readonly customerId: CustomerId;
  readonly type: TransactionType;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly txnsLastMinute: number;
  readonly debitsLastDayMinor: bigint;
}

export interface RiskDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface RiskEngine {
  assess(context: RiskContext): RiskDecision;
}

export interface IdempotencyRepository {
  reserve(input: CreateIdempotencyInput): Promise<ReserveIdempotencyResult>;
  findByKey(
    customerId: CustomerId,
    endpoint: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  complete(input: CompleteIdempotencyInput): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface BeneficiaryRepository {
  create(input: CreateBeneficiaryInput): Promise<Beneficiary>;
  listByCustomer(customerId: CustomerId): Promise<Beneficiary[]>;
  findByIdForCustomer(id: BeneficiaryId, customerId: CustomerId): Promise<Beneficiary | null>;
  archive(id: BeneficiaryId, customerId: CustomerId): Promise<boolean>;
}

export interface NotificationRepository {
  enqueue(input: EnqueueNotificationInput): Promise<void>;
}

export interface AuditRepository {
  record(input: RecordAuditInput): Promise<void>;
}

export interface RefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string): Promise<void>;
  revokeWithReplacement(id: string, replacedById: string): Promise<void>;
  revokeAllForCustomer(customerId: CustomerId): Promise<void>;
}

// ---------------------------------------------------------------------------
// Transactional repository bundle + unit of work
// ---------------------------------------------------------------------------

export interface Repositories {
  readonly customers: CustomerRepository;
  readonly ledgerAccounts: LedgerAccountRepository;
  readonly accounts: AccountRepository;
  readonly transactions: TransactionRepository;
  readonly transfers: TransferRepository;
  readonly idempotency: IdempotencyRepository;
  readonly beneficiaries: BeneficiaryRepository;
  readonly notifications: NotificationRepository;
  readonly audit: AuditRepository;
  readonly refreshTokens: RefreshTokenRepository;
}

export interface UnitOfWork {
  /**
   * Run `work` inside a single database transaction. The repositories passed in
   * are bound to that transaction. Retries transient serialization/deadlock
   * failures (the whole transaction rolled back, so retrying is safe).
   */
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
