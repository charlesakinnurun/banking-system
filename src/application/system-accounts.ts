/** Canonical ledger-account codes. Must match what the seed creates. */

export const settlementAccountCode = (currency: string): string =>
  `SYS:CASH:${currency.toUpperCase()}`;

export const feeRevenueAccountCode = (currency: string): string =>
  `SYS:FEE_REVENUE:${currency.toUpperCase()}`;

export const customerLedgerCode = (accountNumber: string): string => `CUST:${accountNumber}`;

/** Never store or log a full account number unless there is a legal need. */
export const maskAccountNumber = (accountNumber: string): string =>
  accountNumber.length <= 4 ? '****' : `****${accountNumber.slice(-4)}`;
