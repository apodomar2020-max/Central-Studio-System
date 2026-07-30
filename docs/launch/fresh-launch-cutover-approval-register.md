# Fresh Launch Cutover Approval Register

This register records decisions required before production preparation. Blank
decision and sign-off fields are intentional. Phase G1R Closure does not make
business, legal, Finance, security, or operational approvals on behalf of
people.

| ID | Subject | Default safe behavior | Options | Recommendation | Required approver | Evidence required | Timing | Blocking impact | Final decision | Sign-off |
|---|---|---|---|---|---|---|---|---|---|---|
| ID-01 | Admin identities | Recreate | Secure recreation; narrowly approved subset transfer | Recreate required Admin accounts through the approved bootstrap | Engineering, security/data owner, business owner | Identity inventory, bootstrap test, MFA/password policy, least-privilege roles | Before target bootstrap | Blocks opening Admin access |  |  |
| ID-02 | Instructor login identities | Exclude credentials and recreate access where needed | Catalogue-only; authenticated user; recreated access; narrow transfer | Keep catalogue instructors separate from authenticated identities and recreate access explicitly | Engineering, business owner, security/data owner | Authentication model and instructor access list | Before identity bootstrap | Blocks instructor login where required |  |  |
| ID-03 | Ballet contact settings | Exclude and manually re-enter approved public values | Public business configuration; sensitive manual entry; narrow transfer | Manually re-enter reviewed public contact values | Ballet owner, security/data owner, business owner | Field classification and approved public values | Before Ballet launch validation | Blocks Ballet public contact launch |  |  |
| ID-04 | Source archive retention | Preserve encrypted and inaccessible to normal writers | Retention periods and archive locations per policy | Encrypted read-only archive with audited access and scheduled deletion review | Finance, legal/data owner, database operator | Retention basis, encryption, access controls, deletion approval | Before cutover | Blocks source disposition |  |  |
| ID-05 | Audit and activity logs | Do not transfer to fresh launch database | Archive only; separate export; transfer approved subset; delete after retention | Retain only in protected source archive unless legally required elsewhere | Security/data owner, business owner, engineering | Log classification and retention obligation | Before source archive | Blocks archive approval |  |  |
| ID-06 | Media and uploaded files | Transfer only approved public configuration media references | Public catalogue media; instructor media; customer uploads; application attachments | Allow-list public catalogue assets; exclude customer/application files | Business owner, Ballet owner, security/data owner | Asset inventory, ownership/licensing, sensitive-content scan | Before configuration export | Blocks complete public catalogue |  |  |
| ID-07 | Production backup and restore policy | No cutover without verified restore | Backup types, retention, RTO/RPO, encryption, ownership | Full pre-cutover backup plus isolated restore rehearsal | Database operator, engineering, Finance | Backup identifier in restricted ticket, restore logs, RTO/RPO result | Before maintenance freeze | Hard blocker |  |  |
| ID-08 | Maintenance window | No cutover outside an approved window | Candidate start/duration and rollback checkpoints | Window covering writer shutdown, validation, rollback decision, and observation | Business owner, engineering, operations | Communications plan, duration rehearsal, staffing | Before Stage 0 | Hard blocker |  |  |
| ID-09 | Post-write rollback | Never reconnect old writers without reconciliation | Forward-fix; controlled data recovery; reconciled migration | Stop writers, prevent split brain, reconcile transactions, obtain Engineering and Finance approval | Engineering, Finance, database operator | Incident plan and reconciliation procedure | Before opening target writers | Hard blocker |  |  |
| ID-10 | Notification templates and contact configuration | Exclude ambiguous or sensitive records | Manual recreation; narrow reviewed transfer; archive only | Transfer only templates proven configuration-only and free of customer/device state | Business owner, security/data owner, engineering | Field-level classification and template inventory | Before export approval | Blocks affected notifications, not core cutover |  |  |
| ID-11 | Finance backfill and report state | Do not transfer progress or generated history | Archive; separate compliance export; approved transfer | Keep operational backfill progress and report jobs in source archive | Finance, engineering, data owner | Finance retention decision and report inventory | Before export approval | Blocks Finance evidence sign-off |  |  |
| ID-12 | Sequence policy | Preserve configuration IDs and advance only target configuration sequences | Preserve IDs; deterministic remap where specifically approved | Use the tested preserve-and-advance policy | Engineering, database operator | Sequence inventory and post-import collision test | During import approval | Hard blocker if any exception exists |  |  |

## Required named approvals

- Business/product owner:
- Engineering owner:
- Finance owner:
- Ballet domain owner:
- Security/privacy or data owner:
- Database operator:
- Operations/incident owner:
