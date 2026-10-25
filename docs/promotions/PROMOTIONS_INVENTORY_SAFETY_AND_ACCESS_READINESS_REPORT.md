# Promotions Inventory Safety and Access Readiness Report

Date: 2026-10-25, Africa/Cairo.

## 1. Executive verdict

**LOCAL PASS. Inventory tool: READY for separately approved execution. Production inventory: ACCESS BLOCKED. Production data: UNKNOWN.**

The demonstrated normalization-group overflow is corrected. Expanding reports now have explicit fail-closed limits, including a final 4 MiB serialized-output ceiling checked before COMMIT. All **31 permanent inventory tests passed**, with zero failures, skips, cancellations or blocked/TODO entries. Scripts/database typechecks and the focused inventory bundle build pass.

An actionable, proposed least-privilege operator procedure is in `PROMOTIONS_PRODUCTION_READ_ONLY_ACCESS_RUNBOOK.md`. Its SQL examples were not executed; no database roles, users, grants or access paths were created. Actual approved credentials, database identity, effective permissions, secret-loading procedure and operational window are still unavailable/unverified. No Production/staging access or secret retrieval occurred.

This task does not change Promotions engine behavior, durable saves, monetary attribution, schemas or migrations. The previous 372-test closure evidence remains the application baseline; it was not relabeled as tests rerun during this task.

## 2. Repository safety and preservation

Worktree: `/Users/abdelrahmanomar/.codex/worktrees/promotions-phase1a/Central-Studio-System-main`. Branch: `codex/promotions-phase1a`. HEAD and read-only `origin/main`: `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`; no newer main/integration conflict.

Before edits, all 38 closure files matched their saved SHA-256 manifest. The later Production assessment report was also preserved, making 39 initial files. Their complete initial contents/status/hashes were saved. Only the inventory source, its tests and existing release runbook changed among those files. All other 36 initial files remain byte-identical, including every Promotions application implementation file, migration 0137, schema/journal, allocation code, Admin and Mobile corrections, and historical assessment/closure reports. Two new documents are this report and the access runbook.

The original dirty Downloads checkout's complete Git status remains identical to the initial snapshot. Nothing was reset, cleaned, rebased, cherry-picked, staged, committed, pushed or deployed. No dependencies, lockfiles, generated contracts or runtime flags changed.

## 3. Confirmed root causes, established before correction

1. **Normalization groups:** the source built `normalizedCollisions` and immediately committed/returned it. There was no 10,000-group check. The previous disposable probe returned 10,002 groups successfully.
2. **Counters/references:** counter discrepancies could expand to the 50,000-code input ceiling. Package references expanded per rules-array entry without an explicit output-entry bound. These are output categories, not bounded merely by the number of Promotions.
3. **Serialized output:** the 16 MiB limit bounded logical rules/code input, not the complete pretty-printed exported JSON. No final UTF-8 serialization ceiling existed; serialization happened after COMMIT in the CLI.
4. **Session overrides:** installed node-postgres parses connection-string settings with precedence over pool defaults (`connection-parameters.js`). A URL `options`/session override could weaken intended startup limits. The explicit READ ONLY transaction still existed, but timeout/default-session guarantees could not rely on pool configuration alone.
5. **Privacy/failure paths:** unsupported Promotion types were embedded verbatim in shape keys; unknown stored type text should be a fixed classification, not exported content. CLI approval/connection setup failures also sat outside sanitized handling. No Production leak was observed; these source paths were corrected locally.

The initial user-facing investigation update identified the missing array/final-output checks before edits. No business-policy or pricing defect was reopened.

## 4. Exact implementation changes

| File | Change |
|---|---|
| `scripts/src/promotionsInventory.ts` | Central fixed limits; missing array/serialization checks; safe CLI failures; override rejection; fixed unsupported-type label; bounded eligibility/history summaries; monitoring session name. |
| `scripts/src/promotionsInventory.test.ts` | Expand 3 existing tests to 31 permanent tests with isolated synthetic fixtures and actual read-only/CLI/transaction/timeout checks. |
| `docs/promotions/PHASE_1C_RELEASE_RUNBOOK.md` | Update inventory bounds/version/column-grant and access-runbook references; preserve all release/rollback gates. |
| `docs/promotions/PROMOTIONS_PRODUCTION_READ_ONLY_ACCESS_RUNBOOK.md` | Proposed operator preparation, least-privilege examples, effective-permission review, approved execution, cancellation and access closure. |
| `docs/promotions/PROMOTIONS_INVENTORY_SAFETY_AND_ACCESS_READINESS_REPORT.md` | This report. |

