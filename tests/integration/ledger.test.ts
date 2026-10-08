import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, type TestApp } from '../helpers/app.js';
import {
  deposit,
  idempotencyKey,
  openAccount,
  registerCustomer,
  safeJson,
} from '../helpers/api.js';
import type { FastifyInstance } from 'fastify';

let h: TestApp;

beforeAll(async () => {
  h = await createTestApp(process.env.TEST_DATABASE_URL!);
});
afterAll(async () => {
  await closeTestApp(h);
});

async function balanceOf(app: FastifyInstance, token: string, accountId: string): Promise<bigint> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/accounts/${accountId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return BigInt(res.json().balance.amountMinor);
}

async function withdraw(
  app: FastifyInstance,
  token: string,
  accountId: string,
  amountMinor: string,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/transactions/withdraw',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey() },
    payload: { accountId, amountMinor, currency: 'USD' },
  });
}

async function transfer(
  app: FastifyInstance,
  token: string,
  fromAccountId: string,
  toAccountNumber: string,
  amountMinor: string,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/transfers',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey() },
    payload: { fromAccountId, toAccountNumber, amountMinor, currency: 'USD' },
  });
}

describe('ledger integration', () => {
  it('deposit, withdraw and transfer keep balances and the ledger consistent', async () => {
    const alice = await registerCustomer(h.app);
    const bob = await registerCustomer(h.app);
    const aliceAccount = await openAccount(h.app, alice.token);
    const bobAccount = await openAccount(h.app, bob.token);

    const dep = await deposit(
      h.app,
      alice.token,
      aliceAccount.id,
      '100000',
      'USD',
      idempotencyKey(),
    );
    expect(dep.statusCode).toBe(201);
    expect(await balanceOf(h.app, alice.token, aliceAccount.id)).toBe(100_000n);

    const wd = await withdraw(h.app, alice.token, aliceAccount.id, '40000');
    expect(wd.statusCode).toBe(201);
    expect(await balanceOf(h.app, alice.token, aliceAccount.id)).toBe(60_000n);

    const tx = await transfer(
      h.app,
      alice.token,
      aliceAccount.id,
      bobAccount.accountNumber,
      '25000',
    );
    expect(tx.statusCode).toBe(201);
    expect(await balanceOf(h.app, alice.token, aliceAccount.id)).toBe(35_000n);
    expect(await balanceOf(h.app, bob.token, bobAccount.id)).toBe(25_000n);

    // The two legs of the transfer are a single balanced transaction.
    const reconciliation = await h.container.deps.uow.run((repos) =>
      repos.transactions.ledgerTotals(),
    );
    expect(reconciliation.debitMinor).toBe(reconciliation.creditMinor);
  });

  it('rejects a withdrawal that would overdraw a non-overdraft account', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    await deposit(h.app, customer.token, account.id, '1000', 'USD', idempotencyKey());

    const res = await withdraw(h.app, customer.token, account.id, '2000');
    expect(res.statusCode).toBe(409);
    expect((safeJson(res.body) as { error: { code: string } }).error.code).toBe(
      'insufficient_funds',
    );
    expect(await balanceOf(h.app, customer.token, account.id)).toBe(1000n);
  });

  it('rejects a currency mismatch', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token, 'USD');
    const res = await deposit(h.app, customer.token, account.id, '1000', 'EUR', idempotencyKey());
    expect(res.statusCode).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('currency_mismatch');
  });

  it('rejects a transfer to the same account', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    await deposit(h.app, customer.token, account.id, '1000', 'USD', idempotencyKey());
    const res = await transfer(h.app, customer.token, account.id, account.accountNumber, '100');
    expect(res.statusCode).toBe(400);
  });

  it('reports no balance drift in reconciliation after activity', async () => {
    const result = await h.container.deps.uow.run((repos) =>
      h.container.deps.services.reconciliation.overall(repos),
    );
    expect(result.balanced).toBe(true);
    expect(result.mismatchedAccounts).toEqual([]);
  });

  it('produces a statement whose opening + movement equals closing', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    await deposit(h.app, customer.token, account.id, '5000', 'USD', idempotencyKey());
    await deposit(h.app, customer.token, account.id, '2500', 'USD', idempotencyKey());

    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/accounts/${account.id}/statement`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.openingBalance.amountMinor).toBe('0');
    expect(body.closingBalance.amountMinor).toBe('7500');
    expect(body.entries.length).toBe(2);
  });
});
