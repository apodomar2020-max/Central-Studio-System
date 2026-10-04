CREATE TABLE IF NOT EXISTS customer_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id integer NOT NULL UNIQUE REFERENCES students(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'proof' CHECK (status IN ('proof','pending','completed')),
  proof_hash text, proof_expires_at timestamptz, token_version integer NOT NULL,
  workflow_id integer REFERENCES student_deletion_workflows(id) ON DELETE RESTRICT,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  apple_revocation text NOT NULL DEFAULT 'not_applicable' CHECK (apple_revocation IN ('not_applicable','pending','revoked','manual_required')),
  policy_version text NOT NULL DEFAULT '1', requested_at timestamptz, completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_deletion_pending_idx ON customer_deletion_requests(status,updated_at);