No general analytics layer, new dashboard, migration or access framework was introduced. Output format is explicitly version **2**; it is a local inventory artifact, not a customer/Admin API contract. Existing output fields remain, with bounded additions and safe unsupported-type classification.

Verified tool SHA-256: `36ed0ee3129aac07debb4e8f840a3fac6b2ac765407b3863e633cf2db12e5421`. This is an **uncommitted candidate** on the stated HEAD; approving HEAD alone does not identify these local changes. The evidence manifest binds the exact files.

## 5. Enforced bounds and fail-closed behavior

| Resource/output | Enforced ceiling |
|---|---:|
| Connections | 1 |
| Connection / statement timeout | 5 seconds / 5 seconds |
| Lock / idle-in-transaction timeout | 500 ms / 15 seconds |
| Promotions | 10,000 |
| Codes / packages | 50,000 each |
| Logical rules + code input | 16 MiB |
| Normalization collision groups | 10,000 |
| Counter discrepancy entries | 10,000 |
| Package reference entries | 10,000 |
| Ownership / Finance mismatch groups | 10,000 each |
| Promotion anomaly / eligibility review entries | 10,000 each |
| Exact pretty-printed UTF-8 JSON, including final newline | **4 MiB** |

Nested code-ID membership is additionally bounded by the 50,000-code ceiling. Shape labels are a fixed type/zero-one-multiple set, aggregate fields have fixed keys, and all repeated diagnostic categories are fixed labels. Invalid/unsupported stored text is not a new unbounded output key.

The final byte cap applies independently even if every category is individually within its entry ceiling. Input row queries still retrieve limit+1 and fail rather than truncate. Package references stop on entry overflow; collision/counter arrays fail before success. Full serialization is validated while the read-only transaction is still open, then COMMIT succeeds, then the CLI emits the complete JSON. Any overflow/query/serialization/commit error returns no successful report; no partial finding set is presented as clean.

CLI failures use fixed actionable messages for declared limits, statement cancellation/timeout and lock timeout; other server/connection errors are sanitized. No raw database error detail or credential-bearing URL is printed. Approval and missing-profile failures also produce nonzero exit and no stdout. Limits cannot be raised by CLI flags; URLs cannot override session safeguards.

## 6. Classification coverage and performance review

Added within already bounded Promotion rows:

- Separate `valid`, `null`, `malformed`, `unsupported` and `invalid` rule statuses, with no raw values/validation issue text.
- Automatic Promotions without audience/package/branch/minimum/first-purchase/verified-account restrictions, with active counts and a separate rule-usage-limit indicator. This is a review flag, not a claim of misconfiguration or current eligibility.
- Branch restrictions incompatible with package checkout's absent branch context; class eligibility can still be valid.
- Null-rule runtime fallback explicitly classified without changing it.
- Fixed `unsupported` shape label instead of exporting unknown type text.

Added distinct referenced Code-ID and Promotion-with-redemption counts to the **existing** redemption aggregate query. A synthetic historical ownership fixture verifies those positive counts and mismatch evidence without customer IDs. Existing date, code-shape, package-reference, counter, ownership and historical attribution output remains.

No new data query or table scan was added: eight data SELECT query sites remain; the same source has 12 client-query sites including transaction/SHOW/commit/rollback controls. Classification uses the rows already read. The two COUNT DISTINCT aggregates add work to the existing redemption count scan; large histories may need aggregation/sort memory and can still exceed five seconds. Output ceilings do not bound scan cost. Existing ownership/reconciliation/code-history joins can scan whole histories. The unchanged 5-second statement timeout and approved-window/load observation remain essential; no Production performance claim is made from local fixtures.

Still intentionally out of scope: per-customer identity/limit analysis, customer code-distribution evidence, complete missing-payment/redemption counterpart checks, or a universal checkout-capable cohort. The report carries limitations. Current dates/account/order/code/limit context still governs runtime. No inventory finding changes eligibility or performs remediation.

## 7. Privacy and read-only guarantees

Fixed SELECT data queries, one repeatable-read READ ONLY transaction and startup read-only setting remain. No application startup, background job, migration runner, repair statement or write API is imported. Connection URL overrides of options, timeouts/read-only settings, application name and related startup controls are rejected before connection. The approved role/target/TLS requirements remain operator gates, not assertions made from an arbitrary URL.

No customer identity/contact, raw code/rules, payment credentials, provider references or operation response bodies are exported. Private synthetic names/contacts/codes/rules/type text are tested absent from output. Unknown exceptions are sanitized. Database READ ONLY remains defense in depth; it does not prove an independently least-privilege identity, which is why actual access remains blocked.

