# API Reference

Base URL: `/` (e.g. `http://localhost:3000`). All request/response bodies are
JSON. Interactive documentation is served at **`/docs`**; the OpenAPI document
is generated with `npm run openapi` into `openapi.json`.

---

## Conventions

### Money

Amounts are **integer minor units** as strings — never floating point, never
decimals on the wire:

```json
{ "amountMinor": "10000", "currency": "USD" } // 100.00 USD
```

`10000` is exactly 100.00 USD. `JPY` has 0 decimals (`"1000"` = ¥1000); `BHD`
has 3. Unsupported currencies are rejected with `400`.

### Errors

Every error uses one envelope:

```json
{
  "error": {
    "code": "insufficient_funds",
    "message": "Insufficient funds",
    "requestId": "0f5c…",
    "details": { "accountId": "…" }
  }
}
```

| HTTP | `code` examples                                                                 | Meaning                                                 |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 400  | `validation_error`, `idempotency_key_required`                                  | Malformed request                                       |
| 401  | `unauthorized`                                                                  | Missing/invalid/expired token, or bad credentials       |
| 403  | `forbidden`                                                                     | Authenticated but not permitted                         |
| 404  | `not_found`                                                                     | Missing, or intentionally hidden to prevent enumeration |
| 409  | `conflict`, `insufficient_funds`, `idempotency_in_progress`                     | State conflict                                          |
| 422  | `idempotency_key_reuse`, `currency_mismatch`, `risk_rejected`, `account_frozen` | Business rule violation                                 |
| 429  | `rate_limited`                                                                  | Too many requests                                       |
| 503  | `service_unavailable`                                                           | Dependency unavailable (e.g. DB)                        |

Unknown failures return a generic `500`; internal detail is logged, never
returned. Every response carries an `x-request-id` header (echoing an inbound
`x-request-id` when provided) for correlation.

### Authentication

`Authorization: Bearer <accessToken>`. Access tokens are short-lived JWTs
(15 min default). Obtain a pair from `register`/`login` and refresh with
`/v1/auth/refresh` (refresh tokens rotate; reuse revokes the whole family).

### Idempotency

Money-movement endpoints (`deposit`, `withdraw`, `transfers`, admin `reverse`)
**require** an `Idempotency-Key` header (≥ 8 chars). Semantics:

- Same key + same body → the original response is **replayed**; money does **not**
  move again.
- Same key + different body → `422 idempotency_key_reuse`.
- A concurrent duplicate → `409 idempotency_in_progress` (or the replay, once the
  first commits).
- Keys expire after `IDEMPOTENCY_TTL_HOURS` (default 24h).

### Rate limiting

Global default from `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`; `register`
(10/min) and `login` (20/min) are stricter. Responses include
`ratelimit-limit`/`ratelimit-remaining` headers.

---

## Endpoints

### Auth

#### `POST /v1/auth/register` → `201`

```json
{ "email": "ada@example.com", "fullName": "Ada Lovelace", "password": "Password-123!" }
```

Response: `{ "customer": { … }, "tokens": { "tokenType", "accessToken", "expiresInSeconds", "refreshToken", "refreshExpiresAt" } }`.
`403` if the email is taken (documented tradeoff; login is enumeration-safe).

#### `POST /v1/auth/login` → `200`

```json
{ "email": "ada@example.com", "password": "Password-123!" }
```

Returns the same `{ customer, tokens }` shape. `401` on bad credentials
(identical for a wrong password and an unknown email).

#### `POST /v1/auth/refresh` → `200`

```json
{ "refreshToken": "…" }
```

Returns a fresh `tokens` object; the presented token is revoked and replaced.
Reusing a revoked token returns `401` and revokes the family.

#### `POST /v1/auth/logout` → `200`

Revokes a refresh token (idempotent). Body: `{ "refreshToken": "…" }`.

#### `POST /v1/auth/logout-all` → `200` (auth required)

Revokes every refresh token for the caller.

### Customers & accounts

#### `GET /v1/me` → `200` (auth)

`{ "id", "email", "fullName", "role", "status", "createdAt" }`.

#### `GET /v1/me/accounts` → `200` (auth)

`{ "items": [ account… ] }`.

#### `POST /v1/accounts` → `201` (auth; role `customer`|`admin`)

```json
{ "type": "checking", "currency": "USD" }
```

Response:

```json
{
  "id": "…",
  "customerId": "…",
  "accountNumber": "0000000001",
  "type": "checking",
  "currency": "USD",
  "status": "active",
  "balance": { "amountMinor": "0", "currency": "USD" },
  "createdAt": "…"
}
```

