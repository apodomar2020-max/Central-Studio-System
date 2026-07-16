-- Migration 0068: Ballet cancellation requests and refund ledger.
-- Defines history-preserving enrollment withdrawal and refund records.

CREATE TABLE IF NOT EXISTS ballet_enrollment_cancellation_requests (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES ballet_applications(id) ON DELETE RESTRICT,
  level_assignment_id integer NOT NULL REFERENCES ballet_level_assignments(id) ON DELETE RESTRICT,
  child_id integer REFERENCES children(id) ON DELETE SET NULL,
  parent_student_id integer REFERENCES students(id) ON DELETE SET NULL,
  initiated_by_type text NOT NULL DEFAULT 'parent',
  -- RESTRICT (not SET NULL): an admin-initiated row's admin id must stay
  -- non-null per the combination check below, so nulling it on admin-user
  -- deletion would just make the DELETE fail with a confusing constraint
  -- error instead of a clear "this admin has cancellation history" signal.
  initiated_by_admin_id integer REFERENCES system_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pendingReview',
  requested_timing text NOT NULL,
  approved_timing text,
  requested_effective_date text,
  approved_effective_date text,
  reason text NOT NULL,
  request_refund boolean NOT NULL DEFAULT false,
  admin_notes text,
  reviewed_by_admin_id integer REFERENCES system_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  withdrawn_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ballet_enrollment_cancellation_status_check CHECK (status IN ('pendingReview','approved','rejected','withdrawnByParent','completed')),
  CONSTRAINT ballet_enrollment_cancellation_requested_timing_check CHECK (requested_timing IN ('immediate','endOfPeriod')),
  CONSTRAINT ballet_enrollment_cancellation_approved_timing_check CHECK (approved_timing IS NULL OR approved_timing IN ('immediate','endOfPeriod')),
  -- Combination check: a parent-initiated row must carry a null admin id, an
  -- admin-initiated row must carry a non-null admin id. Any other
  -- initiated_by_type value fails both OR branches, so this subsumes a plain
  -- "IN ('parent','admin')" enum check too.
  CONSTRAINT ballet_enrollment_cancellation_initiator_combination_check CHECK (
    (initiated_by_type = 'parent' AND initiated_by_admin_id IS NULL)
    OR
    (initiated_by_type = 'admin' AND initiated_by_admin_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ballet_enrollment_cancellation_open_assignment_idx
  ON ballet_enrollment_cancellation_requests(level_assignment_id)
  WHERE level_assignment_id IS NOT NULL AND status IN ('pendingReview','approved');

CREATE INDEX IF NOT EXISTS ballet_enrollment_cancellation_application_idx
  ON ballet_enrollment_cancellation_requests(application_id);

CREATE INDEX IF NOT EXISTS ballet_enrollment_cancellation_parent_idx
  ON ballet_enrollment_cancellation_requests(parent_student_id);

CREATE INDEX IF NOT EXISTS ballet_enrollment_cancellation_status_idx
  ON ballet_enrollment_cancellation_requests(status);

CREATE TABLE IF NOT EXISTS ballet_refunds (
  id serial PRIMARY KEY,
  cancellation_request_id integer REFERENCES ballet_enrollment_cancellation_requests(id) ON DELETE SET NULL,
  application_id integer NOT NULL REFERENCES ballet_applications(id) ON DELETE RESTRICT,
  level_assignment_id integer REFERENCES ballet_level_assignments(id) ON DELETE SET NULL,
  payment_id integer NOT NULL REFERENCES ballet_payments(id) ON DELETE RESTRICT,
  parent_student_id integer REFERENCES students(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'underReview',
  refund_method text NOT NULL,
  requested_reason text NOT NULL,
  requested_amount_egp integer,
  approved_amount_egp integer,
  refunded_amount_egp integer,
  transaction_reference text,
  admin_notes text,
  failed_reason text,
  reviewed_by_admin_id integer REFERENCES system_users(id) ON DELETE SET NULL,
  processed_by_admin_id integer REFERENCES system_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ballet_refunds_requested_amount_positive CHECK (requested_amount_egp IS NULL OR requested_amount_egp > 0),
  CONSTRAINT ballet_refunds_approved_amount_positive CHECK (approved_amount_egp IS NULL OR approved_amount_egp > 0),
  CONSTRAINT ballet_refunds_refunded_amount_positive CHECK (refunded_amount_egp IS NULL OR refunded_amount_egp > 0),
  CONSTRAINT ballet_refunds_status_check CHECK (status IN ('underReview','approved','rejected','processing','refunded','failed','withdrawn')),
  CONSTRAINT ballet_refunds_supported_method CHECK (refund_method IN ('cash','originalPaymentMethod'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ballet_refunds_open_payment_idx
  ON ballet_refunds(payment_id)
  WHERE status IN ('underReview','approved','processing');

CREATE INDEX IF NOT EXISTS ballet_refunds_cancellation_request_idx
  ON ballet_refunds(cancellation_request_id);

CREATE INDEX IF NOT EXISTS ballet_refunds_application_idx
  ON ballet_refunds(application_id);

CREATE INDEX IF NOT EXISTS ballet_refunds_payment_idx
  ON ballet_refunds(payment_id);

CREATE INDEX IF NOT EXISTS ballet_refunds_status_idx
  ON ballet_refunds(status);

ALTER TABLE ballet_level_assignments
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawal_effective_date text,
  ADD COLUMN IF NOT EXISTS withdrawal_reason text,
  ADD COLUMN IF NOT EXISTS withdrawn_by_admin_id integer REFERENCES system_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS withdrawn_by_cancellation_request_id integer REFERENCES ballet_enrollment_cancellation_requests(id) ON DELETE SET NULL;

ALTER TABLE ballet_level_assignments
  DROP CONSTRAINT IF EXISTS ballet_level_assignments_application_id_ballet_applications_id_fk,
  DROP CONSTRAINT IF EXISTS ballet_level_assignments_application_id_fkey,
  ADD CONSTRAINT ballet_level_assignments_application_id_ballet_applications_id_fk
    FOREIGN KEY (application_id) REFERENCES ballet_applications(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE attendance
  DROP CONSTRAINT IF EXISTS attendance_ballet_level_assignment_id_ballet_level_assignments_id_fk,
  ADD CONSTRAINT attendance_ballet_level_assignment_id_ballet_level_assignments_id_fk
    FOREIGN KEY (ballet_level_assignment_id) REFERENCES ballet_level_assignments(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

DROP INDEX IF EXISTS ballet_applications_active_per_child;
DROP INDEX IF EXISTS ballet_applications_active_per_manual_identity;

CREATE UNIQUE INDEX IF NOT EXISTS ballet_applications_active_per_child
  ON ballet_applications(child_id)
  WHERE child_id IS NOT NULL AND status IN ('pending','needsFollowUp','accepted','assignedToLevel','active');

CREATE UNIQUE INDEX IF NOT EXISTS ballet_applications_active_per_manual_identity
  ON ballet_applications(parent_student_id, lower(trim(child_name)), child_birthday)
  WHERE child_id IS NULL AND status IN ('pending','needsFollowUp','accepted','assignedToLevel','active');
