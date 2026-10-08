import type { Beneficiary } from '../domain/beneficiary.js';
import { assertBeneficiaryInput } from '../domain/beneficiary.js';
import type { BeneficiaryId } from '../domain/enums.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { currencyExponent } from '../domain/money.js';
import type { Repositories } from './ports.js';
import type { LedgerActor } from './ledger-service.js';
import { isUniqueViolation } from '../infrastructure/db/pg-errors.js';

export interface CreateBeneficiaryRequest {
  readonly name: string;
  readonly accountNumber: string;
  readonly bankCode: string;
  readonly currency: string;
}

export class BeneficiaryService {
  async create(
    repos: Repositories,
    actor: LedgerActor,
    input: CreateBeneficiaryRequest,
  ): Promise<Beneficiary> {
    assertBeneficiaryInput(input);
    const currency = input.currency.toUpperCase();
    currencyExponent(currency);
    try {
      const beneficiary = await repos.beneficiaries.create({
        customerId: actor.id,
        name: input.name,
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
        currency,
      });
      await repos.audit.record({
        actorId: actor.id,
        action: 'beneficiary.created',
        entityType: 'beneficiary',
        entityId: beneficiary.id,
        requestId: actor.requestId ?? null,
        ip: actor.ip ?? null,
        metadata: { name: beneficiary.name, bankCode: beneficiary.bankCode },
      });
      return beneficiary;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('This beneficiary already exists');
      }
      throw error;
    }
  }

  async list(repos: Repositories, actor: LedgerActor): Promise<Beneficiary[]> {
    return repos.beneficiaries.listByCustomer(actor.id);
  }

  async archive(repos: Repositories, actor: LedgerActor, id: BeneficiaryId): Promise<void> {
    const archived = await repos.beneficiaries.archive(id, actor.id);
    if (!archived) throw new NotFoundError('Beneficiary');
    await repos.audit.record({
      actorId: actor.id,
      action: 'beneficiary.archived',
      entityType: 'beneficiary',
      entityId: id,
      requestId: actor.requestId ?? null,
      ip: actor.ip ?? null,
      metadata: {},
    });
  }
}
