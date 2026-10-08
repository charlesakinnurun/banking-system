import { ValidationError } from './errors.js';
import type { BeneficiaryId, BeneficiaryStatus, CustomerId } from './enums.js';

/**
 * A saved payee. In v1 beneficiaries are used to pre-fill internal transfers,
 * so the target is identified by account number + bank code. We never trust a
 * client-supplied beneficiary record to authorise money movement: the transfer
 * still re-resolves the destination account server-side.
 */
export interface Beneficiary {
  readonly id: BeneficiaryId;
  readonly customerId: CustomerId;
  readonly name: string;
  readonly accountNumber: string;
  readonly bankCode: string;
  readonly currency: string;
  readonly status: BeneficiaryStatus;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

export function assertBeneficiaryInput(input: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): void {
  if (input.name.trim().length < 2 || input.name.trim().length > 120) {
    throw new ValidationError('Beneficiary name must be between 2 and 120 characters');
  }
  if (!/^\d{10}$/.test(input.accountNumber)) {
    throw new ValidationError('Beneficiary account number must be 10 digits');
  }
  if (!/^[A-Z0-9]{3,11}$/.test(input.bankCode)) {
    throw new ValidationError('Beneficiary bank code must be 3-11 alphanumeric characters');
  }
}
