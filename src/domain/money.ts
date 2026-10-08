import { ValidationError } from './errors.js';

/**
 * Money is represented as a signed integer count of **minor units**
 * (e.g. cents) plus an ISO-4217 currency code. Floating point is never used for
 * money, anywhere — see DECISIONS.md ADR-0002.
 *
 * `bigint` is used rather than `number` so arithmetic is always exact and we
 * never approach the 2^53 safe-integer ceiling.
 */

/**
 * ISO-4217 minor-unit exponents. An unknown currency is REJECTED rather than
 * assumed to have 2 decimals — guessing would silently misprice money. Add
 * currencies here explicitly as they are supported.
 */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  // exponent 0
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  // exponent 2
  USD: 2,
  EUR: 2,
  GBP: 2,
  NGN: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  CNY: 2,
  INR: 2,
  BRL: 2,
  ZAR: 2,
  KES: 2,
  GHS: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  TRY: 2,
  MXN: 2,
  SGD: 2,
  HKD: 2,
  NZD: 2,
  // exponent 3
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
  // exponent 4 (rare)
  CLF: 4,
});

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const exponent = CURRENCY_EXPONENTS[code];
  if (exponent === undefined) {
    throw new ValidationError(`Unsupported currency: ${currency}`, { currency });
  }
  return exponent;
}

const MAJOR_PATTERN = /^-?\d+(\.\d+)?$/;

/** Parse an exact decimal major-unit string (e.g. "10.50") into minor units. */
export function parseMajorToMinor(input: string, exponent: number): bigint {
  const value = input.trim();
  if (!MAJOR_PATTERN.test(value)) {
    throw new ValidationError(`Invalid monetary amount: ${input}`, { amount: input });
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart = '0', fracPart = ''] = unsigned.split('.');
  if (fracPart.length > exponent) {
    throw new ValidationError(
      `Amount ${input} has more than ${exponent} decimal place(s) for this currency`,
      { amount: input, exponent },
    );
  }
  const paddedFraction = (fracPart + '0'.repeat(exponent)).slice(0, exponent);
  const scale = 10n ** BigInt(exponent);
  const minor = BigInt(intPart) * scale + (paddedFraction === '' ? 0n : BigInt(paddedFraction));
  return negative ? -minor : minor;
}

/** Render minor units as an exact decimal major-unit string (no currency symbol). */
export function formatMinorToMajor(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const sign = negative ? '-' : '';
  if (exponent === 0) return `${sign}${abs.toString()}`;
  const digits = abs.toString().padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: string,
  ) {}

  /** Construct from an integer count of minor units. */
  static of(minor: bigint | number, currency: string): Money {
    const code = currency.toUpperCase();
    currencyExponent(code); // validates known currency
    const amount = typeof minor === 'bigint' ? minor : BigInt(Math.trunc(minor));
    return new Money(amount, code);
  }

  /** Construct from a major-unit decimal string (e.g. "10.50", "1000", "-3.5"). */
  static fromMajor(value: string, currency: string): Money {
    const code = currency.toUpperCase();
    const exponent = currencyExponent(code);
    return new Money(parseMajorToMinor(value, exponent), code);
  }

  static zero(currency: string): Money {
    return Money.of(0n, currency);
  }

  get exponent(): number {
    return currencyExponent(this.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new ValidationError(`Cannot combine ${this.currency} and ${other.currency} amounts`, {
        left: this.currency,
        right: other.currency,
      });
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  abs(): Money {
    return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency);
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  /** -1 | 0 | 1, comparing amount within a currency. */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  /** Exact major-unit string, e.g. "10.50". */
  toMajorString(): string {
    return formatMinorToMajor(this.minor, this.exponent);
  }

  /** Human display including the code, e.g. "10.50 USD". */
  format(): string {
    return `${this.toMajorString()} ${this.currency}`;
  }

  /**
   * Serialise as strings so the value survives JSON without precision loss.
   * `amountMinor` is a string on the wire; clients parse to integer/bigint.
   */
  toJSON(): { amountMinor: string; currency: string } {
    return { amountMinor: this.minor.toString(), currency: this.currency };
  }

  static fromJSON(value: { amountMinor: string | number | bigint; currency: string }): Money {
    return Money.of(BigInt(value.amountMinor), value.currency);
  }
}

/** Sum a list of same-currency amounts; returns zero of `currency` when empty. */
export function sumMoney(amounts: readonly Money[], currency: string): Money {
  return amounts.reduce((acc, m) => acc.add(m), Money.zero(currency));
}
