-- Promotions Admin durable save protocol. Additive, no existing data updates,
-- no FKs or locks on promotion/redemption/finance tables, no backfill.
-- Retain this table and its tombstones during rollback. NEVER DROP/TRUNCATE
-- it as an application rollback: old identities must not become reusable.
CREATE TABLE "promotion_admin_operations" (
  "operation_id" uuid PRIMARY KEY NOT NULL,
  "actor_admin_id" integer NOT NULL,
  "method" text NOT NULL,
  "target_promotion_id" integer,
  "canonical_version" integer NOT NULL,
  "request_fingerprint" text NOT NULL,
  "expected_revision" text,
  "state" text DEFAULT 'reserved' NOT NULL,
  "terminal_outcome" text,
  "result_promotion_id" integer,
  "response_status" integer,
  "response_body" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "promotion_operations_binding_check" CHECK ((
    actor_admin_id > 0 AND canonical_version = 1 AND request_fingerprint ~ '^[a-f0-9]{64}$'
    AND ((method = 'POST' AND target_promotion_id IS NULL) OR (method IN ('PATCH','DELETE') AND target_promotion_id > 0))
  ) IS TRUE),
  CONSTRAINT "promotion_operations_state_check" CHECK ((
    (state = 'reserved' AND terminal_outcome IS NULL AND completed_at IS NULL AND response_status IS NULL AND response_body IS NULL AND result_promotion_id IS NULL) OR
    (state = 'succeeded' AND terminal_outcome = 'succeeded' AND completed_at IS NOT NULL AND response_status IN (200,201,204) AND result_promotion_id > 0 AND ((response_status = 204 AND response_body IS NULL) OR (response_status <> 204 AND response_body IS NOT NULL))) OR
    (state = 'rejected' AND terminal_outcome = 'rejected' AND completed_at IS NOT NULL AND response_status BETWEEN 400 AND 499 AND response_body IS NOT NULL AND result_promotion_id IS NULL) OR
    (state = 'expired' AND terminal_outcome IN ('succeeded','rejected','not_executed') AND completed_at IS NOT NULL AND response_body IS NULL)
  ) IS TRUE),
  CONSTRAINT "promotion_operations_response_size_check" CHECK (response_body IS NULL OR octet_length(response_body) <= 2097152)
);
--> statement-breakpoint
CREATE INDEX "promotion_operations_expiry_idx" ON "promotion_admin_operations" ("expires_at") WHERE "state" <> 'expired';
--> statement-breakpoint
-- Database protection supplements the narrowly scoped writer: binding cannot
-- be overwritten by an upsert and terminal operations cannot become reserved.
CREATE FUNCTION promotion_operation_protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Promotion operation identities must be retained' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.operation_id, NEW.actor_admin_id, NEW.method, NEW.target_promotion_id, NEW.canonical_version, NEW.request_fingerprint, NEW.expected_revision, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.operation_id, OLD.actor_admin_id, OLD.method, OLD.target_promotion_id, OLD.canonical_version, OLD.request_fingerprint, OLD.expected_revision, OLD.created_at) THEN
    RAISE EXCEPTION 'Promotion operation binding is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'expired' OR (OLD.state IN ('succeeded','rejected') AND NEW.state <> 'expired') THEN
    RAISE EXCEPTION 'Promotion operation result is terminal' USING ERRCODE = '23514';
  END IF;
  IF OLD.state IN ('succeeded','rejected') AND ROW(NEW.terminal_outcome, NEW.result_promotion_id, NEW.response_status, NEW.completed_at)
    IS DISTINCT FROM ROW(OLD.terminal_outcome, OLD.result_promotion_id, OLD.response_status, OLD.completed_at) THEN
    RAISE EXCEPTION 'Promotion operation outcome is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER promotion_operation_protect_history BEFORE UPDATE OR DELETE ON promotion_admin_operations
FOR EACH ROW EXECUTE FUNCTION promotion_operation_protect_history();
