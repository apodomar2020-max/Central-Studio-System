# Phase G2A Approval and Inspection Preparation Report

## Baseline and scope

- Baseline: `07b9369421dba5087eb8c4b4dbd57b21c76dceb0`
- Branch: `feature/production-cutover-approval-g2a`
- Manifest: `g1r-v1`
- G1R architecture, failure handling, source immutability, Finance isolation,
  Ballet isolation, and disposable lifecycle tests remain satisfied.

G2A created approval and future inspection infrastructure only. It did not
access production or staging, execute G2B/G2C, create a target, transfer
configuration, change connections, deploy, or launch.

## Approval bundle

Schema `g2a-v1` binds seven distinct role approvals, ID-01 through ID-12,
policy decisions, backup/restore/window references, expiry, exact commit, and
the canonical manifest version/hash. Unknown fields, duplicates, expired
evidence, unresolved decisions/policies, missing evidence, commit/manifest
drift, sensitive keys, and credential-like values are rejected using stable
redacted codes. Bundle hashes use canonical key ordering.

All real approvals remain pending. The YAML file is a deliberately incomplete
shape example, not an approved bundle.

## Environment identity

The identity model records classifications, PostgreSQL/migration state, commit
consistency, timestamps, and one-way database server/name fingerprints. Raw
hostnames, database names, connection details, provider IDs, IPs, usernames,
credentials, and personal contact data are forbidden.

## Read-only inspection architecture

The prepared tool validates approval before creating a connection. Its G2A
mode permits only disposable loopback transport and temporary evidence
directories. A distinct approved-read-only mode is reserved for future G2B and
was not invoked; it still requires the complete unexpired bundle, hashed source
identity, explicit acknowledgement, and read-only database classification.

Inside the database it begins a transaction, sets read-only mode, applies
bounded statement/lock/idle timeouts, verifies PostgreSQL read-only state,
executes a fixed named query allowlist, rolls back, and compares source
fingerprints. There is no caller-supplied SQL, import/export/reset/delete/schema
mode, force-write option, trigger bypass, or FK bypass.

## Evidence and scanner

Evidence contains aggregate counts, minor-unit aggregate checksums, Ballet
checksum, readiness/blocker counts, migration state, hashes, scanner/read-only
results, and classification only. Recursive scanning rejects sensitive keys,
connection URLs, credential patterns, email-shaped values, and IP-shaped
values before file writing. Completed evidence includes hashes of—not the
contents of—the approval bundle and environment identity document.

## Approval documents

The package includes the finalized pending decision register, backup/restore
template, maintenance-window plan, role matrix, production inspection runbook,
source-inventory and target-zero-state specifications, entry-gate matrix, and
example approval/environment shapes. No personal names, contacts, real
environment evidence, backup identifiers, or secrets are stored.

## Validation evidence

- Node.js 25.9.0 and PostgreSQL 18.4.
- G2A approval/read-only suite: 13/13 passed against one fresh disposable
  loopback database with all 91 migrations.
- G1R environment/manifest/export suite: 20/20 passed.
- Full inherited failure and lifecycle rehearsal: 112/112 passed across ten
  disposable databases.
- Scripts, shared libraries, Admin, and Mobile typechecks passed.
- API production build passed.
- Canonical OpenAPI regeneration produced no source/generated diff.
- All temporary PostgreSQL and evidence directories were removed.

## Current gate classification

Tooling is technically prepared for formal approval collection. Backup/restore
evidence, all human decisions, maintenance window, named assignments, and
post-write policy approval remain pending. Production inspection is not
authorized and has not run.
