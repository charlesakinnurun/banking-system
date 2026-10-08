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

describe('database-enforced ledger invariants', () => {
  it('refuses to update a posted ledger entry', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    await deposit(h.app, customer.token, account.id, '1000', 'USD', idempotencyKey());

    await expect(
      h.container.pool.query(`UPDATE ledger_entries SET amount_minor = amount_minor + 1`),
    ).rejects.toThrow(/immutable/i);
  });

  it('refuses to delete a posted transaction', async () => {
    const customer = await registerCustomer(h.app);
    const account = await openAccount(h.app, customer.token);
    await deposit(h.app, customer.token, account.id, '1000', 'USD', idempotencyKey());

    await expect(h.container.pool.query(`DELETE FROM transactions`)).rejects.toThrow(/immutable/i);
  });

  it('refuses to commit an unbalanced transaction', async () => {
    // A brand-new transaction with a single, one-sided debit must not commit:
    // the deferred constraint trigger rejects it at COMMIT.
    await expect(
      h.container.pool.query(
        `WITH c AS (SELECT id FROM customers LIMIT 1),
              la AS (SELECT id FROM ledger_accounts LIMIT 1),
              t AS (
                INSERT INTO transactions (reference, type, currency, amount_minor, initiated_by)
                SELECT 'UNBALANCED-' || gen_random_uuid()::text, 'deposit', 'USD', 100, c.id FROM c
                RETURNING id
              )
         INSERT INTO ledger_entries (transaction_id, ledger_account_id, direction, amount_minor, currency)
         SELECT t.id, la.id, 'debit', 100, 'USD' FROM t, la`,
      ),
    ).rejects.toThrow(/not balanced/i);
  });

  it('has no unbalanced transactions and globally balanced totals', async () => {
    const unbalanced = await h.container.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM (
         SELECT transaction_id
           FROM ledger_entries
          GROUP BY transaction_id
         HAVING COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)
              <> COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)
       ) AS t`,
    );
    expect(unbalanced.rows[0]!.count).toBe('0');

    const totals = await h.container.deps.uow.run((repos) => repos.transactions.ledgerTotals());
    expect(totals.debitMinor).toBe(totals.creditMinor);
  });

  it('keeps every cached balance equal to its ledger-derived balance', async () => {
    const result = await h.container.deps.uow.run((repos) =>
      h.container.deps.services.reconciliation.overall(repos),
    );
    expect(result.mismatchedAccounts).toEqual([]);
  });
});
