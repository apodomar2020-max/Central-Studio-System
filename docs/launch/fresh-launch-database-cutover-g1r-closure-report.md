# Phase G1R Closure Evidence

## Baseline and environment

- Baseline: `c8da476db509378717caa76a1ddf9336b1c79169`
- Branch: `feature/fresh-launch-db-cutover-g1r-closure`
- Manifest: `g1r-v1`
- Manifest hash:
  `39eb36c94c7b937b0dc81e075d71b36bfa19a896d4ae6af3d3e0d17b2b1e8769`
- Node.js: 25.9.0
- PostgreSQL: 18.4
- Migrations: 91 through `0091`
- Infrastructure: ten newly created loopback-only disposable databases in one
  temporary PostgreSQL cluster; all removed after the run

No production, staging, Railway, remote database, customer data, deployment,
push, or environment change was used.

## Operational failure exercises

### Lock timeout

A separate target connection held an `ACCESS EXCLUSIVE` lock on
`dance_types`. The real importer transaction used a closure-test-only 100 ms
lock timeout and PostgreSQL returned code `55P03`. The importer rolled back.
Target configuration, migration defaults, content hashes, and sequences matched
the pre-import fingerprint; the source fingerprint was unchanged.

### Statement timeout

Inside the real importer transaction, a closure-test-only setup callback set a
25 ms statement timeout and executed a 200 ms PostgreSQL delay. PostgreSQL
returned code `57014`; the transaction rolled back and source/target
fingerprints remained unchanged. A subsequent normal import on that isolated
pair succeeded, matched configuration hashes, and retained zero transactions.

### Source mutation alarm

The fingerprint covered manifest table counts and normalized content hashes,
all public sequence states, migration state, and schema-view state. A separate
test-only source connection inserted a synthetic inactive dance-type row after
export. The pre-commit source check raised
`SOURCE_MUTATION_DETECTED:dance_types`; no values or identity fields appeared
in the error. The target transaction rolled back. The intentionally mutated
disposable source and its target were then destroyed.

### Forced smoke failure

Migrations, export, import, configuration equivalence, transaction exclusion,
and readiness completed before a deterministic test-only smoke callback failed.
The result was NO-GO. Because the import was already committed, the report
correctly records target rejection and destruction rather than transaction
rollback. Source fingerprint remained unchanged.

## Final clean rehearsal

After all failure exercises, a new source/target pair completed the clean G1R
rehearsal:

- all 91 migrations applied to both databases;
- source export used a read-only transaction;
- two exports were deterministic and identical;
- import was atomic with stable configuration IDs and sequence adjustment;
- configuration hashes and canonical relations matched;
- target contained zero transferred transactions before smoke writes;
- readiness passed;
- participant-owned package purchase: 18/18;
- activation and concurrency: 12/12;
- participant-aware booking and Finance capture: 15/15;
- QR check-in/no-double-deduction concurrency: 3/3;
- package, paid, and unpaid walk-ins: 15/15;
- Finance classification: 37/37;
- Ballet canonical database behavior: 5/5;
- core transfer integration: 2/2;
- source fingerprint remained unchanged;
- all temporary databases and files were removed.

## Guard, redaction, and cleanup

The guard regression accepts only explicit local disposable source/target
pairs and rejects remote hosts and IPs, Railway markers, environment-like
names, incorrect prefixes, same databases, missing acknowledgement, missing
database, malformed URLs, and sensitive export fields. Errors use stable codes.
No complete connection URL or credential is logged. No generated export is
written to Git.

## Technical classification

The operational closure is technically successful. Formal Phase G2 approval
remains conditional on human decisions and evidence for identities, Ballet
contact settings, archive retention, audit/media handling, verified production
backup and restore, maintenance window, named approvers, and post-write
reconciliation policy. Phase G2 has not been executed or authorized.
