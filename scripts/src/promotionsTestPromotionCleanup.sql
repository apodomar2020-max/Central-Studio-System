-- OWNER APPROVAL REQUIRED. Exact obsolete test record only; never a migration.
-- Run after 0137, with all promotion/checkout writers paused and backup verified.
-- psql operators must use ON_ERROR_STOP=1. On ANY error: ROLLBACK, stop, no retry.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '500ms';
SET LOCAL idle_in_transaction_session_timeout = '15s';
SET LOCAL transaction_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;
LOCK TABLE public.promotions, public.promotion_codes,
  public.promotion_redemptions, public.promotion_audit_logs,
  public.admin_activity_logs, public.promotion_admin_operations
  IN SHARE ROW EXCLUSIVE MODE;

DO $cleanup$
DECLARE
  owned_codes integer[];
  affected integer;
BEGIN
  -- A generic database name is not a service identity. Operator must also
  -- verify the authenticated service/certificate before sending this script.
  IF current_database() <> 'railway'
      AND current_database() NOT LIKE 'promotions_final_release%disposable' THEN
    RAISE EXCEPTION 'Wrong cleanup database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.promotions WHERE id=3 AND type='manual') THEN
    RAISE EXCEPTION 'Expected manual test promotion 3 missing or changed';
  END IF;
  SELECT array_agg(id ORDER BY id) INTO owned_codes FROM public.promotion_codes WHERE promotion_id=3;
  IF owned_codes IS DISTINCT FROM ARRAY[2,3,6,7] THEN
    RAISE EXCEPTION 'Exact test code ownership set changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promotion_codes WHERE id=ANY(owned_codes) AND current_uses<>0) THEN
    RAISE EXCEPTION 'Test code usage changed';
  END IF;
  -- Fail closed on unexpected FK definitions, including cascading dependencies.
  -- Four definitions below are the complete references in the reviewed schema.
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE contype='f'
      AND confrelid IN ('public.promotions'::regclass,'public.promotion_codes'::regclass)) <> 4
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.contype='f'
      AND c.confrelid IN ('public.promotions'::regclass,'public.promotion_codes'::regclass)
      AND NOT (
        (c.conrelid='public.promotion_codes'::regclass AND pg_get_constraintdef(c.oid)=
          'FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE') OR
        (c.conrelid='public.promotion_redemptions'::regclass AND pg_get_constraintdef(c.oid)=
          'FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT') OR
        (c.conrelid='public.promotion_redemptions'::regclass AND pg_get_constraintdef(c.oid)=
          'FOREIGN KEY (promotion_code_id) REFERENCES promotion_codes(id) ON DELETE SET NULL') OR
        (c.conrelid='public.promotion_audit_logs'::regclass AND pg_get_constraintdef(c.oid)=
          'FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE SET NULL')
      )) THEN
    RAISE EXCEPTION 'Unreviewed promotion/code foreign key dependency';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE NOT tgisinternal
      AND tgrelid IN ('public.promotions'::regclass,'public.promotion_codes'::regclass)) THEN
    RAISE EXCEPTION 'Unreviewed promotion/code trigger';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promotion_redemptions
      WHERE promotion_id=3 OR promotion_code_id=ANY(owned_codes))
    OR EXISTS (SELECT 1 FROM public.promotion_audit_logs WHERE promotion_id=3)
    OR EXISTS (SELECT 1 FROM public.admin_activity_logs WHERE module='promotions' AND
      ((entity_type='promotion' AND entity_id='3') OR
       (entity_type='promotion_code' AND entity_id IN ('2','3','6','7'))))
    OR EXISTS (SELECT 1 FROM public.promotion_admin_operations
      WHERE target_promotion_id=3 OR result_promotion_id=3) THEN
    RAISE EXCEPTION 'History dependency present; preserve it and use audited deactivation';
  END IF;
  DELETE FROM public.promotion_codes WHERE promotion_id=3 AND id=ANY(owned_codes);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected<>4 THEN RAISE EXCEPTION 'Unexpected deleted code count'; END IF;
  DELETE FROM public.promotions WHERE id=3;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Unexpected deleted promotion count'; END IF;
END $cleanup$;
COMMIT;
