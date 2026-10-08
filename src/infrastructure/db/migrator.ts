import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Forward-only migration engine. Each `.sql` file is applied once, in filename
 * order, inside its own transaction, and recorded with a sha256 checksum.
 * Editing an already-applied migration is a hard error — in a financial system
 * you add a new migration, you never rewrite history (ADR-0009).
 */
export interface MigrationResult {
  readonly applied: string[];
  readonly alreadyApplied: string[];
}

export async function ensureMigrationRegistry(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text        PRIMARY KEY,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(
  connectionString: string,
  migrationsDir: string = path.join(process.cwd(), 'migrations'),
): Promise<MigrationResult> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await ensureMigrationRegistry(client);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const appliedResult = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations',
    );
    const applied = new Map(appliedResult.rows.map((r) => [r.id, r.checksum]));

    const result: { applied: string[]; alreadyApplied: string[] } = {
      applied: [],
      alreadyApplied: [],
    };

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);

      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} changed after it was applied (checksum mismatch). ` +
              'Add a new migration instead of editing an applied one.',
          );
        }
        result.alreadyApplied.push(file);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      result.applied.push(file);
    }

    return result;
  } finally {
    await client.end();
  }
}

export async function pendingMigrations(
  connectionString: string,
  migrationsDir: string = path.join(process.cwd(), 'migrations'),
): Promise<string[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await ensureMigrationRegistry(client);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const appliedResult = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((r) => r.id));
    return files.filter((f) => !applied.has(f));
  } finally {
    await client.end();
  }
}