#### `GET /v1/accounts/:id` → `200` (auth, owner or staff)

Returns the account with its current balance.

#### `GET /v1/accounts/:id/statement?from=&to=&limit=` → `200` (auth, owner or staff)

```json
{
  "account": { … },
  "openingBalance": { "amountMinor": "0", "currency": "USD" },
  "closingBalance": { "amountMinor": "7500", "currency": "USD" },
  "entries": [ { "entryId", "transactionId", "type", "reference", "direction",
                 "amount", "signedAmount", "description", "createdAt" } ]
}
```

### Transactions

#### `POST /v1/transactions/deposit` → `201` (auth; **Idempotency-Key required**)

```json
{ "accountId": "…", "amountMinor": "10000", "currency": "USD", "description": "optional" }
```

Response:

```json
{
  "transaction": { "id", "reference", "type": "deposit", "status": "posted",
                   "amount": { "amountMinor": "10000", "currency": "USD" }, "createdAt" },
  "affectedAccounts": [ { "accountId": "…", "balance": { "amountMinor": "10000", "currency": "USD" } } ]
}
```

#### `POST /v1/transactions/withdraw` → `201`

Same body/response shape. `409 insufficient_funds` if the account would overdraw;
`422 risk_rejected` if a risk rule blocks it.

#### `POST /v1/transfers` → `201` (auth; **Idempotency-Key required**)

```json
{
  "fromAccountId": "…",
  "toAccountNumber": "0000000002",
  "amountMinor": "2500",
  "currency": "USD",
  "note": "rent"
}
```

`422 currency_mismatch` if source and destination currencies differ;
`400` if source equals destination.

#### `GET /v1/transactions/:id` → `200` (auth; initiator or staff)

### Beneficiaries (auth)

| Method   | Path                    | Purpose                                                                                          |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/v1/beneficiaries`     | List active beneficiaries                                                                        |
| `POST`   | `/v1/beneficiaries`     | Create (`name`, `accountNumber` (10 digits), `bankCode`, `currency`) → `201`; `409` if duplicate |
| `DELETE` | `/v1/beneficiaries/:id` | Archive → `204`                                                                                  |

### Admin (role `admin`; `support` may read customers)

| Method | Path                                         | Purpose                                                             |
| ------ | -------------------------------------------- | ------------------------------------------------------------------- |
| `GET`  | `/v1/admin/customers?limit=&offset=&search=` | List customers                                                      |
| `POST` | `/v1/admin/accounts/:id/freeze`              | Freeze an account                                                   |
| `POST` | `/v1/admin/accounts/:id/unfreeze`            | Reactivate an account                                               |
| `POST` | `/v1/admin/transactions/:id/reverse`         | Post a compensating reversal (**Idempotency-Key required**) → `201` |
| `GET`  | `/v1/admin/reconciliation`                   | Global balance check + drift list                                   |
| `GET`  | `/v1/admin/accounts/:id/reconcile`           | Single-account ledger check vs. cached balance                      |

### Operations

| Method | Path            | Purpose                                      |
| ------ | --------------- | -------------------------------------------- |
| `GET`  | `/health/live`  | Liveness — process is up                     |
| `GET`  | `/health/ready` | Readiness — database reachable (`200`/`503`) |
| `GET`  | `/metrics`      | Prometheus metrics (if `METRICS_ENABLED`)    |

---

## Complete example

```bash
BASE=http://localhost:3000

TOKENS=$(curl -s $BASE/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","fullName":"Ada Lovelace","password":"Password-123!"}')
TOKEN=$(echo "$TOKENS" | jq -r .tokens.accessToken)

ACCOUNT=$(curl -s $BASE/v1/accounts -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"type":"checking","currency":"USD"}' | jq -r .id)

KEY=$(uuidgen)
curl -s $BASE/v1/transactions/deposit -H "authorization: Bearer $TOKEN" \
  -H "idempotency-key: $KEY" -H 'content-type: application/json' \
  -d "{\"accountId\":\"$ACCOUNT\",\"amountMinor\":\"10000\",\"currency\":\"USD\"}"

# Retrying with the SAME key replays the response and moves no additional money:
curl -s $BASE/v1/transactions/deposit -H "authorization: Bearer $TOKEN" \
  -H "idempotency-key: $KEY" -H 'content-type: application/json' \
  -d "{\"accountId\":\"$ACCOUNT\",\"amountMinor\":\"10000\",\"currency\":\"USD\"}"
```
