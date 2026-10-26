# Promotions Production Readiness and Legacy Assessment

Date: 2026-10-25, Africa/Cairo. Assessment scope: existing local candidate, approved-access discovery, disposable inventory safety verification and offline release review.

## 1. Executive verdict

**Assessment: BLOCKED ON ACCESS. Release recommendation: NO-GO.**

**Production inventory NOT EXECUTED. Production data status UNKNOWN. Release NO-GO pending authorized inventory and assessment.**

The signed-in Railway account and a Production environment label do not establish an approved database identity or read-only role. Repository documentation describes future read-only access requirements, but no completed, usable Promotions read-only access profile or secret-loading procedure was identified. The Owner also confirmed that no such profile/procedure is currently known. No Production database connection, privilege probe or inventory query was attempted. No application/database credentials were exported from Railway or substituted for inventory access.

The local engineering baseline remains intact: the saved Phase 1C evidence records 372 passing tests, passing API/Admin builds and 167 unchanged inherited API TypeScript diagnostics. All 38 candidate files match their closure hashes. Those tests were not needlessly repeated.

A separate inventory safety issue was demonstrated in a newly created disposable database: the tool returned **10,002 normalization-collision groups**, exceeding the documented 10,000 anomaly-group ceiling without aborting. The existing three inventory safety tests pass, but do not cover this limit. The tool remains unchanged. This additional preflight gate must be resolved/reviewed before a future Production run, even if access becomes available.

No actual Production anomaly counts, affected IDs, monetary discrepancies, role privileges, replica lag or current checkout eligibility have been established. Synthetic fixture results are not Production findings.

## 2. Scope and authorization

The Owner authorized one bounded Production SELECT-only inventory using an existing approved read-only access mechanism, if available; local source/report inspection; disposable safety tests; and this report. The subsequent access clarification explicitly prohibits treating Railway authentication as database authority, using application/admin database credentials, or creating roles/privileges/access paths.

This execution used only source/status/metadata reads and a newly initialized local PostgreSQL cluster for safety fixtures. It did not implement a feature or safety patch, modify the inventory tool, amend runtime policy, change schema, run write-oriented API tests, or contact Production data. The one permitted Production inventory attempt remains unused. Any later execution must still meet all safety gates; this report is not authorization to bypass them.

## 3. Verified repository baseline

- Worktree: `/Users/abdelrahmanomar/.codex/worktrees/promotions-phase1a/Central-Studio-System-main`.
- Branch: `codex/promotions-phase1a`.
- HEAD and read-only remote main: `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`. No newer remote main or material integration difference was found.
- All 38 Phase 1A/1B/1C implementation/document files match the closure SHA-256 manifest. They remain uncommitted; HEAD alone does not contain the approved local candidate.
- Inventory source: uncommitted `scripts/src/promotionsInventory.ts` on that baseline, SHA-256 `86ff803c03be73b5d527c7d3ad214d98a65f41044c615752a93eefc095a63dbb`.
- Migration 0137, journal/schema, allocation correction, Admin durable protocol and Mobile activation safeguard are unchanged.
- Original dirty Downloads checkout: complete Git status preserved. No reset, clean, rebase, staging, cherry-pick, worktree replacement or history change.
- Only this assessment report is added to the repository during this assessment. Prior reports/runbook are preserved, including their historical statements about earlier authorization.

Reviewed material: Phase 1C closure report in `docs/promotions`; previous readiness report and copied `RELEASE_RUNBOOK.md` in the saved Phase 1C evidence directory; current `PHASE_1C_RELEASE_RUNBOOK.md`; actual inventory/tests; Promotions schema/service; migration 0137; Railway configuration/start/migration entry points; Worker startup; backup source/configuration; and relevant existing access/grant documentation.

## 4. Inventory tool safety verification

