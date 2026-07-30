# Phase G2B Production Source Read-Only Inspection Runbook

This describes a future separately authorized inspection. It does not authorize
target creation, configuration export/import, writer shutdown, connection
switching, deployment, cutover, or launch.

## Stage 0 — Authorization check

Validate the exact approved commit and manifest-bound approval bundle. Require
all seven approval roles, ID-01 through ID-12, policy decisions, unexpired
backup/restore evidence, approved maintenance window, and assigned operators.
Any missing or expired gate is `PRODUCTION_SOURCE_INSPECTION_BLOCKED`.

## Stage 1 — Environment proof

Resolve source identity outside Git and compare one-way server/database
fingerprints. Verify provider/region classifications, deployed application/API/
Worker commit equality, PostgreSQL version, 91 migrations through `0091`, and a
database role independently documented as read-only. Do not record raw
hostnames, database names, IPs, usernames, provider IDs, or URLs.

## Stage 2 — Read-only transaction

Begin one transaction, set it read-only, apply the bounded statement, lock, and
idle-in-transaction timeouts, and verify `transaction_read_only=on`. Execute
only named allowlisted queries. Roll back under both success and failure.

## Stage 3 — Configuration analysis

Collect aggregate counts and hashes for transfer groups, canonical relations,
dependencies, configuration blockers, and references to excluded identities.
Do not collect raw configuration rows containing sensitive values.

## Stage 4 — Transaction exclusion inventory

Collect aggregate counts only for package orders, credits, bookings,
attendance, payment records/events/refunds, promotion redemptions,
notifications, and Ballet transactions. No transaction row or payment
reference may be emitted.

## Stage 5 — Readiness and integrity

Collect participant lifecycle, age configuration, credit integrity,
double-deduction, Finance minor-unit aggregate, Ballet aggregate, sequence, and
foreign-key evidence. Classify blockers without repair.

## Stage 6 — Evidence generation

Compare complete source fingerprints before/after, validate the PII/credential
scanner, create the aggregate-only evidence manifest, roll back, and store
evidence under the approved restricted policy. A scanner or fingerprint failure
blocks evidence publication.

## Stage 7 — Exit classification

- `PRODUCTION_SOURCE_INSPECTION_READY`
- `PRODUCTION_SOURCE_INSPECTION_READY_WITH_DECISIONS`
- `PRODUCTION_SOURCE_INSPECTION_BLOCKED`

Inspection results authorize no later phase. Target creation, export, import,
connection switching, writer shutdown, deployment, and launch each require
separate approval.
