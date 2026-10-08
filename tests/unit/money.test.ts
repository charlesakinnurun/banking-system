import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors.js';
import {
  Money,
  currencyExponent,
  formatMinorToMajor,
  parseMajorToMinor,
} from '../../src/domain/money.js';

describe('Money', () => {
  it('adds decimals exactly, with no floating point error', () => {
    const a = Money.fromMajor('0.10', 'USD');
    const b = Money.fromMajor('0.20', 'USD');
    expect(a.add(b).toMajorString()).toBe('0.30');
  });

  it('represents 0.1 + 0.2 as exactly 30 minor units', () => {
    const sum = Money.fromMajor('0.1', 'USD').add(Money.fromMajor('0.2', 'USD'));
    expect(sum.minor).toBe(30n);
  });

  it('rejects unknown currencies rather than guessing the exponent', () => {
    expect(() => Money.of(1n, 'ZZZ')).toThrow(ValidationError);
  });

  it('rejects amounts with more decimals than the currency allows', () => {
    expect(() => Money.fromMajor('1.234', 'USD')).toThrow(ValidationError);
    expect(() => Money.fromMajor('1.5', 'JPY')).toThrow(ValidationError);
  });

  it('handles 0-decimal and 3-decimal currencies', () => {
    expect(Money.fromMajor('1000', 'JPY').minor).toBe(1000n);
    expect(Money.fromMajor('1.234', 'BHD').minor).toBe(1234n);
    expect(currencyExponent('KWD')).toBe(3);
  });

  it('is exact for amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    const money = Money.of(big, 'USD');
    expect(money.toMajorString()).toBe('90071992547409.93');
    expect(Money.fromMajor(money.toMajorString(), 'USD').minor).toBe(big);
  });

  it('refuses to combine different currencies', () => {
    expect(() => Money.of(1n, 'USD').add(Money.of(1n, 'EUR'))).toThrow(ValidationError);
  });

  it('preserves sign through formatting and parsing', () => {
    expect(Money.fromMajor('-1.50', 'USD').toMajorString()).toBe('-1.50');
    expect(Money.of(-150n, 'USD').isNegative()).toBe(true);
  });

  it('compares within a currency', () => {
    expect(Money.fromMajor('10.00', 'USD').equals(Money.of(1000n, 'USD'))).toBe(true);
    expect(Money.fromMajor('9.99', 'USD').lessThan(Money.fromMajor('10.00', 'USD'))).toBe(true);
  });
});

describe('minor<->major conversions', () => {
  it('parses without floating point', () => {
    expect(parseMajorToMinor('10.50', 2)).toBe(1050n);
    expect(parseMajorToMinor('0.05', 2)).toBe(5n);
    expect(parseMajorToMinor('1000', 0)).toBe(1000n);
  });

  it('formats without floating point', () => {
    expect(formatMinorToMajor(1050n, 2)).toBe('10.50');
    expect(formatMinorToMajor(-5n, 2)).toBe('-0.05');
    expect(formatMinorToMajor(1000n, 0)).toBe('1000');
  });
});
