# Promotions Phase 1C — Final Closure Report

Date: 2026-10-25 (Africa/Cairo). Scope: approved local proportional-attribution correction, disposable verification and Owner review.

## 1. Executive summary

**Phase 1C: LOCAL PASS. Production release: NO-GO pending separate release gates.**

All **372 executable tests passed: 0 failed, 0 skipped, 0 cancelled, 0 blocked/TODO**. This includes every entry in the previous 330-test matrix, both former financial failures, 21 new allocation unit tests and 21 additional authenticated PostgreSQL integration tests. The customer discount, gross amount and final payable calculation have not changed. Future redemption rows now reconcile exactly in minor units with the applied Finance discount.

API and Admin production builds pass. Admin, database, scripts and focused Mobile typechecks pass. **API typecheck FAILS with 167 inherited diagnostics**, byte-identical to the documented baseline; no new diagnostics were introduced. No native Mobile device/emulator verification or full Mobile production build is claimed.

Historical business records were not repaired or rewritten. Production inventory remains unexecuted. Local PASS establishes the tested implementation behavior, not clean Production data or release permission.

## 2. Repository safety and baseline

The isolated implementation checkout is `/Users/abdelrahmanomar/.codex/worktrees/promotions-phase1a/Central-Studio-System-main`, on `codex/promotions-phase1a`. HEAD and read-only remote `refs/heads/main` checks before and after implementation both resolve to `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`. There is no newer main change or material baseline integration conflict.

All 35 existing implementation files matched the previous Phase 1C SHA-256 manifest before editing. Initial contents were copied to the evidence directory. Only the service, Phase 1C integration suite and release runbook among those files changed in this closure; all other previous implementation files remain byte-identical. New files are the allocation helper, its tests and this report. Migration 0137, its schema/journal, durable storage/protocol, Admin source, customer routes, Mobile activation correction and generated contracts are unchanged in this closure.

The original Downloads checkout remains untouched; its complete Git status matches the initial snapshot. No reset, clean, rebase, cherry-pick, stage, commit, push or deployment occurred. All implementation changes remain uncommitted. Evidence includes initial/final hashes, status, combined patch and closure-only patch.

## 3. Approved proportional-allocation policy

The Owner approved proportional attribution. Each selected candidate's existing calculated discount supplies its minor-unit weight. The unchanged checkout aggregate is authoritative. When that aggregate is capped, attribute it proportionally; when uncapped, preserve each weight. This correction changes applied accounting attribution only. It does not select different Promotions, create a new pricing policy or enforce `isExclusive`.

## 4. Root cause and previous failure evidence

`createPromotionRedemptions` previously persisted `min(candidate.discountAmount, aggregateDiscount)` independently for every selected Promotion. That limits individual rows but does not distribute a shared cap.

The previous saved `phase1c-tests.log` records `64000 !== 40000` for a package and `48000 !== 30000` for a class, in piastres. These two failures were retained as permanent assertions and strengthened with exact individual allocations and unchanged gross/final amounts. They were not deleted, weakened or redefined as acceptable discrepancies.

## 5. Implementation and affected files

| File | Closure change |
|---|---|
| `artifacts/api-server/src/lib/promotionAllocation.ts` | Small pure, Promotions-specific integer allocation helper. |
| `artifacts/api-server/src/lib/promotionService.ts` | Convert the authoritative aggregate and existing candidate weights through existing money utilities; allocate once before insertion; persist applied shares. |
| `artifacts/api-server/src/lib/promotionAllocation.test.ts` | 21 deterministic mathematical and boundary regressions. |
| `artifacts/api-server/src/routes/promotions.phase1c.integration.test.ts` | Preserve all 46 original cases, strengthen the two former failures, add 21 real authenticated PostgreSQL cases. |
| `docs/promotions/PHASE_1C_RELEASE_RUNBOOK.md` | Record approved/implemented allocation, future-only scope, remaining release gates. |
| `docs/promotions/PROMOTIONS_PHASE_1C_FINAL_CLOSURE_REPORT.md` | This final report. |

Both production callers, package order creation and direct-class booking creation, already call this shared persistence function inside their financial transaction after locked eligibility evaluation. Neither route required a pricing or request/response change. Finance does not implement a second allocator.

## 6. Integer precision and deterministic remainder handling

