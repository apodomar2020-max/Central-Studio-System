# Participant Lifecycle Pre-Launch Data Reset Plan

## Purpose and authority

This document is an execution plan, not an executable reset. It describes how
test and legacy General Studio transactional data may be removed before public
launch while preserving catalogue, configuration, Finance semantics, and the
Ballet domain.

No reset may run against production without a separately approved execution
change, named business and engineering sign-off, a maintenance window, and a
verified restorable backup. Phase F does not authorize or perform deletion.

## Mandatory prerequisites

1. Prove the target environment and deployed commit.
2. Stop transactional writers for the approved maintenance window.
3. Take and verify a database backup, including a restore rehearsal.
4. Capture the protected `/admin/catalogue-readiness` report.
5. Export aggregate Finance reconciliation totals and source counts.
6. Resolve every configuration or integrity blocker. Expected legacy/reset
   inventory alone is not an integrity blocker.
7. Record approvers, operator, timestamps, backup identifier, and rollback
   decision deadline in the change ticket.

Never put connection strings, credentials, customer PII, or raw DOB values in
the ticket or reset output.

## Preserve

The reset must preserve the verified launch configuration, including:

- `dance_types`, `classes`, `schedules`, `instructors`
- `price_packages`, `price_package_dance_types`
- branches/rooms and class capacity/pricing settings where present
- age-range configuration on classes and packages
- `system_users`, roles, permissions, and required admin access
- application/content/settings tables
- promotion definitions and codes (redemptions are transactional)
- Finance classification/configuration and report definitions
- all Ballet configuration: packages, levels, groups, classes, schedules,
  instructors, settings, FAQs, requirements, and performance opportunities

Account deletion is a separate privacy/business decision. Do not delete
`students` or `children` under this plan unless a separately approved launch
identity policy explicitly requires it.

## Candidate General Studio transactional reset inventory

Final inclusion is determined by the readiness inventory and approved change:

- `credit_transactions`
- General Studio rows in `attendance`
- `payment_events`
- `payment_refunds`
- `payment_records`
- `promotion_redemptions`
- General Studio `bookings`
- `package_orders`
- transactional notifications, receipts, delivery logs, and device
  registrations only where the launch policy explicitly includes them
- operational walk-in rows represented by bookings, attendance, payment
  records, and payment events

Finance backfill batches/progress and audit logs require an explicit retention
decision. Do not silently delete them. Administrative activity logs should
normally be retained.

## Ballet isolation

Do not delete attendance rows with Ballet identity (`ballet_class_id`,
`ballet_schedule_id`, or `ballet_level_assignment_id`). Do not delete Ballet
applications, assignments, subscriptions, payments, refunds, attendance hours,
or audit history. Reconcile Ballet totals independently before and after any
approved reset.

## Dependency-aware execution order

The operator must confirm the live foreign-key graph immediately before
execution. The expected leaf-to-root order is:

1. Notification delivery/read rows and approved transactional audit children.
2. `promotion_redemptions` tied to orders.
3. `payment_refunds`, then `payment_events`, then `payment_records`.
4. `credit_transactions` (references package orders, bookings, attendance).
5. General Studio `attendance`.
6. General Studio `bookings`.
7. `package_orders`.

Because payment source constraints use restrictive foreign keys and controlled
tombstones, payment children must be handled before bookings or package orders.
Never use `CASCADE` as a substitute for an reviewed dependency order.

## Sequence and identity policy

Sequence reset is optional and must be decided explicitly. Stable identifiers
may be referenced in audit evidence, so restarting identities is not inherently
required. If approved, restart only sequences belonging exclusively to emptied
transaction tables, after proving no retained rows exist. Never restart
configuration or Ballet sequences.

## Finance and audit retention decisions

Before approval, decide whether statutory or audit requirements require payment
records, refunds, events, receipts, promotion redemptions, or admin logs to be
retained even when their operational data is test-only. Payer identity and
historical Finance source identity must never be rewritten to participant
identity. Finance totals must be captured before and after and must change only
by the explicitly approved removal of test transactions.

## Read-only validation before reset

Run in a read-only transaction with bounded timeouts:

```sql
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

SELECT count(*) FROM package_orders;
SELECT count(*) FROM credit_transactions;
SELECT count(*) FROM bookings;
SELECT count(*) FROM attendance
WHERE ballet_class_id IS NULL AND ballet_schedule_id IS NULL;
SELECT flow_type, status, count(*), sum(paid_amount_minor)
FROM payment_records GROUP BY flow_type, status ORDER BY flow_type, status;
SELECT count(*) FROM payment_events;
SELECT count(*) FROM payment_refunds;
SELECT count(*) FROM promotion_redemptions;

ROLLBACK;
```

Also archive the readiness diagnostic and the existing Finance aggregate
regression baseline.

## Dry-run procedure

1. Restore the approved backup into a disposable, clearly non-production DB.
2. Apply the reviewed reset statements inside one transaction.
3. Run all post-reset validation and smoke tests before commit.
4. Roll back the first rehearsal and verify original counts return.
5. Repeat and commit only in the disposable rehearsal.
6. Record duration, locks, sequence behavior, retained audit rows, and exact
   statements for production approval.

No production-enabled destructive script is supplied by this plan.

## Post-reset validation

Verify:

- All approved transactional tables/partitions have the expected zero count.
- No General Studio credit transaction, booking, attendance, payment, refund,
  event, or redemption is orphaned.
- Catalogue definitions, age configuration, package dance restrictions,
  schedules, pricing, roles, and application configuration remain unchanged.
- Ballet row counts and Finance totals are unchanged.
- Readiness returns no integrity/configuration blocker and an expected empty
  launch-reset inventory.
- Relevant sequences are above retained maximum IDs or match the approved
  restart policy.

## Smoke-test checklist

- Student and Parent authentication/profile completion
- Guest/Student/Parent catalogues
- Participant-owned package purchase and activation
- Self and owned-child booking
- One booking credit deduction
- Booking-backed check-in with no second deduction
- Package walk-in with one attendance deduction
- Paid and unpaid walk-in atomicity
- Attendance history separation
- Finance overview/export reconciliation
- Promotions
- Ballet application, enrollment, payment, and attendance

## Rollback and sign-off

Rollback means stopping writers, abandoning the reset transaction when still
open, or restoring the verified backup if the reset was committed. Define the
restore owner and maximum acceptable recovery time before execution.

Required sign-off:

- Product/business owner
- Engineering owner
- Finance owner
- Ballet domain owner
- Security/privacy or data owner
- Named database operator

Production reset, deployment, and launch remain separate explicitly approved
execution phases.
