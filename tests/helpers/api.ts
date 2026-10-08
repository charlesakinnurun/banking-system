import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export interface AuthedCustomer {
  readonly token: string;
  readonly customerId: string;
  readonly email: string;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export async function registerCustomer(
  app: FastifyInstance,
  email = uniqueEmail(),
  password = 'Password-123!',
): Promise<AuthedCustomer> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, fullName: 'Test Customer', password },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json();
  return { token: body.tokens.accessToken, customerId: body.customer.id, email };
}

export async function openAccount(
  app: FastifyInstance,
  token: string,
  currency = 'USD',
): Promise<{ id: string; accountNumber: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounts',
    headers: { authorization: `Bearer ${token}` },
    payload: { type: 'checking', currency },
  });
  if (res.statusCode !== 201) {
    throw new Error(`openAccount failed: ${res.statusCode} ${res.body}`);
  }
  const account = res.json();
  return { id: account.id, accountNumber: account.accountNumber };
}

export function idempotencyKey(): string {
  return randomUUID();
}

export async function deposit(
  app: FastifyInstance,
  token: string,
  accountId: string,
  amountMinor: string,
  currency = 'USD',
  key = idempotencyKey(),
): Promise<{ statusCode: number; body: unknown; raw: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/transactions/deposit',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    payload: { accountId, amountMinor, currency },
  });
  return { statusCode: res.statusCode, body: safeJson(res.body), raw: res.body };
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
