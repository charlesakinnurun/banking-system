import { loadConfig } from '../config/env.js';
import { pendingMigrations, runMigrations } from '../infrastructure/db/migrator.js';

/**
 * Migration CLI.
 *   tsx src/cli/migrate.ts            apply all pending migrations
 *   tsx src/cli/migrate.ts --status   list pending migrations without applying
 */
async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');
  const config = loadConfig();

  if (statusOnly) {
    const pending = await pendingMigrations(config.databaseUrl);
    if (pending.length === 0) {
      process.stdout.write('No pending migrations.\n');
      return;
    }
    for (const file of pending) process.stdout.write(`! ${file} (pending)\n`);
    process.stdout.write(`\n${pending.length} migration(s) pending.\n`);
    return;
  }

  const result = await runMigrations(config.databaseUrl);
  for (const file of result.alreadyApplied) process.stdout.write(`= ${file} (already applied)\n`);
  for (const file of result.applied) process.stdout.write(`+ applied ${file}\n`);
  process.stdout.write(`\nMigrations up to date (${result.applied.length} applied).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Migration failed: ${String(error)}\n`);
  process.exit(1);
});
