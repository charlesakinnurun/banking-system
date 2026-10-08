import { z } from 'zod';

/**
 * Environment is validated once, at process start, and then frozen into a
 * typed, immutable config object. Nothing else in the codebase reads
 * `process.env` directly — that keeps configuration observable and testable and
 * guarantees we never run with a silently missing secret.
 */

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

const bool = (defaultValue: 'true' | 'false') =>
  z
    .string()
    .default(defaultValue)
    .transform((v) => v.trim().toLowerCase() === 'true');

const int = (defaultValue: number) => z.coerce.number().int().default(defaultValue);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.string().default('false'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: int(10),
  DB_POOL_IDLE_TIMEOUT_MS: int(30_000),
  DB_CONNECTION_TIMEOUT_MS: int(5_000),
  DB_STATEMENT_TIMEOUT_MS: int(10_000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('codealpha-banking'),
  JWT_AUDIENCE: z.string().default('codealpha-banking-api'),
  ACCESS_TOKEN_TTL_SECONDS: int(900),
  REFRESH_TOKEN_TTL_DAYS: int(30),

  SCRYPT_COST_N: int(16_384),
  SCRYPT_BLOCK_SIZE_R: int(8),
  SCRYPT_PARALLELIZATION_P: int(1),
  SCRYPT_KEYLEN: int(64),
  SCRYPT_MAXMEM_BYTES: int(64 * 1024 * 1024),

  LOGIN_MAX_FAILED_ATTEMPTS: int(5),
  LOGIN_LOCKOUT_SECONDS: int(900),

  RATE_LIMIT_MAX: int(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  IDEMPOTENCY_TTL_HOURS: int(24),
  IDEMPOTENCY_IN_PROGRESS_TIMEOUT_SECONDS: int(60),

  RISK_MAX_SINGLE_TRANSFER_MINOR: z.coerce.bigint().default(100_000_000n),
  RISK_DAILY_VELOCITY_MINOR: z.coerce.bigint().default(500_000_000n),
  RISK_MAX_TXN_PER_MINUTE: int(20),

  CORS_ORIGINS: z.string().default(''),

  METRICS_ENABLED: bool('true'),
  METRICS_PATH: z.string().default('/metrics'),
  ERROR_TRACKING_WEBHOOK_URL: z.string().default(''),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe-Admin-Password-123!'),
  SEED_DEMO_DATA: bool('true'),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly trustProxy: boolean | string;

  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  readonly dbPoolIdleTimeoutMs: number;
  readonly dbConnectionTimeoutMs: number;
  readonly dbStatementTimeoutMs: number;

  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlDays: number;

  readonly scrypt: {
    readonly N: number;
    readonly r: number;
    readonly p: number;
    readonly keylen: number;
    readonly maxmem: number;
  };

  readonly loginMaxFailedAttempts: number;
  readonly loginLockoutSeconds: number;

  readonly rateLimitMax: number;
  readonly rateLimitWindow: string;

  readonly idempotencyTtlHours: number;
  readonly idempotencyInProgressTimeoutSeconds: number;

  readonly risk: {
    readonly maxSingleTransferMinor: bigint;
    readonly dailyVelocityMinor: bigint;
    readonly maxTxnPerMinute: number;
  };

  readonly corsOrigins: string[];
  readonly metricsEnabled: boolean;
  readonly metricsPath: string;
  readonly errorTrackingWebhookUrl: string;

  readonly seed: {
    readonly adminEmail: string;
    readonly adminPassword: string;
    readonly demoData: boolean;
  };
}

function parseTrustProxy(value: string): boolean | string {
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false' || v === '') return false;
  return value.trim();
}

/**
 * Parse and freeze configuration. Throws a readable error listing every
 * problem at once (fail fast and fail loud at boot).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = result.data;

  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),

    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    dbPoolIdleTimeoutMs: e.DB_POOL_IDLE_TIMEOUT_MS,
    dbConnectionTimeoutMs: e.DB_CONNECTION_TIMEOUT_MS,
    dbStatementTimeoutMs: e.DB_STATEMENT_TIMEOUT_MS,

    jwtSecret: e.JWT_SECRET,
    jwtIssuer: e.JWT_ISSUER,
    jwtAudience: e.JWT_AUDIENCE,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,

    scrypt: {
      N: e.SCRYPT_COST_N,
      r: e.SCRYPT_BLOCK_SIZE_R,
      p: e.SCRYPT_PARALLELIZATION_P,
      keylen: e.SCRYPT_KEYLEN,
      maxmem: e.SCRYPT_MAXMEM_BYTES,
    },

    loginMaxFailedAttempts: e.LOGIN_MAX_FAILED_ATTEMPTS,
    loginLockoutSeconds: e.LOGIN_LOCKOUT_SECONDS,

    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitWindow: e.RATE_LIMIT_WINDOW,

    idempotencyTtlHours: e.IDEMPOTENCY_TTL_HOURS,
    idempotencyInProgressTimeoutSeconds: e.IDEMPOTENCY_IN_PROGRESS_TIMEOUT_SECONDS,

    risk: {
      maxSingleTransferMinor: e.RISK_MAX_SINGLE_TRANSFER_MINOR,
      dailyVelocityMinor: e.RISK_DAILY_VELOCITY_MINOR,
      maxTxnPerMinute: e.RISK_MAX_TXN_PER_MINUTE,
    },

    corsOrigins: csv(e.CORS_ORIGINS),
    metricsEnabled: e.METRICS_ENABLED,
    metricsPath: e.METRICS_PATH,
    errorTrackingWebhookUrl: e.ERROR_TRACKING_WEBHOOK_URL,

    seed: {
      adminEmail: e.SEED_ADMIN_EMAIL,
      adminPassword: e.SEED_ADMIN_PASSWORD,
      demoData: e.SEED_DEMO_DATA,
    },
  });
}
