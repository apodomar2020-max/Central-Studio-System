# Fresh Launch Cutover Production Evidence Checklist

This checklist is for a future separately approved phase. Do not record
credentials, connection URLs, customer PII, raw DOB values, payment details, or
other secrets here. Restricted identifiers belong in the approved change
system, not Git.

## Authority and environments

- [ ] Exact approved Git commit recorded.
- [ ] Named business, engineering, Finance, Ballet, security/data, operations,
      and database-operator approvals recorded.
- [ ] Source environment identity independently proven.
- [ ] Target environment identity independently proven.
- [ ] Source and target are distinct.
- [ ] No ambiguous database URL or linked-environment state exists.
- [ ] Maintenance window and communications are approved.

## Source capture and export

- [ ] Writer shutdown evidence captured.
- [ ] Production source inventory completed read-only.
- [ ] Readiness and integrity diagnostics captured.
- [ ] Configuration export counts match the approved manifest.
- [ ] Configuration export deterministic hash recorded.
- [ ] Manifest version and hash recorded.
- [ ] Sensitive-data scan passed.
- [ ] Transaction-exclusion scan passed.
- [ ] Source pre-export fingerprint recorded.
- [ ] Source post-export fingerprint is identical.

## Target preparation and import

- [ ] Target creation evidence retained in the restricted change record.
- [ ] Migration count is 91.
- [ ] Latest migration is `0091`.
- [ ] Target pre-import state contains only approved migration defaults.
- [ ] Non-empty-target guard passed.
- [ ] Import completed atomically.
- [ ] Imported IDs and target sequence adjustments recorded.
- [ ] Configuration equivalence source/target hashes match.
- [ ] Foreign-key and relation verification passed.
- [ ] Target transactional-zero verification passed.
- [ ] Target readiness is clean.

## Runtime consistency and validation

- [ ] API target connection independently verified.
- [ ] Worker target connection independently verified.
- [ ] API and Worker resolve the same target and migration state.
- [ ] Old source is unavailable to application writers.
- [ ] Student, Parent-self, and Parent-child smoke lifecycles passed.
- [ ] Package purchase, activation, booking, deduction, and check-in passed.
- [ ] Package, paid, and unpaid walk-ins passed.
- [ ] Finance totals and classification passed.
- [ ] Ballet configuration and representative operations passed.
- [ ] Monitoring, alerting, logs, and Sentry readiness passed.

## Backup, rollback, and archive

- [ ] Backup identifier recorded only in the restricted change record.
- [ ] Backup verification passed.
- [ ] Isolated restore rehearsal passed.
- [ ] RTO/RPO result approved.
- [ ] Pre-write rollback checkpoint recorded.
- [ ] Post-write incident and reconciliation policy approved.
- [ ] Source archive encryption and read-only controls verified.
- [ ] Source retention and deletion policy approved.

## Open writers and observation

- [ ] Final Go/No-Go sign-off recorded.
- [ ] Maintenance start and checkpoint timestamps recorded.
- [ ] Final approval to open writers recorded.
- [ ] Worker started and healthy.
- [ ] API writes opened and healthy.
- [ ] First controlled transaction reconciled.
- [ ] Observation-window owner and escalation thresholds active.
