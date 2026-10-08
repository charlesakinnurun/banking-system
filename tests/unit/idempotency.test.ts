import { describe, expect, it } from 'vitest';
import { IdempotencyInProgressError, IdempotencyKeyReuseError } from '../../src/domain/errors.js';
import { runIdempotent, type IdempotentExecution } from '../../src/application/idempotency.js';
import { requestFingerprint } from '../../src/shared/hash.js';
import type {
  CompleteIdempotencyInput,
  CreateIdempotencyInput,
  IdempotencyRecord,
  IdempotencyRepository,
  Repositories,
  ReserveIdempotencyResult,
} from '../../src/application/ports.js';

/** Minimal in-memory idempotency store that mirrors the SQL semantics. */
class FakeIdempotencyRepository implements IdempotencyRepository {
  private readonly byId = new Map<string, IdempotencyRecord>();
  private readonly keyToId = new Map<string, string>();
  private counter = 0;

  async reserve(input: CreateIdempotencyInput): Promise<ReserveIdempotencyResult> {
    const composite = `${input.customerId}|${input.endpoint}|${input.key}`;
    const existingId = this.keyToId.get(composite);
    const existing = existingId ? this.byId.get(existingId) : undefined;

    if (existing && existing.expiresAt.getTime() > Date.now()) {
      return { reserved: false, record: existing };
    }

    this.counter += 1;
    const id = `idem-${this.counter}`;
    const record: IdempotencyRecord = {
      id,
      status: 'in_progress',
      requestHash: input.requestHash,
      responseStatus: null,
      responseBody: null,
      transactionId: null,
      expiresAt: new Date(Date.now() + input.ttlHours * 3_600_000),
      updatedAt: new Date(),
    };
    this.byId.set(id, record);
    this.keyToId.set(composite, id);
    return { reserved: true, record };
  }

  async findByKey(
    customerId: string,
    endpoint: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const id = this.keyToId.get(`${customerId}|${endpoint}|${key}`);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async complete(input: CompleteIdempotencyInput): Promise<void> {
    const record = this.byId.get(input.id);
    if (!record) throw new Error('unknown idempotency id');
    this.byId.set(input.id, {
      ...record,
      status: 'completed',
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      transactionId: input.transactionId,
      updatedAt: new Date(),
    });
  }

  async deleteExpired(): Promise<number> {
    return 0;
  }
}

function harness() {
  const fake = new FakeIdempotencyRepository();
  const repos = { idempotency: fake } as unknown as Repositories;
  let workCalls = 0;
  const execution: Omit<IdempotentExecution, 'requestBody'> = {
    repos,
    customerId: 'customer-1',
    endpoint: 'POST /v1/transfers',
    idempotencyKey: 'idem-key-00000001',
    ttlHours: 24,
  };
  const work = async () => {
    workCalls += 1;
    return { response: { statusCode: 201, body: { reference: 'TXN-1' } }, transactionId: 'txn-1' };
  };
  return {
    fake,
    execution,
    work,
    get workCalls() {
      return workCalls;
    },
  };
}

describe('runIdempotent', () => {
  it('runs the work once and replays the stored response afterwards', async () => {
    const h = harness();
    const first = await runIdempotent(
      { ...h.execution, requestBody: { amountMinor: '100' } },
      h.work,
    );
    expect(h.workCalls).toBe(1);
    expect(first).toEqual({ statusCode: 201, body: { reference: 'TXN-1' } });

    const second = await runIdempotent(
      { ...h.execution, requestBody: { amountMinor: '100' } },
      h.work,
    );
    expect(h.workCalls).toBe(1); // NOT executed again — no money moved twice
    expect(second).toEqual(first);
  });

  it('rejects reuse of a key with a different request payload', async () => {
    const h = harness();
    await runIdempotent({ ...h.execution, requestBody: { amountMinor: '100' } }, h.work);
    await expect(
      runIdempotent({ ...h.execution, requestBody: { amountMinor: '999' } }, h.work),
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });

  it('reports a concurrent in-progress duplicate rather than double-executing', async () => {
    const h = harness();
    const body = { amountMinor: '100' };
    // Simulate another in-flight request (same body) that has claimed the key
    // but not yet finished.
    await h.fake.reserve({
      customerId: 'customer-1',
      endpoint: 'POST /v1/transfers',
      key: 'idem-key-00000001',
      requestHash: requestFingerprint('POST /v1/transfers', body),
      ttlHours: 24,
    });
    await expect(
      runIdempotent({ ...h.execution, requestBody: body }, h.work),
    ).rejects.toBeInstanceOf(IdempotencyInProgressError);
    expect(h.workCalls).toBe(0);
  });
});
