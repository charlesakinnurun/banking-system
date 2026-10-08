/**
 * Error model.
 *
 * Domain and application code throw typed `AppError`s carrying a stable
 * machine-readable `code`. Only the HTTP layer knows how to turn these into
 * status codes and wire responses (see `src/http/plugins/error-handler.ts`).
 *
 * Operational errors (the default) are safe to surface to clients. Any error
 * that is NOT an `AppError` is treated as a bug: it is logged with full detail
 * and reported to the client as a generic 500 that leaks nothing.
 */

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'idempotency_key_reuse'
  | 'idempotency_in_progress'
  | 'idempotency_key_required'
  | 'insufficient_funds'
  | 'account_frozen'
  | 'account_closed'
  | 'currency_mismatch'
  | 'risk_rejected'
  | 'rate_limited'
  | 'unbalanced_transaction'
  | 'immutable_record'
  | 'service_unavailable'
  | 'internal_error';

export interface AppErrorOptions {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Readonly<Record<string, unknown>>;
  /** Operational errors are expected, mapped, and safe to expose to clients. */
  readonly isOperational: boolean = true;

  constructor(message: string, options: AppErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: Record<string, unknown>) {
    super(message, { code: 'validation_error', httpStatus: 400, ...(details ? { details } : {}) });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { code: 'unauthorized', httpStatus: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, { code: 'forbidden', httpStatus: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, { code: 'not_found', httpStatus: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state of the resource') {
    super(message, { code: 'conflict', httpStatus: 409 });
  }
}

export class IdempotencyKeyReuseError extends AppError {
  constructor() {
    super('Idempotency-Key was reused with a different request payload', {
      code: 'idempotency_key_reuse',
      httpStatus: 422,
    });
  }
}

export class IdempotencyInProgressError extends AppError {
  constructor() {
    super('A request with this Idempotency-Key is currently in progress', {
      code: 'idempotency_in_progress',
      httpStatus: 409,
    });
  }
}

export class IdempotencyKeyRequiredError extends AppError {
  constructor() {
    super('This endpoint requires an Idempotency-Key header', {
      code: 'idempotency_key_required',
      httpStatus: 400,
    });
  }
}

export class InsufficientFundsError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super('Insufficient funds', {
      code: 'insufficient_funds',
      httpStatus: 409,
      ...(details ? { details } : {}),
    });
  }
}

export class AccountFrozenError extends AppError {
  constructor() {
    super('Account is frozen', { code: 'account_frozen', httpStatus: 422 });
  }
}

export class AccountClosedError extends AppError {
  constructor() {
    super('Account is closed', { code: 'account_closed', httpStatus: 422 });
  }
}

export class CurrencyMismatchError extends AppError {
  constructor(from: string, to: string) {
    super(`Currency mismatch: ${from} -> ${to}`, {
      code: 'currency_mismatch',
      httpStatus: 422,
      details: { from, to },
    });
  }
}

export class RiskRejectedError extends AppError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super(`Transaction rejected by risk controls: ${reason}`, {
      code: 'risk_rejected',
      httpStatus: 422,
      ...(details ? { details } : {}),
    });
  }
}

export class RateLimitedError extends AppError {
  constructor() {
    super('Too many requests', { code: 'rate_limited', httpStatus: 429 });
  }
}

export class UnbalancedTransactionError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super('Ledger transaction is not balanced: total debits must equal total credits', {
      code: 'unbalanced_transaction',
      httpStatus: 500,
      ...(details ? { details } : {}),
    });
  }
}

export class ImmutableRecordError extends AppError {
  constructor(message = 'Posted ledger records are immutable') {
    super(message, { code: 'immutable_record', httpStatus: 409 });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, { code: 'service_unavailable', httpStatus: 503 });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
