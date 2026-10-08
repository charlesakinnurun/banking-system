import { IdempotencyInProgressError, IdempotencyKeyReuseError } from '../domain/errors.js';
import { requestFingerprint } from '../shared/hash.js';
import type { Repositories } from './ports.js';
import type { CustomerId, TransactionId } from '../domain/enums.js';

export interface StoredResponse {
  readonly statusCode: number;
  readonly body: unknown;
}

export interface IdempotentExecution {
  readonly repos: Repositories;
  readonly customerId: CustomerId;
  /** Stable endpoint identity, e.g. 'POST /v1/transfers'. */
  readonly endpoint: string;
  readonly idempotencyKey: string;
  /** The validated request payload; fingerprinted for replay safety. */
  readonly requestBody: unknown;
  readonly ttlHours: number;
}

export interface IdempotentOutcome {
  readonly response: StoredResponse;
  readonly transactionId: TransactionId | null;
}

/**
 * Execute `work` exactly once for a given (customer, endpoint, key).
 *
 * MUST be called inside a single unit of work so the idempotency record commits
 * atomically with the money movement. Behaviour:
 *   - fresh key                -> run work, store response+transactionId, return it
 *   - completed + same request -> replay the stored response (money does NOT move)
 *   - completed + diff request -> 422 idempotency_key_reuse
 *   - in_progress (live)       -> 409 (a concurrent duplicate is holding it)
 */
export async function runIdempotent(
  ctx: IdempotentExecution,
  work: () => Promise<IdempotentOutcome>,
): Promise<StoredResponse> {
  const fingerprint = requestFingerprint(ctx.endpoint, ctx.requestBody);
  const reservation = await ctx.repos.idempotency.reserve({
    customerId: ctx.customerId,
    endpoint: ctx.endpoint,
    key: ctx.idempotencyKey,
    requestHash: fingerprint,
    ttlHours: ctx.ttlHours,
  });

  if (!reservation.reserved) {
    const existing = reservation.record;
    if (existing.requestHash !== fingerprint) {
      throw new IdempotencyKeyReuseError();
    }
    if (existing.status === 'completed' && existing.responseStatus !== null) {
      return { statusCode: existing.responseStatus, body: existing.responseBody };
    }
    // A live in-progress key means another request is still running. Its
    // transaction holds the row lock, so reaching here means it is mid-flight.
    throw new IdempotencyInProgressError();
  }

  const outcome = await work();
  await ctx.repos.idempotency.complete({
    id: reservation.record.id,
    responseStatus: outcome.response.statusCode,
    responseBody: outcome.response.body,
    transactionId: outcome.transactionId,
  });
  return outcome.response;
}
