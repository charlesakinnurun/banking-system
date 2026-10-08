# Architectural Decision Records (ADRs)

Short, dated records of decisions that were expensive to make and would be
expensive to reverse. Format: context → decision → consequences → alternatives.

---

## ADR-0001 — TypeScript on Node + PostgreSQL, explicit SQL (no ORM)

**Context.** Greenfield. Must handle money correctly, be reviewable by senior
engineers, and be simple to operate.

**Decision.** TypeScript (strict, ESM) on Node ≥ 20; Fastify for HTTP;
PostgreSQL 16 as the single datastore; the `pg` driver with **hand-written,
parameterised SQL** for all money-path queries. No ORM.

**Consequences.**

- Locking (`SELECT ... FOR UPDATE`) and transaction boundaries are explicit and
  visible in review — critical for a ledger.
- Type safety is preserved with row-shape interfaces + explicit mappers.
- We give up ORM conveniences; migrations are plain SQL, queries are manual.
- `bigint` handling must be deliberate (`pg` returns int8 as string; we parse).

**Alternatives rejected.** Prisma (its interactive-transaction + raw-lock story
is awkward and hides SQL); TypeORM (heavy, encourages implicit lazy writes);
SQLite (locking semantics are not those of our production DB).

---

## ADR-0002 — Money is an integer in minor units; never floating point

**Context.** `0.1 + 0.2 !== 0.3`. Binary floating point cannot represent most
decimal money exactly.

**Decision.** `Money = { amount: bigint (minor units), currency: ISO-4217 }`.
Storage is `BIGINT`. `bigint` (not `number`) so we never hit the 2^53 ceiling
and so arithmetic is always exact. Currency exponents are explicit
(`CURRENCY_EXPONENTS`); unknown currencies are **rejected**, not guessed.

**Consequences.**

- Exact arithmetic everywhere; no rounding drift.
- Callers must convert to/from major units at the edge only, via `Money` helpers.
- `pg` parses `BIGINT` to `string`; we convert to `bigint` in one place.

**Alternatives rejected.** `numeric` columns (fine, but strings in JS app code
invite accidental `Number()` coercion); a money library (extra dependency for
arithmetic we can write correctly and test).

---

## ADR-0003 — Double-entry ledger is the source of truth; balances are a cache

**Context.** "What is the balance?" and "why is the balance that?" are different
questions. A single mutable `balance` column answers only the first and cannot
be audited.

**Decision.** Every money movement writes balanced `ledger_entries`
(Σ debits = Σ credits) inside one transaction. Customer balance is _derived_
from entries. We additionally maintain `accounts.cached_balance` **in the same
transaction** for fast reads, and a reconciliation job asserts
`cached_balance == Σ signed entries`.

**Consequences.**

- Any historical state is reconstructible from immutable entries.
- Two places can disagree only via a bug, which reconciliation detects.
- Slightly more write work per movement (accepted).

**Alternatives rejected.** Mutable balance with an append-only "history" table
that is not actually the source of truth (drifts, unauditable).

---

## ADR-0004 — READ COMMITTED + explicit ordered row locks (not SERIALIZABLE)

**Context.** Concurrent withdrawals/transfers on the same account must not
overdraw or lose updates. Two opposite transfers can deadlock.

**Decision.** Default `READ COMMITTED`. In the money path, lock the affected
account rows with `SELECT ... FOR UPDATE` **sorted by account id**, so lock
acquisition order is globally consistent and deadlocks are structurally
avoided. A single `cached_balance >= 0` CHECK constraint guards against logic
bugs. We still retry on `40001` (serialization) / `40P01` (deadlock) as defence.

**Consequences.**

- Simple, predictable locking; contention is bounded to the touched accounts.
- Hot-account contention serialises (correct, expected at a bank).
- We must remember to lock in id order — enforced by a single helper.

**Alternatives rejected.** `SERIALIZABLE` (correct but retry-heavy and harder
to reason about); optimistic version columns (more round trips, more code).

---

## ADR-0005 — HTTP idempotency via a persisted key committed with the movement

**Context.** Clients and networks retry. A retried transfer must not move money
twice, and a crash must not desynchronise "key recorded" from "money moved".

**Decision.** `idempotency_keys (customer_id, key, endpoint)` is unique. The
reservation row and the money movement commit in **one** transaction. Duplicate
handling:

- same key + same request fingerprint + `completed` → replay stored response;
- same key + different fingerprint → `422 idempotency_key_reuse`;
- same key + `in_progress` and lease fresh → `409` (concurrent duplicate);
- same key + `in_progress` and lease stale → take over (holder presumed dead).
  TTL default 24h; expired keys are GC'd.

**Consequences.**

- Exactly-once money movement under at-least-once delivery.
- Requires clients to send a stable key (documented; enforced on money routes).

**Alternatives rejected.** In-memory dedupe (lost on restart, not multi-node);
relying on a natural key (no natural key exists for "transfer of 10 to Bob").

