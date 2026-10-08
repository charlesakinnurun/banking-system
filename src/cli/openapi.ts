import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config/env.js';
import { buildContainer } from '../container.js';
import { buildServer } from '../http/server.js';

/**
 * Emit the OpenAPI document to `openapi.json`. No database connection is used
 * (route registration is pure), so this runs in CI without infrastructure.
 */
async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused:unused@localhost:5432/unused',
    JWT_SECRET: process.env.JWT_SECRET ?? 'openapi-generation-secret-value-32chars',
    LOG_LEVEL: 'silent',
    METRICS_ENABLED: 'false',
  });

  const container = buildContainer(config);
  const app = await buildServer(container.deps);
  await app.ready();

  const spec = app.swagger();
  const outputPath = path.join(process.cwd(), 'openapi.json');
  await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

  await app.close();
  await container.shutdown();
  process.stdout.write(`OpenAPI written to ${outputPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`OpenAPI generation failed: ${String(error)}\n`);
  process.exit(1);
});
