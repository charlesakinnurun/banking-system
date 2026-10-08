import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import { runMigrations } from '../../src/infrastructure/db/migrator.js';

/**
 * Integration tests run against a REAL PostgreSQL, not a mock — locking,
 * constraints, triggers, and transaction semantics are exactly what these tests
 * exist to verify, and a mock would validate none of it.
 *
 * Priority order:
 *   1. TEST_DATABASE_URL (CI service container, or a local Postgres)
 *   2. an ephemeral embedded PostgreSQL (default for local dev)
 */
let embedded: EmbeddedPostgres | null = null;

export async function startTestDatabase(): Promise<string> {
  if (process.env.TEST_DATABASE_URL) {
    const url = process.env.TEST_DATABASE_URL;
    await runMigrations(url);
    return url;
  }

  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const databaseDir = path.join(os.tmpdir(), `banking-pg-${randomUUID()}`);

  embedded = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // Match production (UTF-8, deterministic collation) and keep test output clean.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });
  await embedded.initialise();
  await embedded.start();

  const admin = embedded.getPgClient();
  await admin.connect();
  await admin.query('CREATE DATABASE banking_test');
  await admin.end();

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/banking_test`;
  await runMigrations(connectionString);
  return connectionString;
}

export async function stopTestDatabase(): Promise<void> {
  if (embedded) {
    try {
      await embedded.stop();
    } catch {
      // best effort during teardown
    }
    embedded = null;
  }
}
