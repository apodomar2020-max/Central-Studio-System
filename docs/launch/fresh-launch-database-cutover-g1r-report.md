# Phase G1R Fresh Launch Database Cutover Rehearsal

## Scope

- Baseline: `7ee3a3c4d69aa73c79a12540b79d32c79e6fc8f6`
- Branch: `feature/fresh-launch-db-cutover-g1r`
- Runtime: Node.js 25.9.0; PostgreSQL 18.4
- Schema: 91 ordered SQL migrations through `0091`
- Environment: two newly initialized loopback-only PostgreSQL databases under
  a unique temporary directory
- Production, Railway, deployment, push, and real customer data: not used

## Manifest and source fixture

Manifest version is `g1r-v1`; its canonical SHA-256 is
`39eb36c94c7b937b0dc81e075d71b36bfa19a896d4ae6af3d3e0d17b2b1e8769`.
The source fixture included migration
defaults, synthetic General Studio and Ballet configuration, a synthetic
Student, and synthetic package-order, booking, attendance, and credit rows.
No raw fixture values or export artifact are retained.

Transfer groups cover approved General Studio, shared, and Ballet catalogue
configuration. Operational and Finance groups are excluded. Identity, auth,
audit, sensitive contact settings, devices, report history, and ambiguous
marketing groups are `decision_required` and excluded by default.

## Rehearsal result

- Environment guard unit cases: passed.
- Manifest validation: passed.
- Source inventory: read-only transaction, bounded timeouts, aggregate output.
- Export: two unchanged-source runs produced identical content and hash.
- Target: fresh, all 91 migrations applied, migration defaults recognized.
- Import: one transaction; stable IDs preserved; applicable sequences advanced.
- Configuration equivalence: normalized group hashes and relation checks passed.
- Transaction exclusion before smoke: all manifest-excluded target groups zero.
- Source immutability: pre/post row counts, per-table content hashes, sequence
  state, and schema-view state matched.
- Package/dance-type and Ballet group/schedule relations: preserved.
- Temporary PostgreSQL cluster and export state: removed in `finally`.

## Imported-target smoke evidence

The imported target passed:

- participant lifecycle readiness integration: 1/1;
- participant-owned package purchase and Finance capture: 18/18;
- package activation and concurrency: 12/12;
- booking creation, participant ownership, payment capture, package credit,
  age, expiry, and dance restriction coverage: 15/15;
- QR participant check-in and concurrency/no-double-deduction: 3/3;
- paid/unpaid/package walk-in atomicity: 15/15;
- Finance read-model classification: 37/37;
- canonical Ballet database behavior: 5/5.

The core G1R transfer integration passed 2/2. Temporary infrastructure was
stopped and deleted after the run.

## Failure evidence

Unit/integration coverage rejects missing rehearsal acknowledgement, remote
source or target, wrong prefixes, same source/target, production-like names,
Railway markers, missing database, malformed URL, excluded export groups,
sensitive export fields, unknown fields, unknown manifest versions, and
non-empty targets. Failures use stable non-secret codes. Target imports roll
back and source access remains read-only.

Lock/statement timeout values are bounded in the tooling. A future operator
rehearsal must additionally capture explicit injected lock-timeout,
statement-timeout, smoke-failure, and source-mutation alarms in its restricted
change evidence before production approval.

## Local cutover model

The runner first verifies configuration-only transfer, then points only
disposable test processes at the target for readiness and smoke suites. No
deployed API or Worker is contacted. The process exits, stops the database, and
removes the temporary directory. Future API/Worker writer shutdown and
connection switching remain operational steps requiring separate approval.

## Result and approvals

The local technical transfer path is suitable for review. This report does not
authorize production source inspection or cutover. Production preparation
still requires decisions on administrator recreation versus narrow identity
transfer, instructor accounts, Ballet contact settings, source archive
retention, audit-log retention, media/file transfer, backup policy, maintenance
window, and post-write rollback, plus named business, engineering, Finance,
Ballet, security/data, and database-operator approvals.
