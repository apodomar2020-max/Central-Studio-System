# Fresh Launch Cutover Maintenance Runbook

This runbook documents a possible future production procedure. It contains no
credentials or executable production connection commands and does not
authorize Phase G2, database creation, transfer, cutover, deployment, or launch.

## Stage 0 — Approval freeze

Confirm the exact approved commit, named approvers, decision register, verified
backup and restore rehearsal, maintenance window, staffing, communications,
monitoring, pre-write rollback deadline, and post-write incident owner. Declare
NO-GO if any hard gate is incomplete.

## Stage 1 — Writer shutdown

Restrict API writes, pause or stop the Worker and scheduled jobs, stop queue
consumers, restrict Admin writes, and verify no other integration or operator
can write. Record queue depth and in-flight work without deleting it. Do not
continue until database activity proves all writers are stopped.

## Stage 2 — Source capture

Run the approved read-only source inventory and readiness checks. Create and
validate the configuration-only export, record its aggregate counts and hash,
and capture the complete source fingerprint. Reject any unexpected identity,
sensitive field, Finance transaction, Ballet transaction, or manifest drift.

## Stage 3 — Target preparation

Create the fresh target through the approved platform process. Apply all 91
migrations through `0091`, verify only known migration defaults, and reject a
non-empty or ambiguous target. Bootstrap only identities approved in the
decision register, using secure canonical mechanisms.

## Stage 4 — Configuration import

Validate manifest, export version, migration compatibility, target state, and
source fingerprint. Import once in dependency order and one transaction.
Preserve approved configuration IDs, advance only required target configuration
sequences, compare normalized configuration hashes, and prove zero transferred
transactions. Any timeout or mismatch is NO-GO.

## Stage 5 — Connection switch

While writers remain stopped, change API and Worker connection configuration
through the approved secrets platform. Independently verify both processes
resolve the same target and migration state. The old database must remain
unavailable to writers. Prevent split-brain connections before proceeding.

## Stage 6 — Validation

Run readiness and the full Student, Parent-self, Parent-child, purchase,
activation, booking, check-in, walk-in, Finance, and Ballet smoke matrix.
Inspect monitoring, error logs, queues, and alerts. A smoke failure rejects the
target; configuration equivalence alone is insufficient.

## Stage 7 — Open writers

Obtain final named Go approval. Start the Worker and confirm queue health, then
open API writes. Execute and reconcile one controlled transaction through its
operational and Finance records before general traffic resumes.

## Stage 8 — Archive

Enforce source read-only state, remove application writer access, restrict
human access, capture archive evidence, and apply the approved encryption,
retention, legal, Finance, and deletion-review policy.

## Stage 9 — Observation window

Monitor application errors, Sentry, queues, Finance records, package
activation, bookings, attendance, walk-ins, Ballet activity, and database
health. Define escalation thresholds, decision owners, observation duration,
and handoff before the window begins.

## Failure-stage response matrix

| Failure stage | Actual response |
|---|---|
| Before target transaction | No target write exists; reject and destroy target. No rollback is claimed. |
| During import transaction | Roll back the complete import. Reuse only after exact fingerprint restoration; preferably destroy the target. |
| After import, before approval | Import may be committed. Reject and destroy the target; do not describe this as transaction rollback. |
| During smoke tests | Reject and destroy the committed disposable/launch candidate. Writers remain closed. |

## Pre-write rollback

This applies only while no live transaction has entered the fresh database.
Stop target services, prove the target has no live writes, preserve evidence,
and reconnect services to the source only after the named rollback decision and
connection-consistency verification.

## Post-write incident handling

After any live target transaction, changing the connection back is not
automatically safe. Stop every writer, prevent split-brain operation, preserve
both databases, reconcile package, booking, attendance, payment, refund,
promotion, and Ballet effects, obtain Engineering and Finance approval, then
choose a controlled recovery, data migration, or forward fix. The archived
source must not casually become writable.