`egpToMinor` performs the existing rounding boundary for the aggregate and each already-calculated candidate weight. Thereafter, allocation uses BigInt sums, products, integer division and remainder. For each persisted Promotion identity, floor `appliedMinor × weightMinor / sumWeights`. Distribute the leftover piastres by descending fractional remainder, breaking ties by ascending Promotion ID. Input order cannot change the identity-to-amount result. Convert each final integer share with the existing `minorToEgp` at the existing decimal redemption field boundary.

Inputs must be nonnegative safe integers and identities positive safe integers. A positive applied amount greater than total weights fails closed before inserts. Empty/zero allocations, zero weights and products beyond Number's safe multiplication precision are tested. No negative or excessive allocation is possible; the exact integer sum equals the applied aggregate. The helper does not change the existing currency model or database money column types.

## 7. Package purchase financial verification

Authenticated HTTP checkout with two stackable 80% Promotions on a 400 EGP catalog package now creates two 200 EGP redemption rows. Payment gross remains 400 EGP, discount 400 EGP and payable zero. Actual route tests verify Promo/Code identity, payment record, payment events and purchase snapshots.

The package suite additionally verifies fixed and mixed contributions, uncapped values, small catalog amounts, zero rows/counts, history preservation, second-redemption-insert failure rollback and two concurrent valid purchases using an observed PostgreSQL lock barrier.

## 8. Direct-class booking financial verification

Authenticated direct-class checkout with two stackable 80% Promotions on a 300 EGP schedule now records 150 EGP for each Promotion. Payment gross remains 300 EGP, discount 300 EGP and payable zero.

Equivalent fixed, mixed, uncapped, rounding, zero, rollback and concurrent scenarios pass against real bookings/payment/redemption tables. Schedule prices remain integer EGP under the existing schema; fractional attribution is exercised using a 1 EGP class and three 0.80 EGP contributions, producing 0.34/0.33/0.33 EGP. No catalog/schema precision policy was changed to create test fixtures.

## 9. Before/after examples

| Scenario | Prior persisted amounts EGP | Correct persisted amounts EGP | Unchanged applied / final EGP |
|---|---|---|---|
| Package 400; 80% + 80% | 320 + 320 = 640 | 200 + 200 = 400 | 400 / 0 |
| Class 300; 80% + 80% | 240 + 240 = 480 | 150 + 150 = 300 | 300 / 0 |
| Subtotal 400; weights 300 + 200 | 300 + 200 = 500 | 240 + 160 = 400 | 400 / 0 |
| Subtotal 400; fixed 100 + 150 | 100 + 150 = 250 | 100 + 150 = 250 | 250 / 150 |
| Subtotal 0.03; weights 0.02 + 0.02 | Aggregate previously over-attributed | 0.02 + 0.01 = 0.03 | 0.03 / 0 |

The requested 1,000 EGP uncapped example is mathematically the same 100 + 150 = 250 allocation; the permanent unit test asserts its applied weights, while authenticated route tests independently cover uncapped catalog checkout.

## 10. Historical data preservation evidence

The correction inserts future applied values; it contains no update/backfill of redemption, payment, event, order or booking history. Existing per-purchase existence checks still skip stored redemption rows rather than rewriting them. The originalSubtotal/finalSubtotal fields remain whole-purchase snapshots, not a per-Promotion price reconstruction.

Real route fixtures compare complete redemption/payment/event/order/booking rows before and after later configuration edits/deactivation. Concurrent capped-purchase snapshots remain identical after later edits. Earlier Phase 1A/B tests also preserve financial history through used-code rename rejection, durable save replay/reconciliation and audit failure. Upgrade tests compare representative pre-migration historical records before/after migration 0137 and rerun. All pass.

Historical Production attribution may still disagree with payment discounts. No inspection or repair occurred. Future correction is not evidence that older transactions reconcile; any historical repair requires a separate proposal and authorization.

## 11. Finance reconciliation

For positive-discount purchases, persisted minor-unit allocations sum exactly to `payment_records.discount_amount_minor`. Gross, final payable, currency, payment/redemption references and event identities remain governed by the existing transaction. Discount events remain non-cash reductions; no cash-out, fabricated expense or extra Finance transaction was introduced. Existing Finance readers and permissions/money tests all pass. Finance still joins current Promotion names; no display/history redesign occurred.

Theoretical candidate amounts remain private pricing inputs. The changed redemption `discountAmount` is the applied monetary attribution used for historical discount reporting; no public theoretical-discount field was repurposed. Validation/quote aggregate amounts and metadata contracts are unchanged.

## 12. Redemption counts and limits

Allocation does not filter out selected zero-attribution Promotions. With a positive aggregate, such Promotions still receive a zero-valued redemption row and consume existing row-based usage/code counts. With zero aggregate, the existing early return creates no redemption. Both behaviors are tested.