| Requirement | Verified source/disposable result |
|---|---|
| SELECT-only data access | Fixed SELECT statements; no application DML, DDL, migration, API startup or background job. BEGIN/SHOW/COMMIT/ROLLBACK are transaction controls. Schema-only validation import does not start the application. |
| Read-only enforcement | Connection startup `default_transaction_read_only=on`; explicit `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; `SHOW transaction_read_only` must return `on`. Disposable mutation attempt is rejected with PostgreSQL 25006. |
| Consistent snapshot | One repeatable-read transaction, one pooled connection (`max:1`). Not a multi-query survey across unrelated snapshots. |
| Timeouts | 5-second connection/statement timeout; 500ms lock timeout; 15-second idle-in-transaction timeout. Existing values unchanged. |
| Row/input ceilings | 10,000 Promotions; 50,000 codes; 50,000 packages; 16 MiB logical rules/code bytes. Queries request ceiling+1 and throw rather than silently truncate. |
| Anomaly ceilings | Ownership and Finance reconciliation groups enforce 10,000 with ceiling+1 reads. **Normalization-collision groups do not enforce 10,000.** Counter discrepancy arrays can contain up to 50,000 entries; package-reference output has no independent group/output-byte ceiling. These categories must not be described as uniformly capped at 10,000. |
| Personal-data minimization | No student/customer table query, customer name/phone/email, payment credentials or provider references. Raw codes/rules are read for local classification but not emitted. Output uses aggregates and minimal Promotion/Code/package/purchase/payment IDs. |
| Failure/partial-result behavior | Declared bounds fail with rollback and sanitized CLI failure; JSON is emitted only after a successful COMMIT. However, the missing normalization bound means an oversized anomaly result is currently returned as successful. |
| Target/role/lag/load preflight | Not implemented by this tool. Must be established through the approved operator mechanism before running; transaction read-only is not proof of a least-privilege role. None verified for Production here. |

### Disposable evidence

A fresh PostgreSQL 18 cluster was initialized at `/tmp/promotions-production-assessment-20261025/pgdata`, localhost port 55454, with newly created database `promotions_inventory_assessment_disposable`. Existing migrations initialized that new database only. No previous cluster/environment was migrated or restarted. The cluster was shut down after verification.

Executed:

```sh
DISPOSABLE_PROMOTIONS_INVENTORY_DATABASE_URL=postgresql://promo_assessment@127.0.0.1:55454/promotions_inventory_assessment_disposable lib/db/node_modules/.bin/tsx --test scripts/src/promotionsInventory.test.ts
```

**3 tests passed; 0 failed, skipped, cancelled or TODO.** They verify classification/privacy/nonmutation, database-level read-only rejection, and oversized logical payload rejection. These tests establish their specific assertions, not complete output-limit coverage.

An additional temporary, local-only probe inserted 10,001 uppercase/lowercase code pairs under one synthetic Promotion, within the tool's code and payload limits. The earlier safety fixture already contained one collision group. Calling the unchanged inventory returned `normalizedCollisions.length = 10002`, `readOnly:true`, and no ceiling error. The probe asserted and recorded this gap, then removed its own fixtures. It is a reproduced safety defect, not a passing Production preflight. Initial temporary-probe module/parameter setup issues were corrected locally; final evidence is `ceiling-probe.json` and the local `.mts` probe. No repository code/test change was made.

The source constructs collision groups and immediately commits/returns without checking their count (`scripts/src/promotionsInventory.ts`, lines 176–199). Recommendation for separate review: fail closed for normalization groups above 10,000, explicitly bound other potentially expanding output categories, and add permanent boundary tests. Do not relax existing limits or silently truncate results. No correction is implemented or approved for Production execution by this report.

## 5. Production access and inventory execution result

**Production inventory: NOT EXECUTED. Production database queries: ZERO.**

Access discovery found:

- No `PROMOTIONS_INVENTORY_DATABASE_URL` or database connection environment variable in this process.
- No relevant local environment file/profile in the checked worktree/application locations; no PostgreSQL service/password file in the standard user locations checked. This is a scoped availability check, not a claim that no credential exists elsewhere.
- Railway CLI session/project-link metadata exists. `railway status --json` in the isolated worktree returned unavailable linked status (exit 1); the existing original project context returned project/environment metadata (exit 0) including a Production label. Only sanitized metadata presence was retained; no variable or credential export was requested.
- This metadata does not prove the intended database/replica identity, an independently documented least-privilege role, permission inheritance, replica freshness, an approved quiet window or monitoring readiness.
- `docs/promotions/PHASE_1C_RELEASE_RUNBOOK.md` requires an existing approved access/tunnel mechanism and separately approved read-only account; it does not supply one.
- The older fresh-launch inspection runbook describes a different, future inspection. Its evidence-gap register leaves Production identity/read-only-role evidence pending; it is not a reusable approved profile. Its broader limits/query set are not substituted for Promotions inventory.
- Existing deployment grant documentation describes runtime and migrator roles with write/migration responsibilities. Those are not approved read-only inventory identities. Backup-job access likewise does not grant permission to reuse its credentials.

**Intended Production database identity: UNCONFIRMED.** No raw host/database/user/project identifiers, credential-bearing URLs or tokens are included. No database privilege query was run because approved read-only access had not been established. No timing/load/replica condition is inferred from Railway metadata.

### Safest procedure requiring separate approval

Have the responsible Owner/DB operator identify whether an independently documented read-only role and approved route already exist. Provide only the access-profile reference, secret-loader mechanism and target/role approval evidence through the established secure channel; do not paste credentials into chat or Git. Confirm the exact Production database/approved replica using non-secret identity evidence, effective SELECT-only permissions (including inherited privileges and no owner/superuser/migration/write authority), intended minimal tables/columns and replica lag if applicable.

If no suitable role/path exists, preparation of one is a separately authorized infrastructure task for the responsible operator. **Do not create it or borrow runtime/admin credentials in this assessment.** Define the operator, quiet window, load observer and cancellation contact. Resolve/review the proven output-ceiling defect and any approved coverage additions before binding a final script hash to the execution approval.

Only then load the approved connection into `PROMOTIONS_INVENTORY_DATABASE_URL` using the approved secret mechanism and execute the established command once:

```sh
lib/db/node_modules/.bin/tsx scripts/src/promotionsInventory.ts --approved-read-only-inventory
```

No credential on the command line or in saved logs. Keep existing timeouts/ceilings; cancel on target, role, lock, load, timeout or output anomalies. Do not automatically rerun with relaxed bounds. The existing authorization does not authorize new users, grants, tunnels, role changes or broader queries.

## 6. Promotion population summary

| Production measure | Result |
|---|---|
| Total / Manual / Automatic Promotions | UNKNOWN / UNKNOWN / UNKNOWN |
| Active / inactive | UNKNOWN / UNKNOWN |
| Scheduled / expired | UNKNOWN / UNKNOWN |
| Currently capable of affecting checkout | UNKNOWN; active alone would not prove eligibility |
| Manual with zero / one / multiple codes | UNKNOWN / UNKNOWN / UNKNOWN |
| Automatic with attached codes | UNKNOWN |
| Codes / code IDs with history / Promotions with history | UNKNOWN / UNKNOWN / UNKNOWN |

No values are replaced by zero or by synthetic fixture counts. Date categories can overlap; scheduled/expired/inactive totals must not be subtracted blindly to infer redeemable population. Checkout depends on dates, valid code lookup, rules, catalog context, account/order eligibility and limits. The present inventory emits type/code-shape and aggregate date counts but no complete checkout-capable cohort or individual valid-date cohort.

## 7. Legacy Promo Code anomalies

All Production counts, affected Promotion/Code IDs and active subsets are **UNKNOWN** for: multi-code/manual-no-code, automatic-with-code, noncanonical codes, normalized collisions, ownership mismatches and stored-counter/history discrepancies.

Source/previous disposable evidence establishes possible behavior, not Production incidence:

- Compliant Manual Promotions retain one usable code. Legacy multiple canonical codes can each activate; mutation safeguards do not establish a global one-code guarantee.
- Automatic-with-code can be discovered both automatically and through entered activation. Existing stackable selection can duplicate its contribution. The approved allocator reconciles its combined contribution to the existing one persisted Promotion row; it does not change eligibility or first-candidate code/count semantics.
- Input trim/uppercase versus exact stored equality can leave noncanonical text unreachable or select a canonical collision. No automatic code normalization/merge is permitted.
- API reads all codes; current Admin displays the first. Ordinary unsafe edits/reactivation are guarded. No displayed first code becomes an approved legacy canonical identity by inference.

## 8. Historical redemption integrity

Production referenced Code IDs, distinct Promotions with history, ownership mismatch groups and usage inconsistencies are UNKNOWN. Current inventory can report mismatch groups and code-level stored-versus-counted discrepancies without customer IDs, but it does not emit a complete distinct referenced-code/Promotion history inventory.

Runtime limits use redemption history; `current_uses` alone is not authoritative. A cross-owner historical redemption can be excluded by current owner/code count predicates, creating an undercount risk. Zero-valued selected redemptions still consume existing usage counts when an aggregate discount is positive; allocation did not alter this policy. Used code IDs cannot be renamed and ownership must not be reassigned.

The tool does not compare all configured global/per-account/per-code limits with histories. Per-customer distribution/limit analysis would need a separately reviewed aggregate-only extension; do not retrieve student identities or raw customer records. Neither the need for individual remediation nor its scope can be decided without actual inventory/business evidence.

## 9. Eligibility configuration findings

Production invalid/unsupported/null/malformed rules, missing/inactive package references and invalid discounts: UNKNOWN. Automatic broad-eligibility and package-incompatible branch-restriction counts: UNKNOWN.

The inventory validates stored rules and discounts and flags package reference states. JSON null is flagged invalid by inventory/Admin validation while existing runtime uses the empty-rule fallback. Other malformed/unsupported rule objects reject at evaluation. Package checkout supplies package/subtotal context without branch; configured branch restrictions therefore cannot match that context. Automatic empty-rule records can be broad subject to other eligibility conditions. These are verified source behaviors, not confirmed live anomalies.

Coverage limits: the current output combines invalid-rule categories rather than separately counting null/malformed/unsupported forms; it omits valid rules needed to classify broad Automatic eligibility and branch/package incompatibility. Do not export raw rule documents as a workaround. If these counts are necessary, separately review bounded, privacy-preserving classification output before a future run. No rule or eligibility behavior was changed.

## 10. Finance reconciliation findings

Production attribution discrepancies: UNKNOWN. No historical sum, purchase/payment ID or discrepancy amount was retrieved.

The existing query groups stored redemption discounts by package order/booking, joins matching payment records by flow, and compares rounded aggregate discount piastres with payment discount minor units. It reports minimal purchase/payment IDs and aggregate monetary discrepancies, without customer identities.

Limits: this inner-join comparison does not prove completeness for missing payments, missing redemptions, null discounts or orphaned historical references; it does not identify the cause or timing/version of each discrepancy. It does not retrospectively validate all financial events.

The approved proportional correction applies only to future redemptions under the corrected API. Earlier over-attribution can remain while original customer payment totals were correctly capped. Such mismatches must be assessed as historical attribution issues, not automatically called overcharges or new-version failures. No recalculation, reinterpretation, balancing expense, history rewrite or repair is authorized. Current-name Finance lookup remains a live join. Whether any historical remediation is required is UNKNOWN and requires separate Owner/Finance review.

## 11. Customer impact assessment

For **every category below**, affected active Promotions, affected Codes and minimal IDs are UNKNOWN; distribution/customer communication evidence is UNKNOWN. The entries describe conditional source-supported impact if that category is found. They are not claims of active Production problems.

| Potential category | Current redemption / unintended eligibility | Usage-limit risk | Finance implication | Strict rejection/customer effect | Evidence/action before release |
|---|---|---|---|---|---|
| Manual multiple codes | More than one code may redeem | Shared Promotion limits and code histories need review | Historical attribution unknown | May interrupt every distributed code for the Promotion | Inventory all IDs/history; Owner chooses per-Promotion policy |
| Manual no code | No normal manual activation | History still needs preservation | Historical references may exist | Usually no working code to interrupt, but unknown dependencies | Confirm type/history; no invented replacement code |
| Automatic with codes | May apply automatically and via duplicate activation | Existing first-candidate code counting may differ from entered-code expectation | Corrected allocation reconciles future applied total; eligibility duplication remains | Can remove an existing discount or distributed-code activation | Evaluate active records, customer promise and intended discount scope individually |
| Normalized collision | Canonical lookup may win unexpectedly | Current selected owner/history governs counts | Purchase attribution follows selected identity | May interrupt customer input that currently resolves | Map minimal collision IDs; require ownership/distribution evidence, no silent merge |
| Noncanonical code | Stored text may be unreachable | Limits relevant if another canonical lookup resolves | History remains immutable | Exact current impact depends on lookup/collision | Verify canonical counterpart/distribution; no automatic rename |
| Historical ownership mismatch | Current owner can differ from redemption history | Count filters can undercount | Historical attribution/reference discrepancy possible | Can interrupt currently accepted code | Owner reviews each mismatch and limits; never reassign history automatically |
| Counter/history discrepancy | Counter alone does not govern runtime denial | Inspect actual history/configured limits | Not itself proof of monetary mismatch | Blanket block may unnecessarily disrupt | Classify direction/history and review; no reset |
| Invalid/null rules | Invalid objects deny; null runtime fallback can be broad | Limits absent from fallback may matter | Current applicability determines new discounts | Null strict rejection can remove working discounts | Separate null from invalid forms; approve narrowly defined handling |
| Missing/inactive package references | Availability/matching restrictions can deny | No inferred bypass | Old purchases still preserved | Could interrupt reviewed catalog pathways | Catalog/business evidence; do not delete references |
| Broad Automatic eligibility | Could discount a broad package population | Global/account constraints still apply when configured | Changes actual discounts if eligibility is too broad | Restriction/deactivation removes benefits | Owner verifies campaign intent; no default rewrite |
| Branch-restricted package context | No branch means no matching package eligibility | No new count consumed on rejection | No discount for denied context | Broad policy can remove benefits on class context too | Classify package/class intended use before policy |
| Historical monetary mismatch | Not itself proof of a currently invalid code | No automatic usage implication | Past attribution differs from payment | Rejecting current codes does not repair old amounts | Finance materiality review; separate reconciliation decision |

Audited Admin deactivation is available and preserves codes/redemptions/payment history under the current implementation, including legacy guarded records. It stops future eligibility and can disrupt customers; it is neither automatically business-safe nor authorized here. No code is proven undistributed by zero redemption count. No deactivation or communication occurred.

## 12. Option A versus Option B

| Policy | Benefit | Risk | Assessment without Production data |
|---|---|---|---|
| A: strict runtime rejection of structural ambiguity | Prevents known ambiguous configurations from contributing new redemptions | Can immediately stop distributed codes/automatic benefits; exact boundary and support plan needed | Cannot approve a global switch on unknown incidence/customer commitments |
| B: preserve legacy runtime while unsafe Admin mutations remain blocked | Customer continuity; no surprise cutoff | One-code guarantee not global; duplicate Automatic eligibility and ownership/limit risks can remain | Existing behavior is not evidence of launch safety |

Neither policy was selected or implemented. Production results are required to estimate affected cohorts or make an evidence-based final choice.

## 13. Recommended legacy policy

**Conditional recommendation: per-anomaly decisions after inventory rather than a blind global switch.** Preserve customer-facing behavior during this assessment. If inventory confirms active ownership inconsistencies, normalized collisions or duplicate-activation automatic records, hold release of affected behavior until Owner-approved handling/customer impact is documented. For code-less/inactive/unreachable records, verify history/dependencies before deciding whether no runtime action is necessary. Assess null-rule fallback and broad Automatic scope against campaign intent rather than silently converting meaning.

For any proposed strict rule, define exact categories, permitted exceptions, affected minimal IDs, distributed-code evidence, customer communication/support, effective time, monitoring and rollback. This is a recommendation for Owner decision, not runtime activation or authorization to remediate. A final A/B recommendation based on actual Production incidence remains BLOCKED.

## 14. Required individual remediation decisions

No actual Production IDs are available; no per-record work list can honestly be issued. After an approved complete inventory, Owner/business/Finance must decide for each affected record whether the current customer commitment should continue, whether explicit deactivation or future configuration correction is appropriate, and what separate remediation authorization is needed.

Specifically review multi-code Manual campaigns; attached-code Automatic campaigns; normalization collisions; historical ownership and limit discrepancies; null-rule/broad-eligibility campaigns; package/branch context mismatches; and material historical attribution differences. Retain code ownership, used-code immutability and all financial history. No merges, counter resets, reassignment, backfill or historical deletion is an automatic option.

## 15. Database and migration readiness

Migration 0137 remains additive and unchanged: operation table/PK, state/binding/size constraints, expiry index and immutable-history trigger; no historical business-data rewrite. The closure's fresh/upgrade/repeat disposable tests and representative-history preservation remain the local evidence, not proof of Production schema/privileges.

Production journal, pending migration set, schema compatibility, database version, deployment role grants, restore point and migration scheduling are UNVERIFIED. A migration runner applies pending migrations, not merely the named 0137; separately review the entire pending set against the intended database before approval. Do not infer current Production schema from local HEAD or older fresh-launch assumptions.

No Production/staging migration, DDL, grant or index operation ran. Local disposable schema initialization was required for safety tests only. Operational safety for the intended Production migration remains conditional, not PASS.

## 16. API, Admin, Mobile, Railway and Worker compatibility

| Transition/surface | Current-source expectation | Remaining release evidence |
|---|---|---|
| New Admin + new API | Capability detection, durable identity/reconciliation, current actor/RBAC replay | Approve exact candidate and later permitted verification |
| Old Admin + new API | Compatible while mandatory flags are off; keyless saves lack durable identity guarantees | Inventory old callers and browser sessions |
| New Admin + old API | New saves refuse missing capability; no unsafe keyless fallback | Prevent routing new clients to old instances |
| Old open browser sessions | Old bundles/pending saves may survive rollout | Approved refresh/session handling and reconcile pending identities |
| Existing Mobile | Package/class contracts preserved; omitted activation with lower quoted class final can receive safe 409 | Identify deployed versions/customer experience |
| Reviewed Mobile correction | Forwards entered normalized activation; package-credit exclusion retained | Coordinate reviewed release; no native/device verification claimed here |
| Mixed API writers | Old writer can bypass new locks/audits/protocol/attribution | Upgrade/drain **every API/checkout writer**; never claim guarantees during unsafe mixed-version writes |
| Finance | Existing amounts/events/reporting shapes unchanged; future attribution fixed | Historical discrepancies assessed separately, no cash-out expense fabrication |
| Worker | Startup does not migrate; does not start API-local Promotion cleanup | Confirm actual service settings/version/DB compatibility |

Repository `railway.toml` declares build, explicit migration `preDeployCommand`, start router, health endpoint and restart policy. Migration entry exits early for `QUEUE_WORKER_ENABLED=true`; API migration uses a deploy-time migration credential. Start router removes that credential before spawning runtime. API starts bounded operation cleanup after listening; Worker does not own that loop.

These are source declarations, not verification of live Railway settings, deployed commits, overridden commands, rollout overlap, service count or provider failure behavior. Railway metadata alone does not establish that the actual deployment matches them. No deployment, predeploy command, restart, drain or health/API smoke test was performed. A later operator must review predeploy ownership, migration failure handling, version overlap and traffic gates against actual approved environment settings. The existing API may remain serving while schema predeploy runs; do not rely on migration ordering alone to solve mixed-writer compatibility.

Expected later sequence: complete safe inventory → resolve/accept legacy risks → approve final candidate → verify backup/restore → separately authorize pending migrations including 0137 → compatible schema first → upgrade/drain all API writers → verify replay/current permissions under separately authorized procedures → release reviewed Admin → account for browser sessions → coordinate Mobile correction → separately approve any mandatory flags → confirm monitoring/rollback readiness throughout. No step was executed here.

## 17. Backup, monitoring and rollback requirements

Source contains an encrypted backup job and declared Railway cron schedule. Their existence is not proof of a recent successful backup, access to decryption material or a successful restore drill. `pg_restore --list` validates archive readability, not a full restore. Require Owner-approved RPO/RTO, fresh coherent backup/restore evidence, responsible operator, encryption/key recovery, restricted evidence storage and explicit recovery decision points.

Preserve the operation table, permanent identities/tombstones, audits and full Promotions/payment/order/booking history during rollback. Never DROP/TRUNCATE operation storage, restore it independently or replay uncertain operations with new identities. Prefer forward correction with compatible protocol. If reverting to old API is unavoidable, gate Promotion writes, retain reconciliation capability, drain incompatible writers and account for pending Admin intentions/sessions. Reverting attribution reintroduces the known future accounting defect; it is not a financially equivalent rollback.

Require monitoring for new-purchase minor-unit reconciliation, audit/cleanup failures, pending-operation age, conflicts/replays, expiry backlog, lock waits and database load. Classify historical mismatch baselines separately from new-version mismatches. Review and approve alert ownership and write-gating/recovery thresholds. Actual operational readiness is UNKNOWN.

## 18. Release risk register

P0 = release blocker; P1 = mitigation and explicit Owner acceptance required before release; P2 = noncritical follow-up. Unknown gates are not asserted Production defects.

| ID | Priority / evidence class | Issue | Required disposition |
|---|---|---|---|
| R1 | P0 gate — verified missing access evidence | No approved read-only profile, confirmed DB identity/role or inventory | Supply existing approved mechanism or separately authorize operator preparation; no credential workaround |
| R2 | P1 — verified local tool defect, blocks inventory safety approval | Normalization output exceeds documented anomaly ceiling | Review fail-closed correction/permanent boundary coverage before Production execution |
| R3 | P1 — source coverage limitation | Established output cannot fully answer all requested eligibility/history/limit cohorts | Review minimal bounded aggregate classifications or explicitly record unresolved evidence; no ad hoc broader live queries |
| R4 | P0 conditional data/customer risk — only source/local fixtures | Active ambiguity/collisions/ownership/null rules may exist | Production evidence and per-anomaly Owner handling; incidence UNKNOWN |
| R5 | P1 historical Finance risk — Production UNKNOWN | Historical attribution differences may remain after future-only fix | Inventory, Finance materiality/reconciliation decision; no unauthorized repair |
| R6 | P0 operational gate — UNVERIFIED | Intended schema, pending migrations, safe deployment/backup restoration not established | Review actual environment and separately authorize migration/release |
| R7 | P0 integrity gate — source-supported transition risk | Mixed old/new writers cannot deliver approved guarantees | Coordinated upgrade/drain and traffic/write gate |
| R8 | P1 compatibility risk | Old Admin sessions/Mobile activation and optional enforcement | Approved session/client rollout; retain default-off flags until separate decision |
| R9 | P1 inherited engineering debt | API typecheck still fails with the documented 167 inherited diagnostics | Transparent recorded acceptance/mitigation; not a newly introduced regression |
| R10 | P1 operational evidence gap | Backup job existence does not prove recoverability/monitoring | Fresh restore evidence, RPO/RTO/operator and alert/rollback approvals |
| R11 | P2 follow-up | Broader type cleanup, native-device validation expansion, inventory presentation improvements | Track independently without replacing release-critical evidence |

**Verified Production problems: none established because Production data was not queried.** This means unknown, not clean. The verified new finding concerns the local inventory safety contract, not a newly discovered Promotions engine regression.

## 19. Unverified conditions and decision framework

| Required question | Answer |
|---|---|
| Is local implementation verified? | Yes, by preserved 372-test closure evidence; application candidate hashes unchanged. Inventory preflight has a newly demonstrated limit gap. |
| Did Production inventory complete? | No; BLOCKED ON ACCESS, zero DB queries. |
| Active ambiguous codes? | UNKNOWN. |
| Automatic-with-code records? | UNKNOWN. |
| Ownership/usage constraints at risk in actual data? | UNKNOWN; source-supported risks are documented. |
| Historical Finance attribution discrepancies present? | UNKNOWN. |
| Would proposed strict policy interrupt customers? | Could; actual cohort/distribution evidence UNKNOWN. |
| Historical remediation required? | UNKNOWN; not authorized or presumed. |
| Is 0137 operationally safe for this target? | Locally tested, target operational preconditions UNVERIFIED. |
| Rollout dependencies understood? | Defined from source; actual deployed topology/versions/settings UNVERIFIED. |
| Backup/monitoring/rollback defined? | Requirements defined, actual execution readiness UNVERIFIED. |
| Exact approvals outstanding? | Listed below. |

No full 372-test rerun, fresh API/Admin builds or new compiler run was justified by this read-only assessment; none is claimed. The known 167 diagnostics remain inherited, not new failures created by this task. Prior local results are cited as preserved evidence, not relabeled as tests executed today in this assessment.

## 20. Exact remaining approvals and release-gate checklist

The Owner's narrow inventory authorization is recorded; **the access and safety prerequisites remain unmet**. Before a future inventory: identify/approve the existing read-only profile/secret mechanism and non-secret target evidence; if none exists, separately authorize the responsible operator's least-privilege access preparation. Review the proven tool limit defect and required minimal coverage plan, approve the final inventory hash, operational window, observer/cancellation plan and evidence retention. No general application credential may substitute.

Concise release gates:

- [ ] Confirm approved Production/replica identity, independently evidenced read-only role and existing access mechanism.
- [ ] Resolve/review inventory output-ceiling gap; agree minimal coverage for remaining assessment questions; preserve existing safety limits.
- [ ] Execute one bounded inventory and review its complete output; record timing/lag/load and source manifest.
- [ ] Review actual active legacy IDs, distribution/customer commitments and historical Finance findings.
- [ ] Approve precise per-anomaly runtime/remediation decisions and customer support plan; authorize any remediation separately.
- [ ] Approve final combined uncommitted candidate, compatibility plan and inherited TypeScript debt disposition.
- [ ] Verify coherent backup/restore evidence, RPO/RTO, monitoring, write gating and rollback readiness.
- [ ] Separately authorize the target's entire pending migration set including 0137; compatible schema before API.
- [ ] Upgrade/drain every API writer; verify current-authorized replay/audit/attribution behavior only under separate release verification authorization.
- [ ] Release reviewed Admin; address old browser sessions/pending intentions; coordinate Mobile correction and Worker settings.
- [ ] Approve mandatory idempotency/revision activation only after old callers/instances are accounted for; keep defaults unchanged until then.
- [ ] Obtain explicit deployment/release and any Production smoke-test authorization.

## 21. Final recommendation and evidence

**NO-GO for Production release. Assessment BLOCKED ON ACCESS; Production state UNKNOWN.** Complete safe inventory access/preflight, then assess actual results and resolve the release gates. No global runtime-policy decision, per-record remediation list or historical repair can responsibly be approved from unknown data.

Evidence bundle is saved alongside the artifact copy of this report under `/Users/abdelrahmanomar/.codex/visualizations/2026/10/22/01a1631a-cb70-7dc1-aa7d-1918c1f2a789/promotions-production-assessment`. It includes source/preservation hashes and status, sanitized access/Railway metadata, inventory safety-test log, disposable ceiling probe/result, local-only migration/shutdown logs and assessment summary. It contains no Production inventory file or Production credentials.

**Production inventory NOT EXECUTED. Production data status UNKNOWN. Release NO-GO pending authorized inventory and assessment.**

**No Production data mutations, migration execution, commit, push, deployment or runtime configuration changes were performed. Awaiting Owner review and separate release authorization.**
