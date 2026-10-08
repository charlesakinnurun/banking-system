/** Reusable JSON schemas for validation, serialization, and OpenAPI docs. */

import { CURRENCY_EXPONENTS } from '../domain/money.js';

export const uuidSchema = { type: 'string', format: 'uuid' } as const;
export const currencySchema = {
  type: 'string',
  enum: Object.keys(CURRENCY_EXPONENTS),
  description: 'ISO-4217 currency code (must be a supported currency).',
} as const;
export const amountMinorSchema = {
  type: 'string',
  pattern: '^[0-9]{1,18}$',
  description: 'Integer amount in minor units (e.g. "1050" = 10.50 for a 2-decimal currency).',
} as const;

export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: { type: 'object', additionalProperties: true, nullable: true },
      },
      required: ['code', 'message', 'requestId'],
    },
  },
  required: ['error'],
} as const;

export const moneySchema = {
  type: 'object',
  properties: {
    amountMinor: { type: 'string' },
    currency: { type: 'string' },
  },
  required: ['amountMinor', 'currency'],
} as const;

export const accountSchema = {
  type: 'object',
  properties: {
    id: uuidSchema,
    customerId: uuidSchema,
    accountNumber: { type: 'string' },
    type: { type: 'string' },
    currency: { type: 'string' },
    status: { type: 'string' },
    balance: moneySchema,
    createdAt: { type: 'string' },
  },
  required: ['id', 'customerId', 'accountNumber', 'type', 'currency', 'status', 'balance'],
} as const;

export const transactionSchema = {
  type: 'object',
  properties: {
    id: uuidSchema,
    reference: { type: 'string' },
    type: { type: 'string' },
    status: { type: 'string' },
    amount: moneySchema,
    createdAt: { type: 'string' },
  },
  required: ['id', 'reference', 'type', 'status', 'amount'],
} as const;

export const tokensSchema = {
  type: 'object',
  properties: {
    tokenType: { type: 'string' },
    accessToken: { type: 'string' },
    expiresInSeconds: { type: 'integer' },
    refreshToken: { type: 'string' },
    refreshExpiresAt: { type: 'string' },
  },
  required: ['tokenType', 'accessToken', 'expiresInSeconds', 'refreshToken', 'refreshExpiresAt'],
} as const;

export const customerSchema = {
  type: 'object',
  properties: {
    id: uuidSchema,
    email: { type: 'string' },
    fullName: { type: 'string' },
    role: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'string' },
  },
  required: ['id', 'email', 'fullName', 'role', 'status'],
} as const;

export const idempotencyKeyHeaderSchema = {
  type: 'string',
  minLength: 8,
  maxLength: 255,
  description:
    'Client-generated key; repeated requests with the same key are replayed, not re-executed.',
} as const;

/** Spread into a route's `response` map to document consistent error bodies. */
export const errorResponses = {
  '400': errorResponseSchema,
  '401': errorResponseSchema,
  '403': errorResponseSchema,
  '404': errorResponseSchema,
  '409': errorResponseSchema,
  '422': errorResponseSchema,
  '429': errorResponseSchema,
  '5xx': errorResponseSchema,
} as const;
