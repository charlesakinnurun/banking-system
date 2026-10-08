# Pull Request

## What & why

<!-- One paragraph: what this changes and the problem it solves. -->

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / internal
- [ ] Documentation
- [ ] Migration / schema
- [ ] Security

## Touches the money path?

- [ ] No
- [ ] Yes — ledger, balances, idempotency, transfers, or money representation

<!-- If yes, describe the invariants involved and how they are preserved. -->

## How this was verified

<!-- Commands run, tests added, evidence. "npm run verify" is the baseline. -->

- [ ] `npm run verify` passes (format, lint, typecheck, tests, build)
- [ ] Added/updated tests (unit / integration / invariant / concurrency)
- [ ] Added an ADR to DECISIONS.md (if a documented decision changed)
- [ ] Updated docs (README / API / SECURITY / etc.) if user-visible

## Checklist

- [ ] No floating-point money; amounts use `Money`/`bigint`
- [ ] No mutation of posted ledger entries or transactions
- [ ] No client-provided balances trusted
- [ ] No secrets committed; no new dependency without justification
- [ ] Migration is forward-only and checksummed (if applicable)

## Risk & rollback

<!-- Blast radius and how to roll back. -->
