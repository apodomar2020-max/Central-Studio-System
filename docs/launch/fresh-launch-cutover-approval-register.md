# Fresh Launch Cutover Approval Register

All decisions remain `pending`. Defaults and recommendations are technical
safety guidance, not approval. Approval references must be non-secret internal
references; do not put names, contact information, credentials, environment
identifiers, or backup identifiers in Git.

| ID | Subject | Status | Default safe behavior | Available options | Technical recommendation | Required approver roles | Required evidence | Blocking impact | Decision deadline | Final decision | Approval reference | Approval timestamp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ID-01 | Admin identities | Pending | Recreate | Secure recreation; narrowly approved subset transfer | Recreate required Admin accounts; never transfer passwords, tokens, sessions, or OAuth credentials | business_owner, engineering_owner, security_or_data_owner | Identity inventory, bootstrap test, MFA/password policy, role review | Blocks Admin access | Before target bootstrap |  |  |  |
| ID-02 | Instructor login identities | Pending | Exclude credentials and recreate access | Catalogue-only transfer; recreate authenticated access; narrowly approved transfer | Transfer catalogue configuration and recreate login access separately | business_owner, engineering_owner, security_or_data_owner | Authentication model and approved access inventory | Blocks required instructor login | Before identity bootstrap |  |  |  |
| ID-03 | Ballet contact settings | Pending | Exclude and manually re-enter approved public values | Public configuration; manual entry; narrow transfer | Exclude sensitive contact values; manually enter reviewed public business values | ballet_domain_owner, business_owner, security_or_data_owner | Field classification and approved public-value evidence | Blocks Ballet public-contact launch | Before Ballet validation |  |  |  |
| ID-04 | Source archive retention | Pending | Preserve encrypted and remove normal writer access | Approved retention/storage/access/deletion policies | Encrypt, restrict, audit access, and retain under Finance/legal/data policy | finance_owner, security_or_data_owner, database_operator | Retention basis, encryption, access controls, deletion approval | Blocks source disposition | Before cutover |  |  |  |
| ID-05 | Audit/activity logs | Pending | Do not transfer | Archive only; separate approved export; approved deletion | Retain only under archive policy | business_owner, engineering_owner, security_or_data_owner | Log classification and retention obligation | Blocks archive approval | Before archive |  |  |  |
| ID-06 | Media and uploaded files | Pending | Transfer only approved public configuration media | Public catalogue media; approved instructor media; exclude customer uploads/attachments | Allow-list public configuration media only | business_owner, ballet_domain_owner, security_or_data_owner | Asset inventory, ownership/licensing, sensitive-content scan | Blocks complete public catalogue | Before configuration export |  |  |  |
| ID-07 | Production backup and restore | Pending | No cutover without verified restore | Approved backup/restore design meeting policy | Full pre-cutover backup plus isolated restore rehearsal and Finance/Ballet reconciliation | database_operator, engineering_owner, finance_owner | Completed backup/restore evidence, RTO/RPO, encryption and retention | Hard blocker | Before maintenance freeze |  |  |  |
| ID-08 | Maintenance window | Pending | No cutover outside approved window | Approved date/duration/checkpoints/staffing plan | Window must cover writer freeze, validation, rollback decision, and observation | business_owner, engineering_owner, release_operator | Window plan, communications, staffing, duration evidence | Hard blocker | Before Stage 0 |  |  |  |
| ID-09 | Post-write rollback | Pending | Never reconnect old writers automatically | Forward fix; controlled recovery; reconciled migration | Stop all writers, prevent split brain, reconcile both databases, require Engineering and Finance approval | engineering_owner, finance_owner, database_operator, release_operator | Incident and reconciliation policy | Hard blocker | Before opening target writers |  |  |  |
| ID-10 | Notification configuration | Pending | Exclude ambiguous/sensitive/operational records | Manual recreation; narrow template/config transfer; archive only | Transfer approved templates/configuration only; exclude devices, deliveries, reads, and history | business_owner, engineering_owner, security_or_data_owner | Field classification and template inventory | Blocks affected notifications | Before export approval |  |  |  |
| ID-11 | Finance backfill/report history | Pending | Do not transfer progress or generated history | Archive; separate compliance export; narrowly approved transfer | Keep progress and report jobs in protected source archive | finance_owner, engineering_owner, security_or_data_owner | Finance retention decision and report inventory | Blocks Finance evidence sign-off | Before export approval |  |  |  |
| ID-12 | Sequence policy | Pending | Preserve configuration IDs and advance corresponding configuration sequences only | Preserve IDs; explicitly approved deterministic remap | Use tested preserve-and-advance behavior | engineering_owner, database_operator | Sequence inventory and collision test | Hard blocker for exceptions | Before import approval |  |  |  |

## Required approval roles

- `business_owner`
- `engineering_owner`
- `finance_owner`
- `ballet_domain_owner`
- `security_or_data_owner`
- `database_operator`
- `release_operator`

An incident commander is also required by the maintenance package but is not a
substitute for any approval role.
