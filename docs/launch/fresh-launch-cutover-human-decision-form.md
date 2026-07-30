# Fresh Launch Cutover Human Decision Form

**TEMPLATE — NOT APPROVED — NOT PRODUCTION EVIDENCE**

Technical recommendations and safe defaults are not decisions. Every section
must receive an explicit decision, non-PII approval reference, timestamp, and
required role approvals in the restricted approval system.

Allowed status: `pending`, `approved`, `rejected`, or `deferred`. Every item is
currently `pending` and blocks the stage stated below.

## ID-01 — Admin identities

- Why it matters: determines who can securely administer the fresh system.
- Options: **A** recreate accounts through the canonical secure setup flow;
  **B** narrowly migrate an explicitly approved identity subset under a
  separate security-reviewed mapping. Neither option transfers sessions,
  tokens, OTPs, OAuth credentials, or password material.
- Recommended: Option A — recreate required Admin accounts securely.
- Safe default: no Admin identity transfer.
- Risks: unauthorized access, credential leakage, missing launch access.
- Approvers: `business_owner`, `engineering_owner`, `security_or_data_owner`.
- Evidence: identity inventory, bootstrap test, MFA/password and role policy.
- Final decision: `[BLANK]`
- Approval reference / timestamp: `[BLANK]` / `[BLANK]`
- Status: `pending`
- Blocking effect: target identity bootstrap and Admin access.

## ID-02 — Instructor login identities

- Why it matters: catalogue profiles are configuration; authenticated access is
  security identity.
- Options: transfer catalogue profiles only; recreate required access; narrowly
  migrate an approved identity subset.
- Recommended: transfer approved catalogue configuration and recreate access.
- Safe default: catalogue data only; exclude credentials and sessions.
- Risks: credential leakage, unintended access, missing instructor access.
- Approvers: `business_owner`, `engineering_owner`, `security_or_data_owner`.
- Evidence: catalogue/access inventory and authentication mapping.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; blocks instructor access bootstrap.

## ID-03 — Ballet contact settings

- Why it matters: public business contacts may coexist with personal contact data.
- Options: manual entry of approved public values; narrowly approved transfer;
  exclude all automated contact transfer.
- Recommended: exclude sensitive values and manually enter approved public
  business email, phone, WhatsApp, and contact links.
- Safe default: do not automatically transfer contact fields.
- Risks: PII transfer, incorrect public contact information, missing contact path.
- Approvers: `ballet_domain_owner`, `business_owner`, `security_or_data_owner`.
- Evidence: field classification and approved public-value record.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; blocks Ballet contact configuration.

## ID-04 — Source database archive

- Why it matters: the old Finance ledger and operational history require
  controlled retention without remaining writable by the application.
- Options: approved encrypted archive policies defining duration, format,
  storage classification, access, auditing, and deletion authority.
- Recommended: encrypted, access-restricted, read-only archive with normal
  application writer access removed.
- Safe default: preserve securely; do not delete and do not permit writers.
- Risks: legal/Finance retention failure, data exposure, split-brain writes.
- Approvers: `finance_owner`, `security_or_data_owner`, `database_operator`,
  `business_owner`.
- Evidence: retention basis, encryption, access controls, audit and deletion policy.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; blocks archive and cutover approval.

## ID-05 — Audit and activity logs

- Why it matters: logs may be operational evidence and may contain sensitive data.
- Options: retain in old archive; separately archive an approved subset; narrowly
  transfer; delete only after retention approval.
- Recommended: do not transfer old logs to the fresh database; retain under the
  archive policy.
- Safe default: archive only, no fresh-database transfer.
- Risks: lost audit evidence, unnecessary PII transfer, policy breach.
- Approvers: `security_or_data_owner`, `engineering_owner`, `business_owner`.
- Evidence: log classification and retention obligation.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; blocks archive approval.

## ID-06 — Media and uploaded files

- Why it matters: public catalogue assets differ from customer and transaction media.
- Options: allow-list public class/instructor/package/Ballet media; approved
  reference-only transfer; exclude customer uploads and attachments.
