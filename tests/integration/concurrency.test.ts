import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, type TestApp } from '../helpers/app.js';
import { deposit, idempotencyKey, openAccount, registerCustomer } from '../helpers/api.js';

let h: TestApp;

beforeAll(async () => {
  h = await createTestApp(process.env.TEST_DATABASE_URL!);
});
afterAll(async () => {
  await closeTestApp(h);
});

describe('concurrency safety', () => {
  it('serialises concurrent withdrawals and never lets the balance go negative', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    await deposit(h.app, customer.token, account.id, '100000', 'USD', idempotencyKey());

    // 12 withdrawals of 30,000 against a 100,000 balance: exactly 3 can succeed.
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        h.app.inject({
          method: 'POST',
          url: '/v1/transactions/withdraw',
          headers: {
            authorization: `Bearer ${customer.token}`,
            'idempotency-key': idempotencyKey(),
          },
          payload: { accountId: account.id, amountMinor: '30000', currency: 'USD' },
        }),
      ),
    );

    const successes = results.filter((r) => r.statusCode === 201).length;
    const conflicts = results.filter((r) => r.statusCode === 409).length;
    expect(successes).toBe(3);
    expect(conflicts).toBe(9);

    const balance = await h.app.inject({
      method: 'GET',
      url: `/v1/accounts/${account.id}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(balance.json().balance.amountMinor).toBe('10000');
  });

  it('conserves total money across many concurrent mutual transfers', async () => {
    const a = await registerCustomer(h.app);
    const b = await registerCustomer(h.app);
    const accountA = await openAccount(h.app, a.token);
    const accountB = await openAccount(h.app, b.token);
    await deposit(h.app, a.token, accountA.id, '50000', 'USD', idempotencyKey());
    await deposit(h.app, b.token, accountB.id, '50000', 'USD', idempotencyKey());

    const transfers = Array.from({ length: 20 }, (_unused, index) => {
      const forward = index % 2 === 0;
      return h.app.inject({
        method: 'POST',
        url: '/v1/transfers',
        headers: {
          authorization: `Bearer ${forward ? a.token : b.token}`,
          'idempotency-key': idempotencyKey(),
        },
        payload: {
          fromAccountId: forward ? accountA.id : accountB.id,
          toAccountNumber: forward ? accountB.accountNumber : accountA.accountNumber,
          amountMinor: '1000',
          currency: 'USD',
        },
      });
    });
    const results = await Promise.all(transfers);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);

    const balA = await h.app.inject({
      method: 'GET',
      url: `/v1/accounts/${accountA.id}`,
      headers: { authorization: `Bearer ${a.token}` },
    });
    const balB = await h.app.inject({
      method: 'GET',
      url: `/v1/accounts/${accountB.id}`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    // 20 transfers of 1000 alternate, so both directions cancel out exactly.
    expect(BigInt(balA.json().balance.amountMinor) + BigInt(balB.json().balance.amountMinor)).toBe(
      100_000n,
    );

    const reconciliation = await h.container.deps.uow.run((repos) =>
      h.container.deps.services.reconciliation.overall(repos),
    );
    expect(reconciliation.balanced).toBe(true);
    expect(reconciliation.mismatchedAccounts).toEqual([]);
  });
});
