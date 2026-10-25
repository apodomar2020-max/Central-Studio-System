# PROMOTIONS FINAL RELEASE READINESS

2026-10-25. **Local release candidate ready. CONDITIONAL GO for the single approved release below; Production activation has not been performed.**

## Complete

Phase 1A/1B/1C application source still matches the verified 372-test closure: Manual one-code CRUD, Automatic eligibility, package/direct-class checkout, stacking and proportional applied-discount attribution, ownership/usage locks, transactional audits, durable authenticated Admin retries, revisions and timestamp preservation. No additional engine correction is indicated. Admin/Mobile contracts and generated clients are unchanged.

The Owner confirms there are no real customers and the existing Production data is test data. The completed inventory, as supplied by the Owner, found only Manual Promotion **3** with test code IDs **2, 3, 6, 7**, zero redemptions, and no normalization, ownership, counter or financial reconciliation mismatch. Customer distribution/communication investigation is **closed**. No repeat inventory or broad legacy runtime restriction is required.

Worktree `/Users/abdelrahmanomar/.codex/worktrees/promotions-phase1a/Central-Studio-System-main`, branch `codex/promotions-phase1a`; HEAD and read-only current remote main both `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`. No integration drift was found. Original dirty Downloads checkout remains untouched. Nothing was staged, committed, pushed, merged or deployed.

## Changes and verification

Only release preparation was needed:

- `scripts/src/promotionsTestPromotionCleanup.sql`: exact, bounded, transactional cleanup; requires approval and the release write pause. Not a migration or application endpoint.
- `scripts/src/promotionsTestPromotionCleanup.test.ts`: 11 permanent real-PostgreSQL cleanup regressions.
- This report and the existing release-runbook pointer: one current source of release instructions; prior verification reports remain historical evidence.

No application, schema, migration, generated client, dependency, authentication, role or networking changes were made in this task.

| Evidence | Result |
|---|---|
| Cleanup: exact five-row scope; unrelated/financial records preserved; audit/redemption/Admin/durable dependencies; code/type/counter drift; unexpected FK/trigger; failure after code deletion | **11 passed** |
| Existing allocation + Mobile activation/error tests | **28 passed** |
| Existing database credential/deployment boundary tests | **4 passed** |
| **Fresh focused total** | **43 passed; 0 failed/skipped/cancelled/TODO** |
| API build, including Worker/migration entry points | PASS, exit 0 |
| Admin production build | PASS, exit 0 |
| Admin, scripts, database and focused Mobile TypeScript | PASS, exit 0 |
| API TypeScript | **FAIL, exit 2: 167 inherited diagnostics; byte-identical to closure baseline; no new diagnostics** |
| Diff integrity | PASS |
| Reused closure evidence | Prior **372 passing** test matrix; application source hashes match. Its browser, authenticated checkout, audit/idempotency, finance, concurrency and migration tests were not needlessly repeated. |
| Reused inventory evidence | Prior **51 passing** focused safety/access tests; no inventory rerun. |

These are separate evidence sets, not an invented combined test total. No native Mobile build/device verification or Production smoke result is claimed yet.

Fresh disposable PostgreSQL 18 cluster: `/tmp/promotions-final-release-20261025/pgdata`, loopback 55457, `promotions_final_release_disposable`. The existing migration chain initialized this new empty synthetic database only. Test-only roles, dependencies and trigger fixtures stayed there. The cluster was shut down after checks.

Commands executed from the isolated worktree (Node available via `/opt/homebrew/bin`):

