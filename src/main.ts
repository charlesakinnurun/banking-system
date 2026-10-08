import { loadConfig } from './config/env.js';
import { buildContainer } from './container.js';
import { buildServer } from './http/server.js';

/**
 * Process entry point. Boots config, the composition root, and the HTTP server;
 * wires graceful shutdown so in-flight requests finish and the pool drains.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const container = buildContainer(config);
  const app = await buildServer(container.deps);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.deps.logger.info({ signal }, 'shutdown initiated');
    try {
      await app.close();
      await container.shutdown();
      process.exit(0);
    } catch (error) {
      container.deps.logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  container.deps.logger.info(
    { port: config.port, host: config.host, env: config.nodeEnv, version: container.deps.version },
    'banking API listening',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal startup error: ${String(error)}\n`);
  process.exit(1);
});
