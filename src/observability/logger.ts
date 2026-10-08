import { pino, type Logger as PinoLogger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { LogContext, Logger } from '../application/ports.js';

/**
 * Structured JSON logging with defensive redaction. Secrets, tokens, password
 * material and credentials are redacted at the logger boundary so they can
 * never be accidentally committed to a log line, even if a caller passes them.
 */
const REDACT_PATHS = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

class PinoLoggerAdapter implements Logger {
  constructor(private readonly base: PinoLogger) {}

  debug(ctx: LogContext, msg?: string): void {
    this.base.debug(ctx, msg);
  }
  info(ctx: LogContext, msg?: string): void {
    this.base.info(ctx, msg);
  }
  warn(ctx: LogContext, msg?: string): void {
    this.base.warn(ctx, msg);
  }
  error(ctx: LogContext, msg?: string): void {
    this.base.error(ctx, msg);
  }
  child(bindings: LogContext): Logger {
    return new PinoLoggerAdapter(this.base.child(bindings));
  }
}

export function createLogger(config: AppConfig): Logger {
  const base = pino({
    level: config.isTest ? 'silent' : config.logLevel,
    base: { service: 'codealpha-banking-system', env: config.nodeEnv },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
  return new PinoLoggerAdapter(base);
}