```sh
DISPOSABLE_PROMOTIONS_RELEASE_DATABASE_URL=postgresql://postgres@127.0.0.1:55457/promotions_final_release_disposable \
  lib/db/node_modules/.bin/tsx --test scripts/src/promotionsTestPromotionCleanup.test.ts
lib/db/node_modules/.bin/tsx --test artifacts/api-server/src/lib/promotionAllocation.test.ts \
  artifacts/central/services/bookingErrorMessages.test.ts artifacts/central/components/booking/promoActivation.test.ts
node --test artifacts/api-server/scripts/database-role-boundaries.test.mjs
node artifacts/api-server/build.mjs
# Working directory artifacts/admin, as in its existing production build:
VITE_API_URL='' node node_modules/vite/bin/vite.js build --config vite.config.ts
# Working directory workspace root:
node node_modules/typescript/bin/tsc -p artifacts/api-server/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p artifacts/admin/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p scripts/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p lib/db/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution Bundler --skipLibCheck --typeRoots lib/db/node_modules/@types --types node \
  artifacts/central/components/booking/promoActivation.ts artifacts/central/components/booking/promoActivation.test.ts
git diff --check
```

Logs, API diagnostic comparison and closure-preservation evidence: `/tmp/promotions-final-release-20261025/`. The unchanged application source permits reuse of `/Users/abdelrahmanomar/.codex/visualizations/2026/10/22/01a1631a-cb70-7dc1-aa7d-1918c1f2a789/promotion-phase1c-closure/`. The global workspace build still inherits the API typecheck failure; use the existing service-specific build commands, not a claim of a clean global typecheck.

## Exact test-data cleanup

**Preferred:** physically remove Promotion **3** and exactly its four owned code rows **2, 3, 6, 7**, only if dependency checks pass. Do not keep one arbitrary code, merge/reassign codes, reset sequences, change other Promotions, or touch historical finance/redemption rows.

Execute the reviewed `scripts/src/promotionsTestPromotionCleanup.sql` only after migration 0137, verified backup and all checkout/Promotion writers paused. Use the already verified administrator transport, not the inventory role, and `ON_ERROR_STOP=1` in psql. No password/URL belongs in chat or arguments. The script itself:

1. Uses a transaction, 5-second statement, 500ms lock, 15-second idle and 30-second transaction deadlines; fixed schema resolution.
2. Takes short write-excluding locks on Promotions/codes, redemption/audit and operation-reference tables. A lock timeout aborts; do not retry automatically.
3. Requires the expected database, Manual ID 3, exactly the four owned code IDs and zero code counters.
4. Requires exactly the four reviewed Promotion/code FK definitions and no unexpected user trigger on the two deletion tables. Foreign keys remain enabled.
5. Requires no redemption referencing Promotion 3 **or** any of the four codes; no Promotion audit; no linked Promotion/code Admin activity; no operation targeting/resulting in Promotion 3. It does not detach audits using SET NULL or delete operation tombstones.
6. Deletes four code rows and one Promotion row, verifies affected counts, then commits. No raw codes or customer fields are printed. On any error, ROLLBACK and stop.

Zero inventory redemptions does not establish zero audits/operations: these narrowly scoped dependency checks are part of the approved future cleanup, not a repeat inventory.

**Preapproved fallback within this one release scope:** if an expected history dependency prevents physical deletion, roll back the entire cleanup, retain every row and reference, and deactivate Promotion 3 through the new Admin/API's existing audited, revision-aware durable DELETE/deactivation operation after API deployment. Leave the four codes owned by that inactive Promotion. This removes its checkout eligibility without changing history. Do not introduce global legacy rejection. If it is already inactive, verify that and leave it so. An unexpected FK/trigger, data drift, permissions failure or timeout is a stop condition for investigation, not permission to force deletion or weaken constraints.

Before committing deletion, retain a private protected backup of the exact five test rows plus the coordinated database restore point. Do not paste raw codes into the report. Before COMMIT, rollback is automatic on failure. After COMMIT, no automatic reinsert/full-database restore: leave the obsolete test data absent during an application rollback. Any later restoration must use the exact protected backup, preserve IDs and ownership, and check for conflicting/new references; never reset sequences or independently restore financial/operation history.

## One ordered Production release

