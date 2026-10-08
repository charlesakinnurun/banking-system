export interface PgErrorLike {
  readonly code?: string;
  readonly constraint?: string;
  readonly detail?: string;
}

export function asPgError(error: unknown): PgErrorLike {
  if (typeof error === 'object' && error !== null) return error;
  return {};
}

export function pgErrorCode(error: unknown): string | undefined {
  return asPgError(error).code;
}

/** Postgres class 40: transaction rollback due to serialization failure / deadlock. */
export function isRetryableTransactionError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === '40001' || code === '40P01';
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = asPgError(error);
  if (e.code !== '23505') return false;
  return constraint === undefined || e.constraint === constraint;
}

export function isCheckViolation(error: unknown, constraint?: string): boolean {
  const e = asPgError(error);
  if (e.code !== '23514') return false;
  return constraint === undefined || e.constraint === constraint;
}

export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  const e = asPgError(error);
  if (e.code !== '23503') return false;
  return constraint === undefined || e.constraint === constraint;
}

/** Raised by our `forbid_mutation()` trigger on immutable tables. */
export function isImmutableViolation(error: unknown): boolean {
  return (
    pgErrorCode(error) === '23000' ||
    pgErrorCode(error) === '2F004' ||
    pgErrorCode(error) === 'P0001'
  );
}