Legacy automatic Promotions with attached codes can appear twice in candidate selection. Existing persistence consumes one row per Promotion per purchase, retaining the first candidate's code association. The allocator combines that identity's weights so the one row reconciles; it does not add rows, choose a new code, increment a previously uncounted code, or change the double-candidate pricing behavior. A real package test asserts one row, null code, unchanged code counter and exact aggregate attribution. Resolving that legacy eligibility ambiguity remains a separate Owner decision.

## 13. Phase 1A regression

All 64 CRUD tests pass: normalization/duplicates, immutable ownership, unused in-place rename, used-code protection, one code for compliant new Manual Promotions, merged POST/PATCH validation, omitted values, legacy guards and preserved history. Previous unrelated inherited atomicity fixture problems were already corrected in prior phases and their current suites pass.

## 14. Phase 1B regression

30 concurrency/audit, 30 durable protocol and 11 revision/timestamp tests pass. The six former durable blockers remain executable, not TODOs: operation admission/uncertain recovery, cross-instance request contention, lost response/restart/replay, permanent binding, retained expiry identities and strict transactional audit behavior remain covered in the durable suite.

Replay reauthorizes the current actor/RBAC; conflicts, actor switching, revoked tokens, changed payload reuse, reservation/terminal expiry, cleanup concurrency and tombstones pass. Admin recovery/error/browser behavior passes. Mandatory idempotency and revision enforcement remain disabled by default; strict mode is exercised only in isolated tests.

## 15. Phase 1C regression

All 67 authenticated Phase 1C cases pass. Legacy classification, dates, rules, limits, eligibility, stacking/priority, first-purchase semantics, package-credit exclusion, server-owned pricing and Mobile activation safety remain intact. All-stackable selection still adds calculated discounts with the existing subtotal cap. A non-stackable candidate retains best-candidate selection. `isExclusive` remains metadata, with no new enforcement. First-package purchase still uses existing account/order semantics, including non-cancelled unpaid orders.

The direct-class entered-code forwarding helper and no-code expected-final-price mismatch guard remain byte-identical to the prior implementation. Old no-code requests without a quoted final total retain existing full-price semantics.

## 16. Full permanent test matrix

| Suite/log | Executable | Passed | Failed / skipped / blocked |
|---|---:|---:|---|
| Phase 1A CRUD | 64 | 64 | 0 / 0 / 0 |
| Phase 1B concurrency/audits | 30 | 30 | 0 / 0 / 0 |
| Durable replay/cross-instance/retention | 30 | 30 | 0 / 0 / 0 |
| Revision/timestamps | 11 | 11 | 0 / 0 / 0 |
| Package capture atomicity | 3 | 3 | 0 / 0 / 0 |
| Class capture atomicity | 3 | 3 | 0 / 0 / 0 |
| Booking contracts/Finance permissions/money | 51 | 51 | 0 / 0 / 0 |
| Finance read model | 44 | 44 | 0 / 0 / 0 |
| Admin save/error feedback | 11 | 11 | 0 / 0 / 0 |
| Relevant security hardening | 2 | 2 | 0 / 0 / 0 |
| Migration 0137 fresh/upgrade/repeat | 3 | 3 | 0 / 0 / 0 |
| Read-only inventory | 3 | 3 | 0 / 0 / 0 |
| Mobile activation/error handling | 7 | 7 | 0 / 0 / 0 |
| New proportional allocation unit tests | 21 | 21 | 0 / 0 / 0 |
| Phase 1C real authenticated HTTP/PostgreSQL | 67 | 67 | 0 / 0 / 0 |
| Built Admin browser | 20 | 20 | 0 / 0 / 0 |
| Built Admin → authenticated API → PostgreSQL | 2 | 2 | 0 / 0 / 0 |
| **TOTAL** | **372** | **372** | **0 / 0 / 0** |

Counts represent final complete suite runs, not accumulated retries. Early development failures in new fixtures (wrong fixed-discount enum, fractional schedule price, snake-case counter, booking account-owner column, and blocking a later lock identity) were corrected to match actual contracts. No financial assertion was relaxed. Final capped concurrency tests hold the earliest discovered Automatic identity and release only after both requests are observed waiting in `pg_locks`; no arbitrary sleep proves ordering. Failure injection aborts the second redemption insert after the first financial writes, proving transactional rollback and subsequent valid retry.

## 17. Exact commands and evidence

