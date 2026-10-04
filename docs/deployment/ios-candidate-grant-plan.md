# Proposed grants and runtime configuration — documentation only

No grants, role changes, variables, or production database access were performed during candidate preparation. Reconfirm actual effective roles at deployment preflight. The previous read-only production gate identified API and Worker as `central_runtime` and migrations as `central_migrator`; both runtime services share one privilege union.

## Required access derived from merged code

| Table | API | Worker |
| --- | --- | --- |
| apple_credentials | SELECT, INSERT, update encrypted envelope/ownership/lifecycle | SELECT, update retry state, DELETE expired/revoked credentials |
| apple_auth_challenges | INSERT, DELETE with RETURNING, expiry cleanup; SELECT for returned/filter columns | None |
| customer_deletion_requests | SELECT, INSERT, update proof/lifecycle/revocation state | SELECT, update pending/completed/blocker/revocation state |
| notification_delivery_logs | Existing SELECT/INSERT | SELECT and UPDATE only the seven outcome/receipt columns below |
| notification_devices | Existing registration/logout and deletion behavior | SELECT/row locking; update is_active for stale-token retirement; deletion reconciliation also updates unregister_secret_hash |

`SELECT FOR UPDATE` needs UPDATE on at least one selected-table column, not an unrestricted table UPDATE. The receipt-column grant therefore supports the lease/row-lock query. See [PostgreSQL SELECT privileges](https://www.postgresql.org/docs/16/sql-select.html).

## Proposed SQL — do not execute during Phase 2

Apply only after the three new tables/receipt columns exist, with the authorized migration/grant role, before new API/Worker jobs can run. Existing default grants give new tables runtime CRUD; tighten only these new lifecycle tables. No ownership, superuser, schema-default, or historical business-table changes are proposed.

```sql
BEGIN;

REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER
  ON public.apple_credentials FROM central_runtime;
GRANT SELECT, INSERT, DELETE ON public.apple_credentials TO central_runtime;
GRANT UPDATE (student_id, ciphertext, iv, auth_tag, key_version,
              state, attempts, expires_at, retry_at, updated_at)
  ON public.apple_credentials TO central_runtime;

REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER
  ON public.apple_auth_challenges FROM central_runtime;
GRANT SELECT, INSERT, DELETE ON public.apple_auth_challenges TO central_runtime;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.customer_deletion_requests FROM central_runtime;
GRANT SELECT, INSERT ON public.customer_deletion_requests TO central_runtime;
GRANT UPDATE (proof_hash, proof_expires_at, token_version, updated_at,
              status, workflow_id, requested_at, completed_at, blockers,
              apple_revocation)
  ON public.customer_deletion_requests TO central_runtime;

REVOKE UPDATE, DELETE, TRUNCATE ON public.notification_delivery_logs
  FROM central_runtime;
GRANT SELECT, INSERT ON public.notification_delivery_logs TO central_runtime;
GRANT UPDATE (receipt_next_check_at, receipt_attempts, receipt_status,
              receipt_checked_at, status, error_code, error_message)
  ON public.notification_delivery_logs TO central_runtime;

COMMIT;
```

This plan must also verify no inherited role or previously granted column privilege bypasses these boundaries. It was derived statically and was not executed, including on the disposable database, under the explicit no-grant-execution instruction.

### Notification-device privilege verification

Existing role setup grants runtime UPDATE on ordinary tables, including devices, and the accepted API requires existing device registration/logout behavior. Do not revoke those pre-existing privileges as part of this release. The prior live preflight did not separately measure effective device-column privileges, and this preparation phase must not contact production. Before deployment, verify:

```sql
SELECT has_column_privilege('central_runtime',
  'public.notification_devices', 'is_active', 'UPDATE') AS stale_retirement_allowed,
  has_column_privilege('central_runtime',
  'public.notification_devices', 'unregister_secret_hash', 'UPDATE') AS deletion_revocation_allowed;
```

If missing, add only `GRANT UPDATE (is_active, unregister_secret_hash)` on devices to the actual runtime role after checking existing API requirements. No additional grant is needed when effective existing UPDATE already covers them. A distinct future Worker DB role would instead receive the subset needed by Worker; do not invent or create that role in this task.

## Secret-name requirements

API and Worker both require:

- APPLE_CLIENT_ID
- APPLE_TEAM_ID
- APPLE_KEY_ID
- APPLE_PRIVATE_KEY
- THIRD_PARTY_TOKEN_ENCRYPTION_KEY
- THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION
- THIRD_PARTY_TOKEN_PREVIOUS_ENCRYPTION_KEYS

API authenticates Apple and stores encrypted refresh credentials. Worker `reconcileCustomerDeletions` calls `reconcileAppleRevocations`, which decrypts persisted credentials and signs Apple client secrets; it cannot complete Apple revocation without the same Apple/keyring configuration. Preserve current v2 and previous v1. Do not copy these secrets to the migrator or backup service.

The migration runner requires its existing MIGRATION_DATABASE_URL; it does not read Apple or encryption variables. QUEUE_WORKER_ENABLED=true makes the Worker pre-deploy runner skip schema work. Both runtime services retain existing DATABASE_URL, Redis/BullMQ, and application-specific configuration; migration credentials must continue to be removed before application startup.
