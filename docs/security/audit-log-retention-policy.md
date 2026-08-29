# Audit log retention policy

Status: ADOPTED. Adopted 2026-08-30. Owner: production security owner (see
"Ownership and recovery targets" in [final-hardening-operations.md](./final-hardening-operations.md)).
Review cadence: annually, or immediately when legal/business requirements change
materially.

This document records retention intent only. **No purge job exists today and
nothing has been deleted.** Implementing the purge is a separate, approved
maintenance change (see "Future purge model" below).

This document contains dataset and configuration names only. Never paste
customer records, credential values, or log row contents into it.

## Scope

Three audit datasets are in scope. All three are append-only in production: the
`central_runtime` role holds `SELECT, INSERT` only, with `UPDATE, DELETE,
TRUNCATE` explicitly revoked (`scripts/security/configure-database-roles.sql`).
No application code path updates or deletes rows in any of them.

| Dataset | Purpose | PII | Finance/legal evidence | Detailed retention | Rationale |
| --- | --- | --- | --- | --- | --- |
| `admin_activity_logs` | Admin accountability: one row per sensitive admin mutation (actor, action, module, entity, redacted before/after diff, IP, user agent). | Yes — admin (staff) identity, IP, user agent. Not customer PII by design; entity labels may name a customer record. | Indirect. Establishes who changed what. | **24 months searchable** | Security investigation and admin accountability need a window wide enough to cover a full annual cycle plus late discovery. Volume is bounded by admin action rate, not customer traffic. |
| `promotion_audit_logs` | Promotion lifecycle accountability: created / updated / deactivated, actor admin id, minimal metadata (`name`, `type`, changed field *names*). | Minimal — actor admin id only. No customer identity, no amounts. | Possibly. Discount configuration can be an input to revenue reconciliation. | **24 months minimum searchable** | Same accountability window as admin audit. Where a row forms part of financial or tax evidence, retain or archive it under the applicable financial-record requirement rather than purging on this technical schedule alone. |
| `notification_delivery_logs` | Per-device push delivery outcome: notification/student/device foreign keys, channel, provider, status, provider message id, error code/message. | Yes, indirectly — links a student id to a device id and a delivery time. Provider error text may echo the device's Expo push token. | No. | **90 days detailed** | Operationally useful only for recent delivery debugging and dead-token pruning. Highest-growth dataset of the three: it grows with campaign fan-out (rows ≈ notifications × active devices), not with admin activity. Longer-lived aggregate delivery metrics may be retained separately. |

After the detailed window expires, `notification_delivery_logs` rows become
eligible for deletion **only** if no unresolved incident or legal hold covers
them. Aggregate counts derived before deletion are not subject to this policy.

## Data minimization

Verified against current schema and write paths:

- `admin_activity_logs` before/after payloads pass through a recursive redactor
  (`artifacts/api-server/src/lib/activityLog.ts`) that replaces any key
  containing `password`, `token`, `secret`, `apikey`, `api_key`, or
  `authorization`, and the exact keys `otp`, `jwt`, `code`, with `[redacted]`,
  then truncates oversized payloads. Passwords, hashes, OTPs, JWTs, provider
  access tokens, Turnstile tokens, and authorization headers are therefore not
  persisted.
- `promotion_audit_logs` metadata is written only by
  `writePromotionAuditLog`, whose three call sites pass a promotion name, a
  promotion type, or the *names* of changed fields. No values, no customer
  identity, no medical data.
- `notification_delivery_logs` stores device references, not credentials. It
  holds no password, OTP, JWT, OAuth/provider access token, Turnstile token,
  authorization header, or medical field. One residual note: `error_message`
  stores the provider's verbatim receipt text, and Expo's `DeviceNotRegistered`
  receipt embeds the offending `ExponentPushToken[...]`. A push token is a
  device delivery address, already stored deliberately in
  `notification_devices` — it is not an authentication credential, so this is
  not a defect. It is a further reason the detailed window here is 90 days
  rather than 24 months.

No security defect was found in the retained fields.

## Future purge model

Not implemented. When the purge is built, it must be a named maintenance
operation with these properties:

- **Named task**, e.g. `maintenance:purge-audit-logs`, invoked deliberately or
  on a schedule that is itself reviewed — never reachable from an Admin API
  endpoint or any customer-facing route.
- **Separate maintenance credential.** DELETE on the three audit tables must be
  granted to a dedicated maintenance role (e.g. `central_maintenance`), not
  restored to `central_runtime`. The append-only revoke in
  `configure-database-roles.sql` must stay in force for the runtime role.
- **Backup precondition.** The job must refuse to run unless a completed
  encrypted backup newer than the purge cutoff exists.
- **Before/after row counts** per table, recorded in the job output.
- **Logged retention cutoff** — the exact timestamp boundary applied, per table.
- **Legal/security hold honored.** A hold register must be consulted first; held
  rows are skipped and reported, never silently deleted.
- **Dry-run first** on a non-production restore of the backup, with counts
  compared against expectation before any production execution.

## Exceptions

- An open security incident, dispute, or legal hold suspends deletion for the
  affected rows until the owner clears it in writing.
- Rows forming part of financial or tax evidence follow the applicable
  financial-record retention requirement, which overrides the technical window
  above where it is longer.
