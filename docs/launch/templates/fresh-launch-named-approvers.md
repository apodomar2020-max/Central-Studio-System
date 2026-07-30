# Fresh Launch Named Approvers

Assignments and sign-offs remain pending. Record personal details only in the
restricted approval system.

| Role | Responsibility | Evidence reviewed | Go/No-Go authority | Abort authority | Required presence | Sign-off reference | Timestamp |
|---|---|---|---|---|---|---|---|
| business_owner | Business readiness, communications, launch acceptance | Decisions, maintenance plan, customer impact | Yes | Yes | Approval freeze and open writers |  |  |
| engineering_owner | Architecture, integrity, technical execution | Rehearsals, bundle, inspection, smoke evidence | Yes | Yes | All technical checkpoints |  |  |
| finance_owner | Ledger isolation and reconciliation | Backup/restore and Finance aggregate evidence | Yes | Yes | Import validation, open writers, incidents |  |  |
| ballet_domain_owner | Ballet separation and readiness | Ballet configuration and aggregate evidence | Yes for Ballet | Yes for Ballet risk | Validation and open writers |  |  |
| security_or_data_owner | Identity, PII, archive and access policy | Bundle, inspection output, archive controls | Yes | Yes | Authorization, source capture, archive |  |  |
| database_operator | Backup, restore, migrations and DB controls | Backup/restore, identity, migration, fingerprint evidence | Yes | Yes | Source/target database stages |  |  |
| release_operator | Window execution and connection consistency | Window, deployment state, operational checkpoints | Yes | Yes | Whole maintenance window |  |  |
| incident_commander | Incident coordination and split-brain prevention | Abort matrix and post-write policy | Operational | Yes | Window and observation period |  |  |
