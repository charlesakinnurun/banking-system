-- =============================================================================
-- 0002_integrity.sql - integrity triggers
--
-- These move correctness guarantees into the database so that a bug in the
-- application cannot silently corrupt financial state. They are the physical
-- enforcement of the invariants documented in LEDGER.md.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER ledger_accounts_set_updated_at
  BEFORE UPDATE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER notifications_set_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER idempotency_keys_set_updated_at
  BEFORE UPDATE ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Invariant: posted financial records are IMMUTABLE.
--
-- Ledger entries, posted transactions, and audit events may never be updated or
-- deleted. Corrections are new compensating transactions. Enforced in the DB so
-- it holds even against a buggy or compromised application role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'record in % is immutable (attempted %)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Invariant: every transaction's ledger entries balance (sum of debits == sum of credits).
--
-- A CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED, so the check runs once at
-- COMMIT after all legs of the transaction have been inserted. This is the last
-- line of defence: even if application logic is wrong, an unbalanced
-- transaction can never be committed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_transaction_balanced()
RETURNS trigger AS $$
DECLARE
  txn_id  uuid;
  debits  bigint;
  credits bigint;
BEGIN
  txn_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)
  INTO debits, credits
  FROM ledger_entries
  WHERE transaction_id = txn_id;

  IF debits <> credits THEN
    RAISE EXCEPTION
      'ledger transaction % is not balanced (debits=%, credits=%)', txn_id, debits, credits
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();