1. **Freeze the reviewed candidate and establish the window.** Obtain the single approval below. Commit/push and promote/merge only the reviewed isolated Promotions candidate through the existing release workflow; exclude the unrelated dirty checkout. Record the resulting commit/artifact identities. Account for existing automatic Railway/Admin deployment triggers so a push cannot launch an unordered release. Confirm current non-secret service targets, existing backup/restore readiness, rollback artifacts and monitoring. No new access service/role/network setting is required. With no real customers, prefer brief controlled downtime over mixed-version checkout writers; stop/drain old API instances and hold incoming test writes. Do not invent an application maintenance flag—the repository has no reviewed general write-gate flag.
2. **Verify pending migrations, then apply 0137 once.** In the existing approved administration/deployment procedure, compare the Production migration journal to the candidate. The only newly authorized migration is `0137_promotion_admin_operations.sql`; stop if unrelated migrations, drift or partial application are found. Existing `railway.toml` runs `node artifacts/api-server/dist/migrate.mjs` as API pre-deploy; it applies *all* pending migrations, so journal comparison is mandatory before allowing it. Use that existing API pre-deploy runner, do not schema-push/reset or manually mark the journal. Keep all Owner/test clients quiescent while the candidate starts; the new API may serve health checks, but no checkout or Promotion mutation is permitted before cleanup. Verify 0137's table, PK/checks/index/history trigger and journal/hash. It is additive, with no historical backfill. No second ad hoc migration owner. The Worker pre-deploy explicitly skips migration when `QUEUE_WORKER_ENABLED=true`.
3. **Perform exact cleanup while writers remain paused.** After 0137 exists, use the guarded SQL above, record only affected counts/status and the protected backup reference. Commit only the five-row deletion. If a known history dependency causes refusal, preserve the rows and use the audited deactivation fallback in step 5. Do not rerun the broad inventory. Railway starts the candidate API after its managed pre-deploy; keep client mutation traffic quiescent throughout cleanup. Do not add a second manual migration mechanism. If quiescence cannot be established, stop rather than inventing a write-gate flag or accepting mixed writers.
4. **Verify the Backend deployment and roll the Worker from the same candidate.** Verify the migrated API artifact started by the preceding deployment, check `/api/healthz`, and prove every old API/checkout writer is stopped/drained. Railway overlap/draining can retain old instances; a healthy new instance alone is insufficient. The build contains `index.mjs`, `worker.mjs`, `migrate.mjs`. Roll the existing Worker compatibly with its existing queue role; it does not run migrations or own the API-local operation retention loop. Verify migration credentials remain excluded from application runtime and that operation cleanup runs normally. Never claim new guarantees with mixed-version writers.
5. **Deploy Admin after API protocol readiness.** Using current authenticated Owner permissions, confirm `/api/promotions/save-protocol` version 1 and operation replay/status access. Build Admin with the actual existing Production API origin; the blank local test-build origin is not a deployment setting. Keep both `PROMOTIONS_REQUIRE_IDEMPOTENCY` and `PROMOTIONS_REQUIRE_REVISION` disabled/unset; verify reported mandatory flags are false. New Admin supplies keys/revisions already. Refresh/sign out old Admin tabs before editing. New Admin + old API refuses saves; old Admin + new API is compatible with optional enforcement but keyless saves do not acquire durable replay guarantees. If needed, perform the audited Promotion 3 deactivation fallback here. Do not reactivate that legacy record.
6. **Release and verify Mobile correction.** The scoped change is JavaScript activation forwarding in direct-class booking; package-credit exclusions and the API quote/final-price mismatch guard stay intact. Existing config targets EAS `production`, appVersion runtime `1.0.0`, and the configured Railway API origin. Use the existing EAS production update path only after the installed binary's actual native/runtime compatibility and Production environment values are verified; appVersion text alone is not proof. No blind OTA update to an unknown native runtime. If compatibility cannot be established, use the already configured EAS production build/install path from the same candidate before declaring Mobile active. EAS build-profile `env` entries are not automatically available to `eas update`; use the existing approved Production environment mechanism. No package install in the database container, native configuration redesign or generated-client edit. Verify the installed update/build identity on an actual supported device.
7. **Short controlled smoke tests, then reopen writes.** Keep the release window restricted to the Owner's designated synthetic account and existing test package/class catalog. Create at most two new test Promotions: one stackable Manual 80% Promotion with exactly one code, and one stackable Automatic 80% Promotion. Rename the unused Manual code in place; reject duplicate/invalid input. Retry one identical Admin operation identity and verify one mutation/audit result; reject stale revision and changed-payload reuse. Perform one package checkout and one direct-class Mobile checkout with the Manual code: both selected 80% contributions cap to the server subtotal, payable **zero**, and persisted per-Promotion minor-unit sums equal the payment discount. Do not trigger any external card/cash charge or new cash-out. Check code/promotion identity, usage increments, audit records and financial snapshots. Invalid/expired-code and stale-quote attempts must leave no partial booking/order/payment/redemption. Reject renaming the now-used code. Deactivate smoke Promotions through normal audited APIs; retain their new ledger/history. Verify account permissions and preserved gross/discount/final snapshots after deactivation. Record results and fixture IDs privately. No failure-injection triggers or financial-history cleanup in Production.
8. **Accept activation.** Confirm Promotion 3 and its four codes are absent, or that Promotion 3 is inactive with history preserved; no active ambiguity remains from this test record. Confirm new Admin saves/replay, package/class discounts, native Mobile activation, healthy API/Worker, and acceptable existing monitoring. Only then reopen normal writes and record activation. Mandatory flags remain off; strict-enforcement activation is excluded from this scope.