Evidence bundle: `/Users/abdelrahmanomar/.codex/visualizations/2026/10/22/01a1631a-cb70-7dc1-aa7d-1918c1f2a789/promotion-phase1c-closure`.

`matrix-executions.json` records the exact 15 nonbrowser command argument arrays and explicit local disposable URL environment variable per suite. `check-executions.json` records build/typecheck arguments and working directories. `test-results.json` records final counts parsed from each suite's own summary. `run-matrix.py` is the executed reproducible sequential runner; `run-checks.py` records independent build/type jobs. Individual logs retain test names and failures, if any. `previous-attribution-failures.log` preserves prior evidence; development/debug logs are separate from the final matrix.

From the isolated worktree, the shared test form was:

```sh
lib/db/node_modules/.bin/tsx --test <permanent-test-files>
```

For the new suite:

```sh
DISPOSABLE_PROMOTIONS_PHASE1C_DATABASE_URL=postgresql://promo_test@127.0.0.1:55453/promotions_phase1c_closure_disposable lib/db/node_modules/.bin/tsx --test artifacts/api-server/src/routes/promotions.phase1c.integration.test.ts
lib/db/node_modules/.bin/tsx --test artifacts/api-server/src/lib/promotionAllocation.test.ts
```

These are temporary local trust-auth test URLs, not existing-environment credentials. A fresh PostgreSQL 18 cluster was initialized under `/tmp/promo-phase1c-closure-evidence/pgdata` on localhost port 55453. The full existing migration chain initialized the new empty `promotions_phase1c_closure_disposable`; before tests, it was cloned into newly created `promotions_phase1c_closure_regression_disposable` and `promotions_phase1c_closure_durable_disposable`. Migration upgrade tests created their own additional disposable databases. No earlier cluster was restarted.

Browser suites ran serially against the newly built Admin preview at `http://127.0.0.1:5190`, with `PROMOTIONS_ADMIN_TEST_URL` set to that URL, `PLAYWRIGHT_MODULE_PATH=/Users/abdelrahmanomar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`, and `PROMOTIONS_TEST_CHROME=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`:

```sh
node --test artifacts/admin/src/pages/promotions.browser.test.mjs
node --test artifacts/admin/src/pages/promotions.fullstack.browser.test.mjs
```

The second command also used `DISPOSABLE_PROMOTIONS_BROWSER_DATABASE_URL=postgresql://promo_test@127.0.0.1:55453/promotions_phase1c_closure_durable_disposable` and a local screenshot path. The first suite verifies actual Admin UI/customFetch against controlled responses; the second uses real authentication/API/PostgreSQL. They are not represented as native Mobile tests.

## 18. API/Admin/Mobile compatibility

No customer request/response fields, generated contracts, Finance event shapes or schema changed. Existing Admin operation protocol, authentication lifecycle and capability detection are unchanged. Package pricing remains server-owned. Direct-class Promo Code support, activation forwarding, quote mismatch guard and package-credit exclusion remain.

Old Admin + old API retains old behavior without new guarantees. Old Admin + new API remains supported while mandatory flags are off, without durable identity guarantees for keyless requests. New Admin + new API uses the verified protocol. New Admin + old API refuses new saves on missing capability rather than retrying unsafe keyless writes. All API writers must run the reviewed version before claiming integrity/attribution guarantees. Existing Mobile clients can receive the previously documented safe 409 for omitted activation with a lower quoted final total; the reviewed Mobile forwarding correction must be part of the separately approved rollout.

## 19. Builds and type safety

| Check | Exit/result |
|---|---|
| `node artifacts/api-server/build.mjs` | 0, PASS |
| Admin `VITE_API_URL='' node node_modules/vite/bin/vite.js build --config vite.config.ts` | 0, PASS |
| `tsc -p artifacts/admin/tsconfig.json --noEmit` | 0, PASS |
| `tsc -b lib/db` | 0, PASS |
| `tsc -p scripts/tsconfig.json --noEmit` | 0, PASS |
| Focused strict Mobile helper/tests typecheck | 0, PASS |
| `tsc -p artifacts/api-server/tsconfig.json --noEmit` | **2, FAIL: 167 inherited diagnostics; unchanged baseline** |
| `git diff --check` | 0, PASS |

The compiler is `node node_modules/typescript/bin/tsc`. The exact focused Mobile flags are in `check-executions.json`. API output was compared byte-for-byte with `/tmp/promo-phase1a-evidence/baseline-tsc.log`; no newly introduced diagnostics, including changed files. API typecheck is explicitly not counted as passing. Existing build warnings do not alter these exit results. No dependency, lockfile or generated contract was manually modified.

