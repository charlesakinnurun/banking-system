import { loadConfig } from '../config/env.js';
import { buildContainer } from '../container.js';
import {
  customerLedgerCode,
  settlementAccountCode,
  feeRevenueAccountCode,
} from '../application/system-accounts.js';

const SEED_CURRENCIES = ['USD', 'NGN', 'EUR'] as const;
const DEMO_PASSWORD = 'Demo-Password-123!';

async function main(): Promise<void> {
  const config = loadConfig();
  const container = buildContainer(config);
  const { deps } = container;
  const { uow, services, hasher } = deps;

  // 1. System (chart-of-accounts) ledger accounts, idempotent.
  await uow.run(async (repos) => {
    for (const currency of SEED_CURRENCIES) {
      const cashCode = settlementAccountCode(currency);
      if (!(await repos.ledgerAccounts.findByCode(cashCode))) {
        await repos.ledgerAccounts.create({
          code: cashCode,
          name: `Cash & settlement (${currency})`,
          type: 'asset',
          currency,
          isSystem: true,
        });
      }
      const feeCode = feeRevenueAccountCode(currency);
      if (!(await repos.ledgerAccounts.findByCode(feeCode))) {
        await repos.ledgerAccounts.create({
          code: feeCode,
          name: `Fee revenue (${currency})`,
          type: 'revenue',
          currency,
          isSystem: true,
        });
      }
    }
  });
  process.stdout.write('System ledger accounts ensured.\n');

  // 2. Bootstrap administrator.
  const admin = await uow.run(async (repos) => {
    const existing = await repos.customers.findByEmail(config.seed.adminEmail);
    if (existing) return existing;
    return repos.customers.create({
      email: config.seed.adminEmail,
      fullName: 'Platform Administrator',
      passwordHash: await hasher.hash(config.seed.adminPassword),
      role: 'admin',
    });
  });
  process.stdout.write(`Admin ready: ${admin.email}\n`);

  if (!config.seed.demoData) {
    process.stdout.write('Demo data disabled (SEED_DEMO_DATA=false).\n');
    await container.shutdown();
    return;
  }

  // 3. Demo customers + accounts + opening deposits.
  const ensureCustomer = async (email: string, fullName: string) =>
    uow.run(async (repos) => {
      const existing = await repos.customers.findByEmail(email);
      if (existing) return existing;
      return repos.customers.create({
        email,
        fullName,
        passwordHash: await hasher.hash(DEMO_PASSWORD),
        role: 'customer',
      });
    });

  const alice = await ensureCustomer('alice@example.com', 'Alice Doe');
  const bob = await ensureCustomer('bob@example.com', 'Bob Smith');

  const ensureAccount = async (customerId: string, currency: string) => {
    const existing = await uow.run((repos) => repos.accounts.listByCustomer(customerId));
    return (
      existing[0] ??
      uow.run((repos) =>
        services.accounts.create(
          repos,
          { id: customerId, role: 'admin' },
          { type: 'checking', currency, customerId },
        ),
      )
    );
  };

  const aliceAccount = await ensureAccount(alice.id, 'USD');
  const bobAccount = await ensureAccount(bob.id, 'USD');

  const openingDeposit = async (
    customerId: string,
    accountId: string,
    amountMinor: bigint,
    currency: string,
  ) => {
    await uow.run(async (repos) => {
      const account = await repos.accounts.findById(accountId);
      if (!account || account.cachedBalanceMinor !== 0n) return; // already funded
      await services.ledger.deposit(
        repos,
        { id: customerId, role: 'admin' },
        {
          accountId,
          amountMinor,
          currency,
          description: 'Opening deposit (seed)',
        },
      );
    });
  };

  await openingDeposit(alice.id, aliceAccount.id, 100_000n, 'USD');
  await openingDeposit(bob.id, bobAccount.id, 50_000n, 'USD');

  process.stdout.write(
    [
      'Demo data ready:',
      `  admin  ${config.seed.adminEmail} / ${config.seed.adminPassword}`,
      `  alice@example.com / ${DEMO_PASSWORD}  account ${aliceAccount.accountNumber}`,
      `  bob@example.com   / ${DEMO_PASSWORD}  account ${bobAccount.accountNumber}`,
      `  (customer ledger account code example: ${customerLedgerCode(aliceAccount.accountNumber)})`,
      '',
    ].join('\n'),
  );

  await container.shutdown();
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${String(error)}\n`);
  process.exit(1);
});