---

## ADR-0006 — Password hashing with scrypt from `node:crypto`

**Context.** Need a memory-hard KDF with no native build step, in a repo that
must `npm ci` reproducibly.

**Decision.** `scrypt` (N=2^14, r=8, p=1, keylen=64) from Node core, per-user
random 16-byte salt, stored as `scrypt$N$r$p$salt$hash`. Comparison is
`timingSafeEqual`. Parameters are tunable and lowered only in tests.

**Consequences.** Zero native dependencies; parameters benchmark lower than
argon2id but are defensible and upgradeable (the stored string encodes params,
so we can rehash on login later).

**Alternatives rejected.** `bcrypt`/`argon2` (native builds → install friction
and supply-chain surface); plain PBKDF2 (not memory-hard).

---

## ADR-0007 — Short JWT access token + rotating opaque refresh token

**Context.** Stateless horizontal scaling vs. the need to revoke sessions.

**Decision.** Access token = JWT (HS256), 15 min, carries `sub` + `role`.
Refresh token = 32-byte random opaque value, stored **hashed** (`sha256`) with
expiry/rotation/reuse-detection. On refresh, the old token is revoked and
replaced; presenting a revoked token revokes the whole family.

**Consequences.** Access revocation is bounded by the 15-minute TTL; refresh
revocation is immediate. Refresh tokens are never logged and stored hashed.

**Alternatives rejected.** Long-lived JWTs (unrevocable); server-side sessions
(needs shared session store — acceptable but another moving part for v1).

---

## ADR-0008 — Ledger immutability enforced in the database

**Context.** "Posted transactions are immutable" must survive application bugs
and a compromised app role.

**Decision.** `ledger_entries` and posted `transactions` are protected by a
`BEFORE UPDATE OR DELETE` trigger that raises. The application's DB role is not
granted `UPDATE`/`DELETE` on those tables. Reversals are _new_ compensating
transactions, never edits.

**Consequences.** Cannot smuggle an edit even from a bug; history is provable.
Corrections require an explicit reversal, which is what auditors want.

**Alternatives rejected.** Application-only immutability (one missing check
away from silent corruption).

---

## ADR-0009 — Plain-SQL migrations with checksums; forward-only

**Context.** Schema must be reviewable and reproducible; no magic diffing.

**Decision.** Numbered `.sql` files in `migrations/`, applied in order, each in
its own transaction, recorded in `schema_migrations` with a sha256 checksum. A
changed already-applied file is a hard error. Forward-only; corrections are new
migrations.

**Consequences.** Full auditability of schema history; no down-migrations
(standard for financial systems — you restore, you don't reverse).

---

## ADR-0010 — Modular monolith, not microservices

**Context.** Temptation to split "ledger", "auth", "notifications".

**Decision.** One deployable service with hard internal module boundaries
enforced by the dependency rule. The ledger's ACID guarantees are trivial
within one Postgres transaction and expensive across service boundaries.

**Consequences.** Simple to operate and reason about; can be split later along
the existing seams if a real scaling need appears.

**Alternatives rejected.** Microservices at this stage (distributed
transactions, partial failure, eventual consistency — all downside, no proven
need).

---

## ADR-0011 — Retry only idempotent / safely-retryable work, with backoff

**Context.** Transient DB errors happen; retrying a non-idempotent money
operation can double-spend.

**Decision.** Retry **only** on Postgres `40001`/`40P01` inside the money-path
transaction wrapper, because the whole transaction rolled back (retrying is
safe) and the idempotency key makes the outer request safe too. Jittered
exponential backoff, bounded attempts. Never retry on validation/business
errors. Outbox delivery is at-least-once and consumers dedupe.

**Consequences.** No retry storms on business errors; transient contention
self-heals.

---

## ADR-0012 — Transactional outbox for notifications

**Context.** A notification must not be sent if the transaction rolls back, and
must eventually be sent if it commits. Sending inside the request couples user
latency to a third party.

**Decision.** Write notifications to the `notifications` table in the same
transaction, status `pending`. A background dispatcher delivers them
at-least-once and marks them sent; `(transaction_id, type)` is unique so
duplicates are impossible. Delivery is best-effort and never blocks the money
path.

**Consequences.** Money path is fast and consistent; notifications are
eventually consistent, which is acceptable for this channel by definition.

---

## ADR-0013 — Error model: typed domain errors mapped at the HTTP edge

**Context.** Controllers must not know business rules, and clients need
consistent errors.

**Decision.** Domain/application throw typed `AppError` subclasses with a stable
machine `code` and an HTTP hint. A single Fastify error handler maps them to a
uniform envelope `{ error: { code, message, requestId, details? } }`. Unknown
errors become `500` with the message swallowed (a generic one returned) and the
full error logged with the request id.

**Consequences.** Consistent client contract; no stack traces or PII leak to
clients; observability keeps the detail.
