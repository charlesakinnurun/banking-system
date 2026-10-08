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

describe('security boundaries', () => {
  it('rejects unauthenticated access to protected routes', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it("prevents a customer from reading another customer's account", async () => {
    const alice = await registerCustomer(h.app);
    const bob = await registerCustomer(h.app);
    const aliceAccount = await openAccount(h.app, alice.token);

    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/accounts/${aliceAccount.id}`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    // 404 (not 403) so account existence is not disclosed.
    expect(res.statusCode).toBe(404);
  });

  it('prevents a customer from performing administrative actions', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/admin/accounts/${account.id}/freeze`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects spoofed and malformed authorization headers', async () => {
    const customer = await registerCustomer(h.app);
    const tampered = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${customer.token}tampered` },
    });
    expect(tampered.statusCode).toBe(401);
  });

  it('validates input and rejects unknown currencies', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    const res = await deposit(h.app, customer.token, account.id, '1000', 'ZZZ', idempotencyKey());
    expect(res.statusCode).toBe(400);
  });

  it('requires an Idempotency-Key on money movement', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/transactions/deposit',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { accountId: account.id, amountMinor: '1000', currency: 'USD' },
    });
    expect(res.statusCode).toBe(400);
    expect((safeJson(res.body) as { error: { code: string } }).error.code).toBe(
      'idempotency_key_required',
    );
  });

  it('is resilient to SQL-injection-shaped email input (no 500)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: "x' OR '1'='1@example.com", password: 'Whatever-123!' },
    });
    // Either a validation 400 or a uniform 401 — never a 500 / DB error leak.
    expect([400, 401]).toContain(res.statusCode);
  });

  it('sets standard security headers and rate-limit headers', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit']).toBeTruthy();
  });

  it('does not leak internal error details on unexpected failures', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/transactions/not-a-uuid' });
    expect([400, 401]).toContain(res.statusCode);
    const body = safeJson(res.body) as { error?: { message?: string } };
    expect(body.error?.message ?? '').not.toMatch(/stack|pg|postgres|at Object/i);
  });
});
