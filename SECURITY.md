# Security

Security is a first-class requirement here: this system moves money. This
document describes the threat model, the controls that are implemented, and the
honest gaps.

---

## Reporting a vulnerability

Please **do not** open a public issue. Email
[charlesakinnurun@gmail.com](mailto:charlesakinnurun@gmail.com) with a
description and reproduction. We aim to acknowledge within 72 hours. Do not
test against systems you do not own.

---

## Threat model

**Assets:** customer funds and balances, credentials and tokens, PII (emails,
names), the integrity of the ledger, and the audit trail.

**Adversaries considered:**

- An unauthenticated attacker (enumeration, brute force, injection).
- An authenticated customer attempting privilege escalation, IDOR, or to
  tamper with balances/targets.
- A malicious or buggy client (spoofed amounts, replayed requests).
- A compromised application role (must not be able to rewrite history).

**Trust boundaries:** the client sends _intent_ only (amount, source, target).
It never sends a balance, a ledger entry, an id, or a status it can forge into a
financial outcome. Everything is re-resolved and re-validated server-side.

---

## Controls

### Authentication

- **Passwords:** `scrypt` (N=2^14, r=8, p=1) with a per-user 16-byte random salt
  and `timingSafeEqual` comparison. Parameters are embedded in the encoded hash,
  enabling future rehash-on-login. See [ADR-0006](DECISIONS.md).
- **Access tokens:** short-lived (15 min) HS256 JWT signed and verified by a
  single, tested implementation. The `alg` header is checked (no `none`/asym
  confusion). See [ADR-0007](DECISIONS.md).
- **Refresh tokens:** 32-byte opaque values, **stored hashed** (`sha256`), with
  rotation and **reuse detection**: presenting a rotated token revokes the whole
  family. Revocation is committed even though the client receives `401`.
- **Brute-force protection:** per-account failed-attempt counters and lockout,
  plus a strict per-route rate limit on `/v1/auth/login` (20/min) and
  `/v1/auth/register` (10/min). Failed-attempt writes are committed (they are not
  rolled back by the `401`).

### Authorization (RBAC)

| Capability                                                               | customer | support | admin |
| ------------------------------------------------------------------------ | :------: | :-----: | :---: |
| Register / log in / refresh                                              |    ✅    |   ✅    |  ✅   |
| Read/operate **own** accounts, statements, transfers, beneficiaries      |    ✅    |    –    |  ✅   |
| Read any customer's accounts/transactions                                |    –     |   ✅    |  ✅   |
| List customers                                                           |    –     |   ✅    |  ✅   |
| Freeze/unfreeze accounts; reverse transactions; reconcile; change status |    –     |    –    |  ✅   |

Ownership is enforced in the application layer: a customer accessing another
customer's account receives **404** (not 403), so resource existence is not
disclosed.

### Input validation & injection

- Every request is validated against a JSON Schema at the edge (types, enums,
  patterns, lengths, formats). Unknown currencies are rejected.
- **All SQL is parameterised**; no string interpolation of user input anywhere.
  A dedicated security test sends SQL-injection-shaped input and asserts the
  response is a clean `4xx`, never a `500` or a database error.
- `bigint` amounts are parsed from validated digit-only strings.

### Transport & headers

- **Helmet** sets `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
  `Strict-Transport-Security` (behind TLS), and related headers.
- **CORS** is deny-by-default: allowed origins come from `CORS_ORIGINS`; empty
  disables cross-origin browser access. Credentials are not used.
- **Body size limit** (128 KB) and `statement_timeout` bound resource abuse.

### Secrets & configuration

- **No secrets in the repository.** `.env` is git-ignored; `.env.example`
  documents every variable. Environment is parsed and validated at boot
  (`JWT_SECRET` must be ≥ 32 chars), failing fast on misconfiguration.
- Logging is redacted at the boundary: `password`, `passwordHash`, `token`,
  `accessToken`, `refreshToken`, `authorization`, cookies.

### Data protection

- Only the last 4 digits of account numbers are used in audit/notification
  payloads and logs.
- Audit `metadata` contains ids and amounts needed for forensics, never full
  credentials or unnecessary PII.
- Refresh tokens are never logged and are stored hashed.

### Integrity & auditability

- Posted ledger entries, transactions, and audit events are **immutable at the
  database level** (triggers reject `UPDATE`/`DELETE`), so a compromised
  application role cannot silently rewrite history.
- Every state change writes an `audit_events` row in the **same transaction**.

---

## Explicit limitations (be honest, then improve)

| Gap                                                             | Mitigation / path to production                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Registration reveals taken emails** (`403`)                   | Documented tradeoff for usability. Production: generic `202` + email verification. Login is already enumeration-resistant. |
| **No MFA / step-up auth / device binding**                      | Add TOTP/WebAuthn and re-auth for high-risk operations.                                                                    |
| **No KYC/AML, sanctions/PEP screening, transaction monitoring** | Regulatory subsystems; the risk-engine port is the integration point.                                                      |
| **Access tokens not individually revocable**                    | ≤ 15-minute exposure window; revoke at refresh. A denylist/idle-timeout could tighten it.                                  |
| **`/docs` and `/metrics` are open**                             | Bind behind an internal gateway / auth proxy in production.                                                                |
| **No password breach-list check**                               | Add a k-anonymity range check (e.g. HIBP) at registration.                                                                 |
| **Risk engine is rule-based**                                   | Explainable by design; an ML scorer can implement the same `RiskEngine` port.                                              |
| **No CSRF tokens**                                              | The API is token-based and does not use cookies; if cookie auth is added, add CSRF protection.                             |

---

## Secure development

- Dependencies are scanned in CI (`npm audit --audit-level=high`).
- The quality gate (`npm run verify`) must be green before merge; see
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Security-relevant changes (auth, crypto, ledger, idempotency) require a
  second reviewer and an ADR when they alter a decision.
