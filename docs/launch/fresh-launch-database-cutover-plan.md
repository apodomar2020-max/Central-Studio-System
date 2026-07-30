# Fresh Launch Database Cutover Plan

## Authority and purpose

This plan describes a future controlled cutover from the existing pre-launch
database to a fresh database containing all migrations and approved launch
configuration only. Phase G1R supplies a local disposable rehearsal; it does
not authorize production inspection, database creation, transfer, deployment,
cutover, or launch.

The earlier destructive reset path was rejected because `payment_events` is an
append-only Finance ledger and restrictive foreign keys intentionally prevent
deletion of its payment, refund, credit, booking, and package-order graph.
Triggers, constraints, and Finance history must not be disabled or rewritten.

## Source archive and backup policy

Before a production change, take a restorable backup and complete an isolated
restore rehearsal. At cutover, stop all writers. The old database must become a
read-only archive under an approved retention policy; it must not remain an
active writable fallback. Backup identifiers and credentials belong only in
the restricted change record, never in repository files.

## Fresh database preparation

1. Obtain named business, engineering, Finance, Ballet, security/data, and
   database-operator approvals and an approved maintenance window.
2. Create a new database through the approved platform procedure.
3. Apply all repository migrations in order and confirm migration `0091`.
4. Verify only migration-created defaults exist.
5. Run the protected lifecycle and catalogue readiness diagnostics.
6. Reject the target if it contains unexpected data.

## Configuration transfer manifest

The machine-readable manifest in
`scripts/src/fresh-launch-cutover/freshLaunchConfigurationManifest.ts` is the
single authority for inventory, export, import, equivalence checking, and
reporting. `transfer` groups contain approved catalogue/configuration;
`exclude` groups are transactional; `decision_required` groups are omitted by
default. Stable configuration IDs are preserved. Serial sequences are advanced
only on the target after import.

General Studio configuration includes dance types, instructors, classes,
schedules, packages, canonical package dance-type joins, pricing/capacity
settings, promotions and codes, roles, and approved public content. No package
order, credit, booking, attendance, payment ledger, redemption, notification
delivery, device, or operational walk-in record transfers.

Approved Ballet catalogue tables transfer separately from applications,
assignments, enrollment cancellations, payments, refunds, attendance, and
other Ballet transactions. Ballet settings containing contact fields remain
`decision_required` until a sensitive-data owner approves a narrow policy.

## Identity and sensitive-data policy

Students, Parents, children, system users, authentication identities, hashes,
tokens, sessions, devices, audit logs, and other PII-bearing groups do not
transfer by default. Required administrators are recreated securely through an
approved bootstrap after import. Synthetic Student, Parent, child, and
instructor identities may be created after import for smoke tests only.

Human approval is still required to choose between securely recreating
administrators and transferring a narrowly approved identity subset. Instructor
login handling, audit retention, media/file metadata, and contact settings also
remain explicit decisions.

## Export procedure

1. Prove the source and target independently satisfy the environment guard.
2. Inventory the source in a read-only transaction with bounded timeouts.
3. Resolve every configuration or integrity blocker.
4. Create the versioned structured export; never use `pg_dump`.
5. Validate every table, column, dependency, classification, and sensitive
   field against the manifest.
6. Generate the export twice and compare deterministic hashes.
7. Store the short-lived artifact only in the approved encrypted temporary
   location and securely remove it after verification.

No connection URL, credential, customer PII, raw DOB, payment detail, or
transactional ledger row may appear in the artifact or report.

## Import, dependency, and sequence procedure

The importer validates format, manifest hash, source/target migration
compatibility, target emptiness, migration-created defaults, dependencies, and
unknown fields before writing. It imports in manifest dependency order inside
one transaction. Existing migration defaults may be replaced only when their
IDs are explicitly present in the validated export; unexpected rows abort.

Configuration IDs are preserved. After each applicable group, its target
serial sequence is advanced above the maximum imported ID. Composite-key joins
have no sequence adjustment. No source sequence and no transactional or Finance
sequence is changed. Failure rolls back the complete target import.

## Validation and evidence

Compare normalized source/target configuration hashes, counts, stable IDs,
foreign keys, active states, age ranges, schedules, package restrictions,
pricing, capacity, promotions, roles, Finance configuration, and Ballet
configuration. Before smoke writes, assert every excluded transaction table is
empty and lifecycle readiness is clean. Retain only aggregate, non-sensitive
evidence.

## Writer shutdown and cutover order

1. Announce maintenance and stop API, Worker, scheduled jobs, and every other
   transactional writer.
2. Confirm zero writers and capture the final approved source inventory.
3. Export and validate configuration, then import and verify the new database.
4. Recreate approved administrators and perform the smoke matrix.
5. Change API and Worker connections together; verify both resolve the same
   target and migration state before reopening traffic.
6. Re-run readiness, Finance, Ballet, and lifecycle checks.
7. Reopen writers only after the named operator records GO.

Never change checked-in environment files or expose database URLs.

## Smoke matrix

Verify Student self, Parent self, and Parent-owned-child purchase, activation,
eligible booking, one booking deduction, booking-backed check-in with no second
deduction, and participant-separated history. Verify package walk-ins for all
three participant shapes, paid walk-in canonical booking/attendance/payment
record/event, unpaid walk-in zero writes, Finance classification, and
representative Ballet operations using imported configuration.

## Rollback and incident handling

Before any new-database write, rollback may reconnect all stopped services to
the archived old database after target abandonment and verification.

After any customer write reaches the new database, switching back is not
automatically safe. Stop every writer, prevent split-brain operation, declare
an incident, reconcile transactions and Finance, and execute an explicitly
approved recovery or data-migration strategy. The archived source must not be
made writable casually.

## Go/No-Go criteria

GO requires a verified backup/restore, complete approvals, maintenance window,
clean manifest inventory, deterministic export, atomic import, configuration
equivalence, zero transferred transactions, clean readiness, passing smoke and
regression suites, source immutability, secret/PII review, and retained
evidence. Any remote-target ambiguity, ledger inclusion, sensitive-data leak,
schema mismatch, source mutation, target partial write, readiness blocker, or
smoke failure is NO-GO.
