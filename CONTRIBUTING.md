# Contributing

Thanks for helping improve the CodeAlpha Banking System. This is a
correctness-first financial codebase, so the bar for changes to the money path
is deliberately high.

---

## Getting started

```bash
git clone <repo> && cd codealpha-banking-system
cp .env.example .env      # set DATABASE_URL and JWT_SECRET
npm ci
npm run migrate
npm run seed
npm run dev
```

Integration tests need **no** database setup — they boot an ephemeral
PostgreSQL automatically. To run them against your own instance, export
`TEST_DATABASE_URL`.

---

## The quality gate

Everything must pass before a PR is merged. Run it locally:

```bash
npm run verify
# = format:check && lint && typecheck && test && build
```

| Command                           | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `npm run format` / `format:check` | Prettier                                                |
| `npm run lint`                    | ESLint (type-aware)                                     |
| `npm run typecheck`               | `tsc --noEmit` (strict)                                 |
| `npm test`                        | Unit + integration + invariant + concurrency + security |
| `npm run build`                   | Compile to `dist/`                                      |
| `npm run openapi`                 | Regenerate `openapi.json`                               |
| `npm run migrate:status`          | Show pending migrations                                 |

Or run a subset: `npx vitest run tests/unit`, `npx vitest run tests/integration`.

---

## Architecture rules

- Dependencies point **inward only**: `http → application → domain`;
  `infrastructure` implements `application` ports. The `domain` imports nothing.
- **No business logic in route handlers.** Validate and delegate.
- **No direct SQL outside `src/infrastructure/persistence`.**
- **No floating-point money** and no `number` arithmetic on amounts — use
  `Money`/`bigint`.
- **No mutation of posted records** — post a reversal.
- Add an **ADR** in [DECISIONS.md](DECISIONS.md) when you change a decision there.

---

## Testing expectations

- New behaviour needs a test. Bugs need a regression test that fails first.
- Money-path changes must be covered by an **invariant** and, where relevant, a
  **concurrency** test (`tests/integration/`).
- Do not weaken or delete an invariant test to make a change pass. If an
  invariant is wrong, change it deliberately with an ADR.
- Prefer meaningful coverage over coverage numbers.

---

## Commits & branches

Use **Conventional Commits**:

```
feat(transfers): reject same-account transfers
fix(idempotency): commit failed-login counter before returning 401
test(concurrency): cover parallel withdrawals on one account
docs(ledger): clarify reversal semantics
chore(ci): pin postgres service image
```

Never use messages like `update`, `fix stuff`, `changes`, or `final`.

Branch names: `feat/…`, `fix/…`, `docs/…`, `chore/…`.

---

## Pull requests

- Keep PRs focused; smaller is better and reviews faster.
- Fill in the PR template, including **how you verified** the change.
- CI (format, lint, typecheck, tests, build, audit) must be green.
- Changes to auth, crypto, ledger, idempotency, or migrations require review
  from a code owner.

By contributing you agree your work is licensed under the [MIT License](LICENSE).
