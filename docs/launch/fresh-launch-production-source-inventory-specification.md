# Fresh Launch Production Source Inventory Specification

The future G2B inspection may collect only aggregates and fingerprints through
the fixed query allowlist.

Required inventory:

- PostgreSQL version, migration count, and latest migration.
- Counts and normalized hashes for every canonical transfer group.
- Aggregate counts for every excluded transaction group.
- Aggregate counts for every decision-required group.
- Configuration blockers and excluded-identity references.
- Participant, age-range, dance-type, credit, and double-deduction readiness.
- Finance row counts and minor-unit aggregate checksums.
- Ballet configuration and transaction aggregate checksums.
- Public sequence count/state checksum.
- Foreign-key and view counts.
- Complete source fingerprints before and after inspection.

The inventory must never emit raw rows, names, contact details, DOBs, child
identities, notes, application text, payment references, authentication data,
database connection details, or provider identifiers. A scanner failure,
source-fingerprint change, non-read-only transaction, query outside the
allowlist, or environment-identity mismatch blocks the inspection.