Railway's [pre-deploy behavior](https://docs.railway.com/deployments/pre-deploy-command) and [old deployment teardown](https://docs.railway.com/deployments/deployment-teardown) support these ordering requirements. Expo documents [runtime/channel matching](https://docs.expo.dev/eas-update/deployment/) and the [separate environment handling for updates](https://docs.expo.dev/build/updates/). No deployment metadata or cloud operation was assumed verified by local configuration alone.

## GO / NO-GO and rollback

**GO to execute this plan once approved:** no unresolved engine defect or customer-distribution policy decision remains. Exact hard-deletion eligibility is conditional on its guarded execution-time checks; audited deactivation is the preservation-safe fallback already in scope.

**NO-GO to claim Promotions live until** the backup/journal checks, coordinated writer transition, test-data retirement, actual API/Admin/Mobile deployment and zero-payable smoke assertions all pass. Stop on any unexpected migration, TLS/target/privilege failure, unknown dependency/trigger, timeout, financial mismatch, missing mandatory audit, incompatible Mobile runtime, old writer still live or load concern. The inherited 167 API diagnostics are disclosed unchanged technical debt, not new regressions or a passing typecheck; acceptance of that known baseline is part of the approval below.

On failure, keep writes paused and prefer a protocol-compatible roll-forward. Retain migration 0137, operation rows/tombstones, audits, payments, bookings/orders and redemptions. Do not drop/truncate/down-migrate the operation store or restore it independently. A pre-protocol API must not resume mutation traffic while new Admin clients can retry operation keys. Revert Admin/Mobile through the existing compatible artifact/update mechanism if needed; do not undo financial snapshots. Coordinate any database restore across the full database history and restore point, never an improvised per-table rollback. A successfully removed obsolete test Promotion need not be recreated to roll back application code.

## Single approval checkpoint

**Approve the reviewed Promotions candidate's commit/push and normal release-branch promotion/merge, the coordinated backup and brief writer pause, migration 0137 only, conditional exact deletion of Promotion 3 plus codes 2/3/6/7 (or audited deactivation if known history exists), Backend/Worker/Admin/Mobile rollout, and the bounded two-Promotion zero-payable smoke tests described above; accept the unchanged documented API TypeScript baseline.** No stricter API flags, unrelated migrations/data edits, historical financial repair, role/network changes or Phase 2 work are included. No further minor-task approvals are needed inside that scope; unexpected safety conditions still stop execution.

No Production queries, cleanup, migration, configuration changes, commit, push, merge or deployment were performed in this task. No inventory was repeated. Awaiting the Owner's one explicit approval for the final release scope.
