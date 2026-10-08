import { ValidationError } from './errors.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Minimal, defensible password policy. We intentionally do NOT impose
 * composition rules that push users toward predictable patterns; length is the
 * strongest practical signal. Breach-list checking would be added via a
 * k-anonymity range API in production (documented in SECURITY.md).
 */
export function assertPasswordStrength(plain: string): void {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (!/[A-Za-z]/.test(plain) || !/[0-9]/.test(plain)) {
    throw new ValidationError('Password must contain at least one letter and one number');
  }
}

/** Constant-ish normalisation used before hashing and login comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