- Recommended: transfer approved public configuration media or references only.
- Safe default: no customer or transactional media transfer.
- Risks: private-file disclosure, broken catalogue assets, licensing issues.
- Approvers: `business_owner`, `security_or_data_owner`, and
  `ballet_domain_owner` where relevant.
- Evidence: asset inventory, ownership/licensing and sensitive-content review.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; blocks complete catalogue approval.

## ID-07 — Backup and restore policy

- Why it matters: cutover must have a verified recoverable source.
- Required choices: type, scope, encryption, owners, rehearsal environment,
  RTO/RPO, retention, evidence expiry and approval reference.
- Recommended: provider-supported complete backup plus verified isolated restore
  before maintenance.
- Safe default: no G2B or cutover authorization without successful evidence.
- Risks: unrecoverable data, unacceptable downtime/loss, unverifiable Finance state.
- Approvers: `database_operator`, `engineering_owner`, `finance_owner`,
  `security_or_data_owner`.
- Evidence: completed backup/restore template and Finance/Ballet reconciliation.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; hard-blocks G2B and maintenance.

## ID-08 — Maintenance window

- Why it matters: all writers and operators must coordinate around bounded checkpoints.
- Required choices: date, timezone, start, duration, writer/communication freeze,
  backup/export/import/smoke checkpoints, rollback deadline, open-writers
  approval, observation window and abort criteria.
- Recommended: use the maintenance-window template with named stage ownership.
- Safe default: no maintenance action outside an approved window.
- Risks: split brain, incomplete freeze, customer disruption, missed rollback point.
- Approvers: `business_owner`, `engineering_owner`, `release_operator`,
  `database_operator`.
- Evidence: completed window plan and staffing/communications record.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; hard-blocks maintenance.

## ID-09 — Post-write incident policy

- Why it matters: after a first live target write, reconnecting the old database
  can duplicate or lose financial and operational transactions.
- Options: controlled forward fix, recovery, or reconciled migration after
  stopping writers and preserving both databases.
- Recommended: never automatically reconnect old writers.
- Safe default: stop all writers and require reconciliation.
- Risks: split brain; mismatched bookings, credits, attendance, payments,
  refunds, promotions, Finance, or Ballet records.
- Approvers: `engineering_owner`, `finance_owner`, `database_operator`,
  `incident_commander`.
- Evidence: incident procedure and reconciliation checklist.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; hard-blocks opening writers.

## ID-10 — Notification configuration

- Why it matters: static templates differ from device registrations and history.
- Options: transfer approved templates/static configuration; manually recreate;
  exclude all devices, tokens, deliveries, reads, notifications and failures.
- Recommended: templates/configuration only; no transactional notification data.
- Safe default: exclude ambiguous and operational records.
- Risks: token/PII disclosure, unintended sends, missing launch templates.
- Approvers: `business_owner`, `engineering_owner`, `security_or_data_owner`.
- Evidence: field-level template and operational-record classification.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; blocks notification launch approval.

## ID-11 — Finance backfill and report history

- Why it matters: Finance definitions are configuration; backfill/report jobs
  are historical operational state.
- Options: configuration-only transfer; protected archive; separately approved
  compliance export.
- Recommended: do not transfer progress, generated reports, export history,
  reconciliation batches, or processing state.
- Safe default: keep operational history in the source archive.
- Risks: altered reporting semantics, duplicated work, historical confusion.
- Approvers: `finance_owner`, `engineering_owner`, `database_operator`.
- Evidence: Finance classification and retention inventory.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; blocks Finance evidence sign-off.

## ID-12 — Sequence policy

- Why it matters: imported configuration IDs must remain stable without future collisions.
- Options: canonical preserve-and-advance policy; separately reviewed
  deterministic remap.
- Recommended: preserve configuration IDs and advance only corresponding
  configuration sequences above imported maxima; never alter transaction-ledger sequences.
- Safe default: no import if any sequence exception is unresolved.
- Risks: ID collision, broken references, accidental transaction-sequence change.
- Approvers: `engineering_owner`, `database_operator`.
- Evidence: affected tables, imported maxima, target sequence values, collision
  test, and confirmation that account/Finance/transaction sequences are untouched.
- Final decision / reference / timestamp: `[BLANK]` / `[BLANK]` / `[BLANK]`
- Status: `pending`; hard-blocks import approval.
