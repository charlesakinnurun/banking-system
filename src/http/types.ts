import type { AppConfig } from '../config/env.js';
import type { CustomerId, CustomerRole } from '../domain/enums.js';
import type {
  Clock,
  IdGenerator,
  Logger,
  PasswordHasher,
  TokenService,
  UnitOfWork,
} from '../application/ports.js';
import type { AccountService } from '../application/account-service.js';
import type { AdminService } from '../application/admin-service.js';
import type { AuthService } from '../application/auth-service.js';
import type { BeneficiaryService } from '../application/beneficiary-service.js';
import type { LedgerService } from '../application/ledger-service.js';
import type { ReconciliationService } from '../application/reconciliation-service.js';
import type { StatementService } from '../application/statement-service.js';
import type { Metrics } from '../observability/metrics.js';

export interface AuthActor {
  readonly id: CustomerId;
  readonly role: CustomerRole;
}

export interface AppServices {
  readonly auth: AuthService;
  readonly accounts: AccountService;
  readonly ledger: LedgerService;
  readonly beneficiaries: BeneficiaryService;
  readonly statements: StatementService;
  readonly reconciliation: ReconciliationService;
  readonly admin: AdminService;
}

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tokens: TokenService;
  readonly hasher: PasswordHasher;
  readonly services: AppServices;
  /** Liveness of downstream dependencies (DB). */
  readonly readiness: () => Promise<boolean>;
  readonly version: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: AuthActor;
  }
}

