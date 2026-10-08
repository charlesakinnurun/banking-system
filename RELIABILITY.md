# Reliability

How this system behaves when things go wrong — and how to operate it.

---

## The one rule that makes everything else tractable

**One HTTP request that moves money is exactly one database transaction.**
Everything for that movement commits atomically or nothing does. This single
boundary is why partial-state bugs are structurally impossible here, and why
retries are safe.

For each movement, inside one transaction:

1. reserve / look up the idempotency key,
2. lock the affected accounts (`SELECT … FOR UPDATE`, sorted by id),
3. validate policy (status, currency, limits, risk),
4. insert the transaction header,
5. insert the balanced ledger entries,
6. update each cached balance,
7. write audit events,
8. enqueue notifications (outbox),
9. mark the idempotency key completed with the response.

---

## Failure scenarios

| Failure                                           | Behaviour                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client retries a transfer**                     | Idempotency key replays the stored response; money moves once (integration-tested).                                                                              |
| **Two withdrawals race**                          | Row lock serialises them; the loser gets `409 insufficient_funds`; balance never negative (integration-tested).                                                  |
| **Two opposite transfers deadlock**               | Locks are acquired in sorted id order, so deadlocks are structurally avoided; residual `40P01`/`40001` are retried.                                              |
| **Process crashes mid-transaction**               | Postgres rolls back; the idempotency row rolls back too; a retry is clean.                                                                                       |
| **Process crashes after COMMIT, before response** | Client retries the same key → the completed response is replayed.                                                                                                |
| **Concurrent duplicate requests**                 | The second waits on the unique idempotency index; it replays once the first commits, or returns `409` while the first is in flight.                              |
| **Database unavailable**                          | Requests fail fast (`connectionTimeoutMillis`) with `503`; `/health/ready` returns `503`; no money moves.                                                        |
| **Notification endpoint down**                    | The notification row is already committed with `status=pending`; a worker retries at-least-once; `(transaction_id, type)` dedupes.                               |
| **Retry storm after a blip**                      | Retries are bounded with jittered exponential backoff and only for transient serialization/deadlock errors (`40001`/`40P01`); business errors are never retried. |

---

## Retries: where they are safe and why

`PgUnitOfWork.run` retries **only** when the database reports a serialization
failure or deadlock. In that case the transaction was rolled back, so re-running
the closure is safe; it releases the pool connection before backing off and
never holds one while sleeping. Combined with the idempotency key on the outer
request, a client retry is safe end to end.

**Non-idempotent operations are never retried without a key.** There is no
retry of a money movement that lacks an idempotency key, because that would be
the mechanism by which money is duplicated.

---

## Notifications: transactional outbox

A notification must not be sent if the movement rolls back, and must eventually
be sent if it commits. So the notification is a row written **in the same
transaction** as the movement. A separate dispatcher (delivery is a deployment
concern; the table and uniqueness contract are implemented) delivers
at-least-once and marks rows sent. Duplicates are impossible because of
`UNIQUE (transaction_id, type)`.

---

## Observability

| Signal                                                                                                                  | Where                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Structured JSON logs with `requestId` (and `customerId` when authed)                                                    | stdout                                                                                                                 |
| Redaction of secrets/tokens at the logger boundary                                                                      | `src/observability/logger.ts`                                                                                          |
| Prometheus metrics (HTTP latency/status, ledger postings, idempotency outcomes, auth, rate-limit hits, risk rejections) | `/metrics`                                                                                                             |
| Distributed correlation                                                                                                 | `x-request-id` echoed on every response; the id also appears in `audit_events` and `transactions.initiated_request_id` |
| Liveness / readiness                                                                                                    | `/health/live`, `/health/ready` (checks the DB)                                                                        |
| Audit trail                                                                                                             | `audit_events` (append-only)                                                                                           |

No request bodies, headers, query strings, tokens, or full account numbers are
logged.

---

## Operational runbook

| Symptom                                          | Check                             | Action                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health/ready` returns 503                      | DB reachability / pool saturation | Check Postgres; verify `DB_POOL_MAX`; look for long-running queries                                                                                       |
| Elevated `banking_http_request_duration_seconds` | DB latency, lock contention       | Inspect `pg_stat_activity` for blocked queries; consider pool/`statement_timeout` tuning                                                                  |
| `idempotency_total{result="in_progress"}` spikes | Legit retries or a stuck request  | Usually transient; investigate long transactions                                                                                                          |
| Any `mismatchedAccounts` from reconciliation     | Should always be empty            | **Page on-call.** Investigate the account and the transactions that touched it; the ledger is the source of truth and `cached_balance` is rebuilt from it |
| `ledger` totals not equal                        | Accounting equation violated      | **Critical.** Restore from PITR into a scratch DB, reconcile, and identify the write path; the DB trigger should have prevented this                      |
| Outbox backlog growing                           | Dispatcher down                   | Check the worker; notifications are not money-path critical                                                                                               |

**Reconciliation should run on a schedule** and alert on any non-empty
mismatch list or any `Σ debits ≠ Σ credits`.

---

## Graceful shutdown

On `SIGINT`/`SIGTERM` the process stops accepting connections, lets in-flight
requests finish (`app.close()`), then drains the connection pool. A shutdown
guard makes repeated signals idempotent.

---

## Data durability & recovery

- Durability is delegated to PostgreSQL (WAL). Configure backups, **PITR**, and
  a replica at the platform layer.
- Because posted records are immutable and the ledger is append-only, recovery
  is a restore, not a reconciliation-of-truth exercise.
- **Do not** write down-migrations for financial tables. Restore from backup.

---

## Capacity notes

- The service is stateless and scales horizontally; all coordination is in
  Postgres.
- Contention is localised to the accounts being debited/credited (row locks in
  sorted order). Hot accounts serialise, which is correct and expected.
