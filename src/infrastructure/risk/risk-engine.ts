import type { RiskContext, RiskDecision, RiskEngine } from '../../application/ports.js';

export interface RuleBasedRiskEngineOptions {
  readonly maxSingleTransferMinor: bigint;
  readonly dailyVelocityMinor: bigint;
  readonly maxTxnPerMinute: number;
}

/**
 * Deterministic, configurable risk rules. This is intentionally a *rule* engine
 * (not an ML scorer) because it is explainable and auditable — every rejection
 * names the rule that fired, which is what a reviewer and a customer-support
 * agent need. An ML model would slot in behind the same `RiskEngine` port.
 *
 * Rules run *before* any ledger write, so a rejected transaction leaves no
 * financial state at all.
 */
export class RuleBasedRiskEngine implements RiskEngine {
  constructor(private readonly options: RuleBasedRiskEngineOptions) {}

  assess(context: RiskContext): RiskDecision {
    if (context.amountMinor <= 0n) {
      return { allowed: false, reason: 'non_positive_amount' };
    }
    if (context.amountMinor > this.options.maxSingleTransferMinor) {
      return { allowed: false, reason: 'amount_exceeds_single_transaction_limit' };
    }
    if (context.txnsLastMinute >= this.options.maxTxnPerMinute) {
      return { allowed: false, reason: 'velocity_exceeded' };
    }
    if (context.debitsLastDayMinor + context.amountMinor > this.options.dailyVelocityMinor) {
      return { allowed: false, reason: 'daily_limit_exceeded' };
    }
    return { allowed: true };
  }
}

/** Permissive engine for tests / environments where risk is disabled. */
export class AllowAllRiskEngine implements RiskEngine {
  assess(): RiskDecision {
    return { allowed: true };
  }
}
