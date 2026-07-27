# Studio Walk-in Explicit Settlement — Hotfix Review Report

**Branch**: `hotfix/studio-walkin-explicit-payment-choice`, built from `origin/main` at `eda90b2697f011da3fc15f2f8c0c6dbc66179f2f`.

## 1. Explicit Admin choice exists

Confirmed across all three Walk-in surfaces:
- `artifacts/admin/src/components/scan-check-in-dialog.tsx` — new mandatory "Settlement Method" selector (Use Package Credit / Pay at Studio / Not Paid).
- `artifacts/admin/src/components/unified-attendance-dialog.tsx` — existing Pay at Studio / Package Credit buttons, no longer pre-selected for a Walk-in.
- `artifacts/admin/src/pages/attendance.tsx` — same new mandatory selector as the scan dialog.

Server contract: `CheckInBodyExtended.settlementMode` (`lib/api-zod/src/qr-attendance.ts`) — `"package_credit" | "pay_at_studio" | "not_paid"`.

## 2. No default choice

- `scan-check-in-dialog.tsx` and `attendance.tsx`: `walkInSettlement` state initializes to `null`, reset to `null` on every dialog/search reset — never pre-selected.
- `unified-attendance-dialog.tsx`: `pickCandidate()` now sets `paymentMode` to `null` for a Walk-in (previously auto-selected `"package_credit"` when `candidate.hasPackageCredit` was true — this was the core bug, now removed).
- Server: `CheckInBodyExtended`'s `superRefine` rejects any no-booking, non-`absent` request that omits `settlementMode` with a 400 before any write. Confirmed by `"omitting settlementMode entirely on a walk-in returns a validation error, zero writes"` (both `attendance.studioWalkInCapture.integration.test.ts` and `.zeroWriter.integration.test.ts`).

## 3. Pay at Studio with valid credits leaves credits unchanged

Confirmed by the critical regression test `"valid Package Credit + explicit Pay at Studio leaves credits untouched and creates the canonical payment"` (`attendance.studioWalkInCapture.integration.test.ts`): starting with 8 available credits, an explicit `pay_at_studio` walk-in leaves `remaining_credits = 8`, package `status = "active"`, and `credit_transactions` count = 0 for that package, while creating exactly one `payment_records` row (status `paid`, exact captured amount) and one `payment_events` row.

`performStudioWalkIn()` (`checkInService.ts`) never queries `package_orders` at all — there is no code path by which it could touch credits.

**Package availability must never trigger automatic credit deduction for a Studio Walk-in.**

## 4. Package Credit requires explicit selection

`attendance.ts`'s Walk-in transaction only enters the credit-deduction branch when `settlementMode === "package_credit"` exactly — confirmed by `"valid Package Credit + explicit Package Credit deducts exactly one credit and creates zero payment rows"` and `"no valid credit + explicit Package Credit returns a business error and writes zero rows"`.

## 5. Not Paid performs zero writes

- `settlementMode === "not_paid"` throws before Step 1 (the duplicate-attendance check) even runs — nothing is written. Confirmed by `"Not Paid aborts the whole operation..."` and `"Not Paid adds zero rows"`.
- Both `scan-check-in-dialog.tsx` and `attendance.tsx` additionally short-circuit `not_paid` entirely client-side — no HTTP request is sent at all when Not Paid is chosen.

## 6. Atomicity and idempotency

- Both `package_credit` and `pay_at_studio` writes remain inside the existing single `db.transaction()` — unchanged transactional shape, only the branch selector changed.
- Existing row locking (`.for("update")` on `package_orders`, and the transaction-scoped advisory lock keyed on student+class/schedule+day) is untouched.
- Retry/duplicate protection: the pre-existing same-day advisory-lock + duplicate-attendance check applies identically regardless of `settlementMode` — confirmed by the new retry test (`a retry of an explicit Pay at Studio walk-in ... does not duplicate`, expects `409` on the second identical request) and the existing Part D concurrent-credit-deduction test (18/18 gateway suite, unaffected).
- Concurrency-sensitive suites (`attendance.studioWalkInCapture.integration`, `.zeroWriter`, `adminAttendanceGateway.studioWalkIn`) were re-run 5 consecutive times: 180/180 pass, 0 flake.

## 7. Finance exact-payment display

Unaffected by this hotfix — `performStudioWalkIn()`'s payment-record creation (exact price, `status: "paid"`, `flowType: "studio_walkin"`) and `financeReadModel.ts`'s `recorded_collection` reliability mapping are untouched. The critical regression test also asserts the exact `final_payable_amount_minor` on the Pay-at-Studio-with-valid-credit payment record.

## 8. Test and typecheck results

| Check | Result |
|---|---|
| `pnpm run typecheck:libs` | Clean |
| `pnpm --filter @workspace/api-server run typecheck` | 125 errors — all pre-existing baseline Ballet/`pg`-module noise, confirmed identical count before and after this change; **zero errors in any changed file** |
| `pnpm --filter @workspace/api-server run build` | Clean |
| `pnpm --filter @workspace/admin run typecheck` | 0 errors |
| `node artifacts/central/scripts/checkNoNativeAlert.js` | Pass (134 files) |
| `attendance.studioWalkInCapture.integration.test.ts` | 15/15 pass |
| `attendance.studioWalkInCapture.zeroWriter.integration.test.ts` | 4/4 pass |
| `adminAttendanceGateway.studioWalkIn.integration.test.ts` | 18/18 pass (unaffected, re-run for regression confirmation) |
| `unifiedAttendanceDialog.test.ts` | 7/7 pass (2 new, source-level assertions on the no-default-selection fix) |
| **Total** | **44/44 pass, 0 fail, 0 skipped** |

No unrelated Ballet files changed (`git diff --name-only` — 10 files, all Attendance/Walk-in/schema-contract related).

## 9. Production deployment plan

1. Re-fetch `origin/main`; confirm no conflicting upstream changes since the release baseline.
2. Create a fresh release worktree from the latest `origin/main`.
3. Merge `hotfix/studio-walkin-explicit-payment-choice` with `--no-ff`.
4. Re-run the full affected test/typecheck/build matrix above on the merged state.
5. Push via the normal process; Railway API/Worker and Vercel Admin auto-deploy on push to `main` (no new migration required — this hotfix is code-only, no schema change).
6. Monitor Railway API/Worker health and Vercel Admin deployment status.
7. Production smoke test: a designated test participant with valid package credits, settled via Pay at Studio — proving attendance recorded, payment recorded with the exact amount, and the package credit balance unchanged with zero new credit ledger entries.

## 10. Rollback plan

If the hotfix fails in production: revert the hotfix merge commit on `main`, allow Railway/Vercel to auto-redeploy the prior code from the resulting `origin/main` state. No automatic data repair — any test records created during verification are reported, not deleted. No real customer data is touched by rollback (this hotfix makes no schema or data change, only application logic and validation).