## 20. Database/schema/migration impact

No schema or migration change in this closure. Migration 0137, Drizzle definition, export and journal remain byte-identical to the initial saved manifest. Three fresh/upgrade/repeat migration tests pass, including historical snapshot preservation, constraints/immutability and retention behavior from previous implementation. Temporary failure-injection triggers exist only inside the new disposable cluster and are removed by fixtures. No existing environment was migrated.

## 21. Legacy findings and Production unknowns

Previous Phase 1C classification remains valid: multiple/no-code Manual Promotions, Automatic Promotions with attached codes, normalized collisions/noncanonical codes, ownership mismatches, counters/history discrepancies, invalid rules and missing/inactive package references can exist. API returns all codes while current Admin displays the first; mutation guards do not prove globally clean runtime data. JSON-null rules retain existing empty-rule fallback. Distributed-code status cannot be inferred from zero use.

No global runtime rejection was activated, no code retired, normalized, merged, reassigned or deleted, and no counter reset. Inventory remains read-only and unexecuted against Production. It still reports old monetary discrepancies because this future-only correction does not erase them. No assumption of clean historical Finance data is made.

## 22. Release-readiness assessment and runbook

The local accounting blocker is resolved. The updated `PHASE_1C_RELEASE_RUNBOOK.md` remains the executable procedure for a later separately authorized operator. It specifies existing authorized read-only access, bounded queries, safe load/cancellation, release ordering, capability/flag/session handling, monitoring and rollback.

Required release gates remain: Owner-authorized/reviewed Production inventory; customer-impact assessment; precise legacy runtime/remediation policy; separately authorized migration 0137; all API writers upgraded/drained without mixed-version reliance; reviewed Admin/Mobile compatibility and old open sessions; backup/monitoring/rollback readiness. Mandatory idempotency/revision activation requires a separate compatibility decision. No such access, activation or rollout was executed.

Inventory uses existing approved access mechanisms and minimal aggregate/record IDs, no customer names/phone/email or credentials; one read-only repeatable-read connection, 5-second statement timeout, 500ms lock timeout, 15-second idle timeout and output ceilings. Aggregation can scan relevant tables; choose a separately approved quiet window and cancel on excess load rather than silently increasing bounds.

## 23. Risks, blockers and recovery

**No unresolved critical local attribution defect remains in the verified scope.** Production unknown legacy state, distributed-code impact, historical attribution discrepancies and runtime policy remain release blockers. The unchanged nonzero API typecheck remains technical debt requiring explicit transparency in release review. Native Mobile/device verification is not part of the local evidence; rollout compatibility must be reviewed separately.

Roll back by retaining all operation identities/tombstones and business/audit history. Prefer a protocol-compatible forward correction. If older API code is unavoidable, gate Promotion mutations, preserve reconciliation/read capability, resolve original actor/key/payload operations and refresh clients. Never drop/truncate the operation table, restore it independently, allow mixed old/new writers to ignore identities, or repair financial history as part of rollback. Reverting the allocation code reintroduces the known future-attribution defect and must not be treated as a safe financial release candidate. Release monitoring must check new-purchase attribution reconciliation; historical mismatch counts alone cannot diagnose the new version.

## 24. Full diff and preservation summary

The final combined Phase 1A/1B/1C work is captured in `combined.patch` with per-file SHA-256 manifest; the six-file closure delta is captured separately in `closure-only.patch`. `summary.json` records exact combined and closure file/line counts. The closure changes three previously present files and adds three files. All other 32 initial implementation files are preserved unchanged. No generated source, dependency manifest, lockfile, migration, schema, durable operation or unrelated original workspace file changed in this closure.

## 25. Final recommendation

**GO for Owner review and local Phase 1C closure. NO-GO for Production release until the separately authorized gates above are satisfied.** The approved attribution policy is implemented and verified; no additional allocation policy decision is pending. Local PASS does not waive Production inventory, legacy/customer-impact decisions or deployment authorization.

## 26. Explicit safety/change statement

Only scoped local source/test/documentation changes and newly created disposable PostgreSQL fixtures were performed. Historical financial repair, existing-environment migrations, Production/staging access, schema changes, mandatory enforcement activation and Phase 2 redesign were not performed. All work remains uncommitted for Owner review.

**Phase 1C proportional-allocation implementation and local verification completed. No commit, push, deployment, Production access, existing-environment migration, or historical financial rewrite was performed. Awaiting Owner review and separate Production release authorization.**
