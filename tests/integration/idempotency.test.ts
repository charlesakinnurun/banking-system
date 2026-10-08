import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, type TestApp } from '../helpers/app.js';
import {
  deposit,
  idempotencyKey,
  openAccount,
  registerCustomer,
  safeJson,
} from '../helpers/api.js';

let h: TestApp;

beforeAll(async () => {
  h = await createTestApp(process.env.TEST_DATABASE_URL!);
});
afterAll(async () => {
  await closeTestApp(h);
});

async function balance(app: TestApp, token: string, accountId: string): Promise<string> {
  const res = await app.app.inject({
    method: 'GET',
    url: `/v1/accounts/${accountId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return res.json().balance.amountMinor as string;
}

describe('HTTP idempotency', () => {
  it('replays the stored response for a repeated key and does not move money twice', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    const key = idempotencyKey();

    const first = await deposit(h.app, customer.token, account.id, '10000', 'USD', key);
    const second = await deposit(h.app, customer.token, account.id, '10000', 'USD', key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstTx = (first.body as { transaction: { id: string } }).transaction.id;
    const secondTx = (second.body as { transaction: { id: string } }).transaction.id;
    expect(secondTx).toBe(firstTx);
    expect(await balance(h, customer.token, account.id)).toBe('10000');
  });

  it('rejects reuse of a key with a different payload', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    const key = idempotencyKey();

    await deposit(h.app, customer.token, account.id, '10000', 'USD', key);
    const conflict = await deposit(h.app, customer.token, account.id, '99999', 'USD', key);

    expect(conflict.statusCode).toBe(422);
    expect((safeJson(conflict.raw) as { error: { code: string } }).error.code).toBe(
      'idempotency_key_reuse',
    );
    expect(await balance(h, customer.token, account.id)).toBe('10000');
  });

  it('moves money exactly once under concurrent duplicate requests', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    const key = idempotencyKey();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        deposit(h.app, customer.token, account.id, '5000', 'USD', key),
      ),
    );

    const created = results.filter((r) => r.statusCode === 201);
    // Every response must be a 201 (either the original or a replay of it);
    // some may be 409 if they collided while the first was still committing.
    expect(results.every((r) => r.statusCode === 201 || r.statusCode === 409)).toBe(true);
    expect(created.length).toBeGreaterThanOrEqual(1);
    // Exactly one 5000 deposit landed, no matter how many requests were sent.
    expect(await balance(h, customer.token, account.id)).toBe('5000');
  });
});
