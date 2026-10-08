import { startTestDatabase, stopTestDatabase } from './helpers/db.js';

/**
 * Vitest global setup: boots one ephemeral PostgreSQL for the whole run, runs
 * migrations, and exposes the connection string to test workers via
 * `TEST_DATABASE_URL`.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const connectionString = await startTestDatabase();
  process.env.TEST_DATABASE_URL = connectionString;
  return async () => {
    await stopTestDatabase();
  };
}
