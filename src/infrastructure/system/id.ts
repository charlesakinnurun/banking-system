import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../application/ports.js';

const BASE32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }

  /**
   * 10-digit account number with a non-zero leading digit. Uniqueness is
   * ultimately guaranteed by the DB unique constraint; a collision surfaces as
   * a unique violation which the account service retries.
   */
  accountNumber(): string {
    let number = String(randomInt(1, 10));
    for (let i = 0; i < 9; i += 1) {
      number += String(randomInt(0, 10));
    }
    return number;
  }

  transactionReference(): string {
    const time = Date.now().toString(36).toUpperCase();
    const entropy = Array.from({ length: 8 }, () => BASE32[randomInt(0, BASE32.length)]).join('');
    return `TXN-${time}-${entropy}`;
  }

  opaqueToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}
