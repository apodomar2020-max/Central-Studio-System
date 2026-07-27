# Finance Final Closure Batch 1 — Release Readiness

**No merge, deploy, or migration was performed in the preparation of this document.** This is a handoff summary, not a duplicate of `FINANCE_FINAL_CLOSURE_BATCH_1_REPORT.md` — see that report and `FINANCE_FINAL_CLOSURE_BATCH_1_REVIEW_RESPONSE.md` for full implementation and review detail.

## 1. Final Reviewed Branch and Head

- Branch: `feat/finance-final-closure-batch-1`
- Final reviewed head: `35b3f7cd4b3a18c7f2e71a32ecf873dd8b688ae3` (`35b3f7c`)
- Documentation-cleanup commit (this task): `11acb84`
- Baseline: `d5ab3bd017392459a2e5cbb0dfd58af7e7ea0e4f` (confirmed unchanged from `origin/main` throughout this work)
- Independent review verdict on `35b3f7c`: `PASS WITH DOCUMENTATION CLEANUP` (documentation cleanup now resolved in `11acb84`)

## 2. Runtime Verification Summary

- **242 tests executed, 242 passed, 0 failed, 0 skipped**, across every Finance/booking/attendance/credit test file touched or added by this batch, plus full regression coverage of adjacent untouched suites.
- **Central production typecheck: 0 errors** (deterministic, reproduced 3× after fresh installs).
- **Admin typecheck: 0 errors.**
- **API build: clean.** (The API's own `tsc` invocation was found to exhibit pre-existing, baseline-reproduced non-determinism in this repository's incremental build caching — reproduced identically on the unmodified baseline commit — unrelated to this batch; it does not affect build/deploy correctness.)
- `node artifacts/central/scripts/checkNoNativeAlert.js`: clean (134 files scanned).
- Concurrency-sensitive tests (duplicate-booking race, payment-confirmation race) repeated 5× with no intermittent failures.
- Stable participant-ID fix (Blocker 1) and PostgreSQL 23505 → `duplicate_booking` mapping (Blocker 2): both independently verified, PASS.

## 3. Migration 0085 Preflight Requirements

`lib/db/migrations/0085_bookings_occurrence_participant_unique.sql` — a partial unique index on `bookings`, additive only (no column changes, no backfill, no data mutation):

```sql
CREATE UNIQUE INDEX "bookings_active_occurrence_participant_unique" ON "bookings" (
  "schedule_id", "occurrence_date", "account_owner_student_id", coalesce("participant_child_id", 0)
) WHERE (
  "occurrence_date" is not null
  and "account_owner_student_id" is not null
  and "booking_status" in ('pending', 'confirmed')
);
```

Before applying to any real database (staging or production):
1. Run the duplicate-diagnostic query below against that database first. If it returns any rows, **stop and investigate** — `CREATE UNIQUE INDEX` will fail outright rather than silently corrupt data, but a pre-existing violation means real active double-bookings exist and need product/ops attention before the index can be added.
   ```sql
   select schedule_id, occurrence_date, account_owner_student_id, coalesce(participant_child_id, 0) as pcid, count(*)
   from bookings
   where occurrence_date is not null and account_owner_student_id is not null and booking_status in ('pending','confirmed')
   group by 1,2,3,4 having count(*) > 1;
   ```