All fixture INSERT/DELETE/DDL and cancellation actions were confined to a **newly created local disposable database**. DML/DDL rejection tests use that database's read-only connections; none were attempted in Production. View/function fixtures pause or delay a SELECT only for test control and are removed afterward. No production test hook or schema change was added.

## 8. Permanent regression results

**31 executed, 31 passed, 0 failed, 0 skipped, 0 cancelled, 0 blocked/TODO.** Final complete suite runtime recorded by the runner: approximately 19.1 seconds. Counts are final test entries, not accumulated repeated runs.

| Coverage | Tests |
|---|---:|
| Existing synthetic classification/privacy/nonmutation, INSERT rejection, logical payload overflow | 3 |
| Normalization groups: exactly 10,000 succeeds; 10,001 rejects | 2 |
| Counter discrepancies: exactly 10,000 / 10,001 | 2 |
| Package references: exactly 10,000 / 10,001 | 2 |
| Promotion/code/package record boundary and overflow | 6 |
| Exact 4 MiB UTF-8 serialized boundary, ASCII/multibyte overflow | 1 |
| Real DB combined-output overflow; CLI no partial JSON | 1 |
| Valid CLI complete success; missing approval failure | 2 |
| URL override rejection; sanitized errors | 2 |
| Broad/null/malformed/unsupported/branch context/privacy classifications | 1 |
| Repeatable-read concurrent snapshot; statement timeout; lock timeout; explicit cancellation | 4 |
| UPDATE/DELETE/TRUNCATE/DDL rejection | 4 |
| Positive historical aggregate/ownership/privacy evidence | 1 |
| **TOTAL** | **31** |

Snapshot verification uses observed PostgreSQL advisory-lock state to pause after snapshot creation, performs a concurrent synthetic insert, then proves every inventory query excludes it. Timeout tests deliberately delay a disposable SELECT to trigger the real 5-second deadline; the delay is not evidence of race ordering. Actual inventory sessions assert read-only, repeatable-read and all timeout values inside the test-only SELECT wrapper. Timeout/cancellation failures release the connection/snapshot; local PostgreSQL logs confirm ROLLBACK. Lock/serialized-output CLI failures have empty stdout and nonzero exit.

Fresh local cluster: `/tmp/promotions-inventory-readiness-20261025/pgdata`, localhost port 55455; database `promotions_inventory_readiness_disposable`, synthetic-only trust-auth identity. It was initialized with the existing migration chain and shut down after checks. No earlier database/cluster was reused.

Exact suite command:

```sh
DISPOSABLE_PROMOTIONS_INVENTORY_DATABASE_URL=postgresql://inventory_test@127.0.0.1:55455/promotions_inventory_readiness_disposable lib/db/node_modules/.bin/tsx --test scripts/src/promotionsInventory.test.ts
```

The previous 372-test application matrix was not rerun: no application dependency or runtime code changed. Its three original affected inventory cases remain within the expanded, passing 31-test suite. Do not add these totals together as if a new 400-test full application run occurred.

