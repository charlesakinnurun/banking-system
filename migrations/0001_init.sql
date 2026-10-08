-- =============================================================================
-- 0001_init.sql - core schema
--
-- Design notes (see DATABASE.md for the full rationale):
--   * UUID primary keys: non-enumerable, safe to expose.
--   * Money is BIGINT minor units. NEVER numeric/float.
--   * Constraints encode the rules: currencies, statuses, non-negative balances,
--     no self-transfer, immutable posted records (enforced in 0002).
--   * Indexes are added only for known query patterns (documented per index).
-- =============================================================================

CREATE TABLE ledger_accounts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL UNIQUE,
  name         text        NOT NULL,
  type         text        NOT NULL
                           CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  currency     text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  is_system    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ledger_accounts IS
  'Chart of accounts. Customer accounts map 1:1 to a liability account; system accounts (cash, fees) are is_system=true.';

CREATE TABLE customers (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text        NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name             text        NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 200),
  password_hash         text        NOT NULL,
  role                  text        NOT NULL DEFAULT 'customer'
                                    CHECK (role IN ('customer', 'support', 'admin')),
  status                text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'suspended', 'closed')),
  email_verified_at     timestamptz,
  failed_login_attempts integer     NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

COMMENT ON COLUMN customers.email IS
  'Stored lower-cased; the CHECK guarantees no case-variant duplicate can be inserted.';

CREATE TABLE refresh_tokens (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  token_hash     text        NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  replaced_by_id uuid        REFERENCES refresh_tokens (id),
  user_agent     text,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Query pattern: revoke every active token for a customer (logout-all, reuse detection).
CREATE INDEX refresh_tokens_customer_active_idx
  ON refresh_tokens (customer_id)
  WHERE revoked_at IS NULL;

CREATE TABLE accounts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          uuid        NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  ledger_account_id    uuid        NOT NULL UNIQUE REFERENCES ledger_accounts (id),
  account_number       text        NOT NULL UNIQUE CHECK (account_number ~ '^[0-9]{10}$'),
  type                 text        NOT NULL CHECK (type IN ('checking', 'savings')),
  currency             text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status               text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'frozen', 'closed')),
  cached_balance_minor bigint      NOT NULL DEFAULT 0,
  allow_overdraft      boolean     NOT NULL DEFAULT false,
  version              bigint      NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  -- Hard DB guard against overdraft/logic bugs; the ledger remains the source of truth.
  CONSTRAINT accounts_no_negative_balance
    CHECK (allow_overdraft OR cached_balance_minor >= 0)
);

-- Query pattern: list a customer's live accounts (account listing page).
CREATE INDEX accounts_customer_active_idx
  ON accounts (customer_id)
  WHERE deleted_at IS NULL;

CREATE TABLE transactions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            text        NOT NULL UNIQUE,
  type                 text        NOT NULL
                                   CHECK (type IN ('deposit', 'withdrawal', 'transfer', 'fee', 'reversal')),
  status               text        NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
  currency             text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor         bigint      NOT NULL CHECK (amount_minor > 0),
  initiated_by         uuid        NOT NULL REFERENCES customers (id),
  description          text,
  reversal_of_id       uuid        REFERENCES transactions (id),
  initiated_request_id text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  posted_at            timestamptz NOT NULL DEFAULT now()
);

-- Query pattern: a customer's transaction history across their accounts is served
-- via ledger_entries; this index supports admin/ops lookups by initiator + time.
CREATE INDEX transactions_initiated_by_created_idx
  ON transactions (initiated_by, created_at DESC);

CREATE TABLE idempotency_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  endpoint        text        NOT NULL,
  key             text        NOT NULL,
  request_hash    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'in_progress'
                              CHECK (status IN ('in_progress', 'completed')),
  response_status integer,
  response_body   jsonb,
  transaction_id  uuid        REFERENCES transactions (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT idempotency_keys_scope_unique UNIQUE (customer_id, endpoint, key)
);

-- Query pattern: garbage-collect expired keys.
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);

CREATE TABLE ledger_entries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    uuid        NOT NULL REFERENCES transactions (id),
  ledger_account_id uuid        NOT NULL REFERENCES ledger_accounts (id),
  direction         text        NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor      bigint      NOT NULL CHECK (amount_minor > 0),
  currency          text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- A given leg (txn, account, side) may only be posted once.
  CONSTRAINT ledger_entries_leg_unique UNIQUE (transaction_id, ledger_account_id, direction)
);

-- Query pattern: derive an account balance / build a statement (sum + range scan).
CREATE INDEX ledger_entries_account_created_idx
  ON ledger_entries (ledger_account_id, created_at);

-- Query pattern: load all legs of one transaction (reversal, audit, reconciliation).
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);

CREATE TABLE transfers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid        NOT NULL UNIQUE REFERENCES transactions (id),
  from_account_id uuid        NOT NULL REFERENCES accounts (id),
  to_account_id   uuid        NOT NULL REFERENCES accounts (id),
  amount_minor    bigint      NOT NULL CHECK (amount_minor > 0),
  fee_minor       bigint      NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  currency        text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfers_distinct_accounts CHECK (from_account_id <> to_account_id)
);

-- Query pattern: "transfers to/from this account" for a scoped history view.
CREATE INDEX transfers_from_account_idx ON transfers (from_account_id, created_at DESC);
CREATE INDEX transfers_to_account_idx   ON transfers (to_account_id, created_at DESC);

CREATE TABLE beneficiaries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  name           text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  account_number text        NOT NULL CHECK (account_number ~ '^[0-9]{10}$'),
  bank_code      text        NOT NULL CHECK (bank_code ~ '^[A-Z0-9]{3,11}$'),
  currency       text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT beneficiaries_unique_per_customer UNIQUE (customer_id, account_number, bank_code)
);

CREATE INDEX beneficiaries_customer_active_idx
  ON beneficiaries (customer_id)
  WHERE deleted_at IS NULL;

CREATE TABLE notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  transaction_id uuid        REFERENCES transactions (id),
  type           text        NOT NULL,
  channel        text        NOT NULL DEFAULT 'in_app',
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts       integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text,
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- At-least-once delivery + this unique key => effectively-once notifications.
  CONSTRAINT notifications_txn_type_unique UNIQUE (transaction_id, type)
);

-- Query pattern: worker claims pending notifications, oldest first.
CREATE INDEX notifications_pending_idx
  ON notifications (created_at)
  WHERE status = 'pending';

-- Query pattern: a customer's in-app inbox.
CREATE INDEX notifications_customer_idx ON notifications (customer_id, created_at DESC);

CREATE TABLE audit_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        REFERENCES customers (id),
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   text,
  request_id  text,
  ip          inet,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Query pattern: "prove what happened to this entity" (incident / audit).
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at DESC);
-- Query pattern: "everything this actor did".
CREATE INDEX audit_events_actor_idx  ON audit_events (actor_id, created_at DESC);