2. Confirmed clean (zero violating rows) against `central_studio_disposable_studio_walkin`, a disposable database carrying substantial prior test data, and applied cleanly to a fresh disposable database (`central_studio_disposable_occurrence_unique`) with the resulting index definition verified byte-for-byte against the Drizzle schema declaration.
3. **Migration 0085 has not been applied to staging or production.** Apply it using the existing approved migration process (`pnpm --filter @workspace/db run migrate` against the target `DATABASE_URL`, per this repo's own documented convention) — not ad hoc.
4. The migration was hand-authored (paired with a hand-written `_journal.json` entry) rather than produced via `drizzle-kit generate`, due to a pre-existing interactive-TTY-prompt limitation with `generate` in this environment. This does not affect the runtime migration path (`drizzle-orm/node-postgres/migrator`'s `migrate()` reads only the journal + SQL files, not snapshot files), but a future `drizzle-kit generate` run should be checked for a spurious diff against the hand-written schema-snapshot state before being trusted blindly.

## 4. Suggested Controlled Release Sequence

1. **Fetch latest `origin/main`**: `git fetch origin` and confirm `origin/main` is still at (or a fast-forward descendant of) `d5ab3bd017392459a2e5cbb0dfd58af7e7ea0e4f`.
2. **Verify no new conflicting Finance/booking/attendance changes**: diff `origin/main` against this batch's baseline to confirm nothing has landed upstream in `artifacts/api-server/src/routes/bookings.ts`, `myRoutes.ts`, `students.ts`, `artifacts/api-server/src/lib/financeSources.ts`/`financeReadModel.ts`, `artifacts/central/contexts/AppContext.tsx`, `artifacts/central/app/booking/flow.tsx`, or `lib/db/src/schema/bookings.ts` since this branch was created — if anything has, re-review the merge diff for this batch specifically around those files before proceeding.
3. **Create a clean release worktree** off the current `origin/main`, separate from `/private/tmp/finance-final-closure-batch-1` (which should remain untouched until the merge is confirmed).
4. **Merge the feature branch** (`feat/finance-final-closure-batch-1` at `35b3f7c`/`11acb84`) into `main` in that release worktree, per the team's normal PR/merge process — not performed as part of this task.
5. **Run full release verification** in the release worktree: the same 242-test suite, `pnpm run typecheck` (Central/Admin/API), and `checkNoNativeAlert.js`, against the merged state — not merely re-trusting this branch's own pre-merge results.
6. **Apply Migration 0085** using the existing approved migration process, after the preflight diagnostic query in §3 confirms a clean target database.
7. **Deploy `api-server` and `admin`** together, per the existing deployment process for this repository — these two are interdependent within this batch (the Finance read-model, credit-aggregation, and booking-confirmation fixes span both).
8. **Release the Central mobile changes using the existing approved mobile release process** (app-store submission / OTA update channel, whichever this team already uses) — mobile does not redeploy the instant `main` changes, so this is a separate, later step from the API/Admin deploy, not simultaneous with it.

## 5. Required Production Smoke Tests

After API/Admin deploy and before/alongside the mobile release:
- Create a package order, activate it with Cash, confirm Finance Packages shows a real Status/Method/Amount (not blank, not "Service Credit Unit" mislabeled as payment status).
- Confirm a parent with two active packages (e.g. 3 + 4 credits) sees **7** on the Admin Parent profile, Mobile Profile, and Credit History screens consistently.
- Scan/search a parent with exactly one real booking via the Admin Attendance Gateway — confirm only that participant is labeled "Booked for this class," and any other family member offered is clearly labeled "Available as Walk-in," not the same green label.
- Confirm a Pay-at-Studio booking: after Admin confirms payment, the booking simultaneously shows Paid and Confirmed (no lingering Confirm/Reject buttons).
- Attempt to double-book the same participant for the same class occurrence from the mobile app — confirm the already-booked participant is shown disabled with "Already booked," not merely rejected after submission.
- (Post-migration only) Fire two genuinely concurrent booking requests for the same participant/occurrence against the deployed API — confirm exactly one succeeds (201) and the other returns 409 `duplicate_booking`, never a 500.

## 6. Required Tuesday/Thursday Mobile UAT

**Open UAT item — Tuesday/Thursday paid-state bleed was not reproduced automatically and must be verified on the deployed mobile flow before final feature closure.**

Concretely: on the deployed mobile app (real device or simulator), book and pay for one occurrence of a twice-weekly recurring class (e.g. Tuesday), let that occurrence pass, and confirm the next occurrence (e.g. Thursday) independently shows its own correct pending/unpaid state on every relevant screen (class card, bookings list, package-credit availability) — not "Paid" carried over from Tuesday. This was traced at the source-code and server-API level in this batch (found correct, not reproducible automatically) but has not been observed on a running mobile app, which is the only way to fully close this item.

## 7. Rollback Plan

- **Application code**: prefer reverting the single merge commit that brings this branch into `main`, rather than reverting the six individual commits (`c965188` / `82d3cb4` / `8eaa560` / `63a0e04` / `5633d29` / `35b3f7c`) one at a time. Every change in this batch is additive/corrective with no destructive data operations, so either approach is safe; the merge-commit revert is simpler.
- **Migration 0085**: `DROP INDEX "bookings_active_occurrence_participant_unique";` — safe, reversible, no data loss (the index carries no data of its own).
- **No historical data was migrated, backfilled, or otherwise mutated** by this batch, so there is nothing to roll back at the data layer beyond the index itself.
- **Mobile release**: if an issue is found only after the Central mobile release goes out (e.g., during Tuesday/Thursday UAT), roll back via the existing approved mobile release process's own rollback mechanism (e.g., OTA revert or store rollback), independently of the API/Admin rollback above.

## 8. Explicit Statement

**No merge, deploy, or migration application was performed in this task or any prior task in this sequence.** This document, the implementation report, and the review-response record are documentation deliverables only. The branch `feat/finance-final-closure-batch-1` at `11acb84` remains unmerged into `main`, migration 0085 remains unapplied to any staging or production database, and no API/Admin/mobile deploy has occurred.