## 9. Build and typecheck results

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc -p scripts/tsconfig.json --noEmit` | Exit 0, PASS |
| `node node_modules/typescript/bin/tsc -b lib/db` | Exit 0, PASS |
| `artifacts/api-server/node_modules/.bin/esbuild scripts/src/promotionsInventory.ts --bundle --platform=node --format=esm --packages=external --outfile=/tmp/promotions-inventory-readiness-20261025/promotions-inventory.mjs` | Exit 0, PASS |
| `git diff --check` | Exit 0, PASS |

The bundle check compiles the focused script with external workspace/database dependencies; it is not a deployed artifact or a fresh API/Admin build. Initial invocation at a nonexistent root esbuild path was corrected to the installed workspace binary; that was a check invocation issue, not a source/dependency change. Source CLI execution is separately tested end-to-end.

API/Admin builds and the API's nonzero typecheck with **167 inherited diagnostics** remain the preserved closure evidence, not checks executed during this task. No new API typecheck PASS is claimed. Scripts/database checks pass and application hashes are unchanged. No unrelated dependency, lockfile or generated-file update was needed.

## 10. Database and migration impact

No application schema/migration/journal change. Existing migration execution only initialized this task's newly created disposable cluster/database. No existing environment was migrated. No user/role/privilege/access mechanism was created, including during local tests; the operator SQL examples were reviewed as documentation only.

No historical business/Finance record was rewritten. Fixture construction/removal affects only newly created synthetic local rows. Existing proportional attribution, immutable history, code ownership/limits, transactional locks/audits and durable operation guarantees are unchanged.

## 11. Production read-only access preparation

The new access runbook separates preparation, authorization, execution, monitoring and evidence review. It uses the existing Central Studio/Railway architecture and requires a dedicated identity rather than runtime/migrator/backup credentials. It documents future, separately authorized role preparation if no suitable identity exists, exact column SELECT grants, secure authentication/LOGIN activation and later rotation/revocation.

No Railway secret retrieval, Production metadata/database connection or access provisioning was performed in this task. Existing repository access/deployment material and the previous sanitized metadata assessment were reviewed. Actual approved access is not established by a local CLI session, project label or sample SQL.

## 12. Required permissions and verification

Minimum schema USAGE, target database CONNECT and column-level SELECT only:

- `promotions`: id, type, is_active, rules_config, discount_type, discount_value, start_date, end_date.
- `promotion_codes`: id, promotion_id, code, current_uses.
- `promotion_redemptions`: id, promotion_id, promotion_code_id, package_order_id, booking_id, discount_amount.
- `price_packages`: id, is_active.
- `payment_records`: id, flow_type, package_order_id, booking_id, discount_amount_minor.

No customer table, student ID, sequences, payment credentials or future-table default privileges are needed. Operator must verify effective privileges, PUBLIC/inheritance/SET ROLE paths, ownership and elevated attributes, extra sensitive SELECT, unsafe function execution and RLS completeness. NOINHERIT/default READ ONLY alone is not sufficient. The runbook includes catalog examples and requires zero memberships, no ownership/superuser/migrator/app write authority, no unwanted CREATE/TEMP/write grants and review of shared-ACL effects before any change.

Privilege examples were checked against official PostgreSQL role/privilege documentation linked in the runbook. They are not proof of actual live role configuration. Any PUBLIC/default privilege obstacle requires a separately approved impact review, not an automatic global revoke.

## 13. Operational execution and cancellation

Before one future run: verify exact Production/replica fingerprint without publishing credentials, independently document role scope/TLS and replica lag, select approved secret loader, bind tool hash/window/operator/observer and total-run deadline/load envelope, and approve restricted evidence retention.

Execute only the script with `--approved-read-only-inventory`, one dedicated connection and unchanged limits. Keep URL in the approved environment-secret injection, never arguments/trace/reports. Stage output privately and publish only after successful exit and complete bounded JSON validation. No automatic retry or limit relaxation. Track `central-promotions-inventory` with the existing authorized observer; cancel on load/lag/identity/lock/timeout/output anomaly, ensure rollback/session closure, and retain failed evidence distinctly. Never start API/Worker/migration predeploy as an inventory method.

The procedure documents secret removal and separately approved access closure/rotation. NOLOGIN does not end existing sessions; only an already authorized operator may cancel/terminate the exact assessment connection as required. No broad monitor/signal role is granted to the inventory identity.

## 14. Remaining access prerequisites

**ACCESS BLOCKED:** no approved concrete read-only profile/secret loader, target/role/effective-privilege evidence, complete RLS/TLS/replica freshness review, approved operational window or designated observer has been established. Production inventory remains unexecuted and Production data UNKNOWN.

The inventory tool's safety defect is resolved locally; the earlier assessment remains a historical record of its pre-correction state. Population, active legacy ambiguity, distributed-code status, ownership/usage risks and historical monetary discrepancies still require real authorized evidence. No Strict Runtime Rejection or Preserve Legacy policy was selected/activated by this work.

## 15. Exact Owner approvals required

1. Review this local correction and exact candidate manifest/tool hash.
2. Separately authorize the responsible operator's least-privilege access preparation if no approved identity/profile exists, including any necessary shared-ACL/access-route impact review.
3. Approve target/replica, effective permission/ownership/RLS/TLS evidence, secure secret-loader mechanism, window, observer, load/deadline/cancellation criteria and evidence retention/access-closure plan.
4. Separately authorize one bounded Production inventory after those prerequisites pass.
5. Review actual findings before legacy policy/remediation decisions. Migration 0137, mandatory flags, any historical repair and deployment remain separate approvals outside this task.

## 16. Final recommendation and evidence

**Tool READY, local task PASS. Production inventory ACCESS BLOCKED. Production release NO-GO pending actual inventory and later release gates.**

Evidence bundle: `/Users/abdelrahmanomar/.codex/visualizations/2026/10/22/01a1631a-cb70-7dc1-aa7d-1918c1f2a789/promotions-inventory-safety-readiness`. It contains final tests/typecheck/build logs, source/status/preservation hashes, scoped patch, safe local transaction-log excerpts, assessment summary and both deliverables. No Production output or credentials are included.

Promotions Inventory safety corrections and local verification completed. Production inventory remains unexecuted pending separately approved read-only access and operational authorization. No Production access, data mutation, migration, commit, push or deployment was performed.
