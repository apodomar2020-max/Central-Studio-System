# Finance Final Closure — Batch 1 Implementation Report

## 1. Executive Summary

Batch 1 implements Parts A–G of the Finance Final Closure plan: canonical `payment_records` integration into the Finance read model, a credit-aggregation bug fix plus mobile refresh wiring, an Attendance Gateway UI fix distinguishing booked participants from Walk-in offers, re-verification of the walk-in credit-deduction core, an atomic payment→booking-confirmation fix, duplicate-booking UI/DB protection, and a reproduction attempt for the reported Tuesday/Thursday occurrence bleed (not reproducible in the current codebase).

All changes are scoped to Finance/booking/attendance/credit code paths. No Ballet-only files were touched. One migration was added (a partial unique index, additive and non-destructive). 233 tests executed across 13 test files/runs, all passing, with stability re-runs on every concurrency-sensitive test. `admin` and `api-server` typecheck cleanly; `central` typecheck has only pre-existing, unrelated `node:test`/`node:assert` type-declaration errors on Ballet test files (present at baseline, confirmed unaffected by this work).

## 2. Baseline and Worktree

- `origin/main`: `d5ab3bd017392459a2e5cbb0dfd58af7e7ea0e4f` (fetched fresh at task start — unchanged from prior sessions).
- Local `main` was dirty with unrelated Ballet work (4 commits ahead), so one clean isolated worktree was created off `origin/main`:
  - Worktree: `/private/tmp/finance-final-closure-batch-1`
  - Branch: `feat/finance-final-closure-batch-1`
- Commit: `c965188` (single commit, all Batch 1 work).
- No merge, no deploy, no production data touched.

## 3. Files Changed

**Modified (19):**
- `artifacts/admin/src/components/unified-attendance-dialog.tsx` — Part C
- `artifacts/admin/src/components/unifiedAttendanceDialog.test.ts` — Part C tests (+1 pre-existing broken assertion repaired)
- `artifacts/api-server/src/lib/financeReadModel.ts` — Part A
- `artifacts/api-server/src/lib/financeReadModel.test.ts` — Part A tests
- `artifacts/api-server/src/lib/financeSources.ts` — Part A
- `artifacts/api-server/src/routes/adminAttendanceGateway.studioWalkIn.integration.test.ts` — Part D tests
- `artifacts/api-server/src/routes/bookings.financeConfirmation.integration.test.ts` — Part E (1 test corrected, see §12)
- `artifacts/api-server/src/routes/bookings.paymentConfirmation.integration.test.ts` — Part E tests
- `artifacts/api-server/src/routes/bookings.ts` — Part E
- `artifacts/api-server/src/routes/students.ts` — Part B
- `artifacts/central/app/(tabs)/profile.tsx` — Part B
- `artifacts/central/app/_layout.tsx` — Part B (TanStack Query `focusManager`)
- `artifacts/central/app/booking/flow.tsx` — Part F1
- `artifacts/central/app/credit-history.tsx` — Part B
- `artifacts/central/app/package-center.tsx` — Part B
- `artifacts/central/contexts/AppContext.tsx` — Part B (AppState listener)
- `lib/api-zod/src/finance.ts` — Part A (new amount source + `cash`/`card` methods)
- `lib/db/migrations/meta/_journal.json` — Part F2 (new migration entry)
- `lib/db/src/schema/bookings.ts` — Part F2 (partial unique index)

**New (5):**
- `artifacts/api-server/src/routes/bookings.occurrenceUniqueness.integration.test.ts` — Part F2/F3 tests
- `artifacts/api-server/src/routes/myBookings.occurrenceIndependence.integration.test.ts` — Part G reproduction test
- `artifacts/api-server/src/routes/students.creditAggregation.integration.test.ts` — Part B tests
- `artifacts/central/app/booking/flow.duplicateBooking.test.ts` — Part F1 tests
- `lib/db/migrations/0085_bookings_occurrence_participant_unique.sql` — Part F2 migration

## 4. Migration Created

`0085_bookings_occurrence_participant_unique.sql` — a partial unique index:

```sql
CREATE UNIQUE INDEX "bookings_active_occurrence_participant_unique" ON "bookings" (
  "schedule_id", "occurrence_date", "account_owner_student_id", coalesce("participant_child_id", 0)
) WHERE (
  "occurrence_date" is not null
  and "account_owner_student_id" is not null
  and "booking_status" in ('pending', 'confirmed')
);
```

- Additive only — no column changes, no data migration, no backfill.
- Scoped by `WHERE` to exclude every legacy row (`occurrence_date IS NULL` or `account_owner_student_id IS NULL`) and every terminal-status row — those are entirely untouched.
- `coalesce(participant_child_id, 0)` makes two "self" bookings (both `NULL`) collide as intended, since Postgres treats `NULL <> NULL` by default in unique indexes; this is the smallest robust alternative to `NULLS NOT DISTINCT` (PG15+, not guaranteed available, and not yet exposed by the installed drizzle-orm version on partial indexes).
- Diagnostics: ran a duplicate-check query against `central_studio_disposable_studio_walkin` (a DB with real prior test data) before applying anywhere — zero existing violations. Applied cleanly to a fresh disposable DB (`central_studio_disposable_occurrence_unique`) and verified via `\d bookings` that the index matches the schema declaration exactly.
- **Not applied to production** in this task, per instructions. Ready for review before any deploy.
- **Known limitation**: hand-authored (paired with a hand-written `_journal.json` entry) rather than produced via `drizzle-kit generate`, because `generate` requires an interactive TTY prompt in this environment (a pre-existing tooling limitation, reproduced and confirmed unrelated to this schema change) and no CI/non-interactive invocation path was found in the repo. The runtime migration path (`drizzle-orm/node-postgres/migrator`'s `migrate()`, used by `pnpm --filter @workspace/db run migrate`) reads only the journal + SQL files, not the snapshot files, so this does not affect deploy correctness — but a future `drizzle-kit generate` run should be checked for a spurious diff against the hand-written snapshot state before trusting it blindly.

## 5. Finance Read-Model Changes (Part A)

**Root cause (per the corrective investigation from the prior session, re-confirmed unchanged in this session's clean checkout):** canonical `payment_records` writers exist and run correctly for all three flows (package purchase, single-class booking, Studio walk-in), but `financeSources.ts` never joined that table — `packagePurchases` and `bookingFamily()` read only `package_orders`/`bookings` + live catalog/schedule pricing.

**Fix:**
- `financeSources.ts`: added a `LEFT JOIN payment_records` (filtered by `flow_type`) to both the `packagePurchases` descriptor and `bookingFamily()`'s shared `baseQuery()`, selecting `status`, `confirmed_payment_method`, `gross/discount/final_payable/paid/refunded_amount_minor`, `paid_at`.
- `financeReadModel.ts`: split `mapPackagePurchase`/`mapBookingPayment` into a canonical branch (used when a `payment_records` row exists) and an unchanged legacy-estimate branch (used when it does not). The canonical branch reports `amountAvailability: "exact"`, `amountSource: "payment_record_snapshot"` (new enum value), `reliability.badge: "recorded_collection"` once paid, and the exact minor-unit amount — immune to later catalog/schedule price changes.
- Added `normalizePaymentRecordMethod` (payment_records' own `cash|card|kashier|bank_transfer|unknown` vocabulary, distinct from the booking/Ballet raw-string vocabulary `normalizePaymentMethod` already handled) and added `"cash"`/`"card"` to `FINANCE_PAYMENT_METHODS`/`FINANCE_PAYMENT_METHOD_LABELS` in `lib/api-zod/src/finance.ts`.
- Legacy fallback preserved verbatim for rows with no `payment_records` row (pre-Phase-2B/2C data) — no old test data was touched or repaired.

## 6. Package Payment Display Behavior

For a package purchase with a canonical `payment_records` row: Status now reads the real payment lifecycle (`pending`/`paid`/`refunded`/etc., never blank), Payment Method reads the confirmed method (e.g. "Cash"), Amount is the exact captured `finalPayableAmountMinor`, and Reliability reads `recorded_collection` once paid — with an explicit explanation clarifying that credit issuance is a separate operational fact. A legacy order with no `payment_records` row is unchanged: `paymentStatus: null`, `estimated_operational`, current-catalog-price estimate.

## 7. Class & Walk-in Display Behavior

Same pattern: a single-class booking or Studio walk-in with a canonical `payment_records` row now displays the exact captured amount and `recorded_collection` reliability, with no estimate-warning text, and is immune to later schedule-price changes (tested explicitly — see §15). A legacy booking with no `payment_records` row keeps the existing schedule-price/estimate fallback and warning text unchanged.

## 8. Credit Aggregation Fix

`students.ts`'s `buildStudentOverviewData` used `.limit(1)` ordered by `expiresAt`, returning only one active package's `remainingCredits`. Fixed to fetch **all** qualifying active packages (`status = 'active' AND remainingCredits > 0` AND owner match, unchanged filter otherwise) and sum them into `availableCredits`/`remainingCredits`; `activePackages` now exposes the full contributing-package breakdown; `activePackage` (singular) is retained unchanged for its narrower existing display purpose (soonest-expiring package name/expiry). Verified end-to-end via a real HTTP integration test: 3 + 4 = 7, one deduction → 6, expired/cancelled/fullyUsed packages correctly excluded, zero active packages → 0 (not a stale non-zero value).

## 9. Mobile Refresh/Invalidation Fix

Three complementary mechanisms, matching the existing architecture (no new state-management system introduced):
1. **`AppContext.tsx`** — an `AppState` "change" listener refetches `userPackages`/`bookings` (the app's custom-state array) on transition to `active`, once per transition (no polling).
2. **`_layout.tsx`** — wired TanStack Query's `focusManager` to the same `AppState` signal, which is the standard React Native integration recipe; this makes `refetchOnWindowFocus` (already the query-client default, previously inert on RN since there's no browser focus event) actually fire on app foreground for **every** `useQuery`-backed screen app-wide, not just the ones touched here.
3. **`profile.tsx` / `credit-history.tsx` / `package-center.tsx`** — added `useFocusEffect`-triggered refetches, covering in-session tab navigation (not just app-foreground), matching the existing pattern already used elsewhere in the app (e.g. `profile.tsx`'s attendance fetch, `ballet/classes.tsx`).

## 10. Attendance Eligibility UI and Backend Safety

Root cause (Part C): `unified-attendance-dialog.tsx`'s `eligibilityLabel()` rendered the identical green "Eligible now" for a real booking-based candidate and a Studio Walk-in offer (any family member, for any concurrently-open class) — the exact cause of "every family member appears booked." Fix: `isBookedCandidate()` distinguishes `bookingId != null` (or Ballet, which is always booking-based) candidates, labeled "Booked for this class"; walk-in offers are labeled "Available as Walk-in" and are hidden entirely whenever the account has at least one real booked candidate for the search (Case 1/2 of the required decision tree) — only surfaced at all when zero booked candidates exist (Case 3). Not-eligible candidates (Case 4) no longer leak the raw internal enum string as a fallback label.

Backend safety was already sound and required no change: `candidateKey` binding is re-derived server-side and rejected on mismatch, `childId` is re-validated against `childrenTable.parentId`, and a walk-in confirmation always creates its own synthetic booking rather than marking an unrelated existing booking as attended.

## 11. Walk-in Credit Re-verification

Re-ran the full existing walk-in test suite (17 pre-existing tests, unaffected — Part C is UI-only and never touches `checkInService.ts`/`adminAttendanceGateway.ts`) plus 2 new tests proving, over real HTTP against a real Postgres row lock: exactly one credit deducted, exactly one `credit_transactions` ledger row, exactly one `attendance` row, zero `payment_records` rows, the response carries the post-deduction balance, and a retried/duplicate scan does not deduct twice. Added a true-concurrency test (`Promise.all`, two simultaneous requests) proving exactly one deduction under a real race — re-run 3× for stability, no intermittent duplicates. No defect was found in the transactional core; no code change was made to it.

## 12. Payment-to-Booking State Linkage

Root cause (Part E, confirmed exactly as scoped): the Admin "Confirm Payment" action sends only `{paymentStatus, confirmedPaymentMethod}`; `bookingStatus` silently inherited its prior value ("pending") since nothing forced it forward, leaving Confirm/Reject visible in the Admin UI after payment was already collected.

Fix: inside the existing payment-confirmation guard block in `bookings.ts` (after every existing safety check — source status, terminal-status exclusions, package-credit/free exclusions — has already passed), `normalized.bookingStatus` is forced from `"pending"` to `"confirmed"` in the same `tx.update()` call that also writes `paymentStatus`, so both land in one atomic write. The redundant `bookingStatus`-changed notification is suppressed specifically for this auto-transition (a `bookingStatusAutoConfirmedByPayment` flag) so one confirmation sends one push, not two.

**One pre-existing test encoded the old (buggy) policy** and was corrected: `bookings.financeConfirmation.integration.test.ts`'s "B8" asserted `bookingStatus` must remain unchanged after a Finance write — this was the bug itself, encoded as an expectation. Updated to assert the corrected policy (`bookingStatus` becomes `"confirmed"`), with the change documented inline in the test. No other existing test asserted the old policy.

Verified: 23/23 tests pass in `bookings.financeConfirmation.integration.test.ts` (including B10, which needed no test-logic change once the notification-suppression fix landed) and 15/15 in `bookings.paymentConfirmation.integration.test.ts` (3 new tests: atomic pending→confirmed transition, idempotent no-op when already confirmed, and atomic rollback of both payment and booking status together on a rejected transition). No Admin frontend change was needed — `bookings.tsx`'s `canShowBookingActions`/`canShowPaymentActions` already derive from the real `bookingStatus`/`paymentStatus` fields, so the buttons now correctly disappear once the backend fix lands.

## 13. Duplicate-Booking Protection

**F1 (mobile UI):** `booking/flow.tsx` now computes `occurrenceBookings` (bookings matching the exact `scheduleId` + `occurrenceDate`/`date` + `bookingStatus IN (pending, confirmed)` — mirroring the backend's `DUPLICATE_BLOCKING_STATUSES` exactly) and disables the Self card / the specific child row when already booked, showing "Already booked" and refusing the tap — other unbooked family members remain fully selectable.

**F2 (DB constraint):** see §4. Diagnosed clean against existing data before creation; applies only to future/new occurrence-specific bookings.

**F3 (concurrency):** verified with a true `Promise.all` double-POST against the real route: exactly one booking, one `payment_records` row, one `payment_events` row survive — the DB index, not merely the application-level check, is what guarantees this under a genuine race (re-run 3× for stability).

**F4/F5:** verified a cancelled booking does not block a valid re-booking of the same occurrence (index is status-scoped), and that pre-existing legacy null-occurrence rows never block or collide with a new occurrence-specific booking (index is `occurrence_date IS NOT NULL`-scoped).

## 14. Tuesday/Thursday Reproduction and Result

**Open UAT item — Tuesday/Thursday paid-state bleed was not reproduced automatically and must be verified on the deployed mobile flow before final feature closure.**

Reproduction attempted: one class with two schedules (Tuesday `day_of_week=2`, Thursday `day_of_week=4`), one participant, an independent booking created for each occurrence, Tuesday's booking confirmed paid. `GET /api/my/bookings` — the mobile app's single source of truth — returned Thursday's booking with its own independent `pending_payment` status, unaffected by Tuesday's confirmation (see `myBookings.occurrenceIndependence.integration.test.ts`, passing).

**Independent review correctly identified a scope limitation in this test**: it exercises the server-side data/API layer (`GET /api/my/bookings` returning independent per-occurrence rows) directly via HTTP, not the actual recurring-class mobile UI path — it does not render `app/(tabs)/bookings.tsx` or `app/(tabs)/classes.tsx`, drive `AppContext`'s state, or exercise whatever component/hook actually decides which card shows "Paid" on a real device. Source-level tracing of those two files (cited below) shows logic that *should* behave correctly, but tracing static source is not equivalent to observing the rendered mobile app, and this batch has no React Native rendering harness available to close that gap automatically.

Traced surfaces (source-level only, not run): `app/(tabs)/bookings.tsx` (flat per-booking list — inherently occurrence-scoped, since each occurrence is its own row) and `app/(tabs)/classes.tsx`'s `activeBooking` matcher (keys explicitly on `b.scheduleId === item.scheduleId && b.occurrenceDate === item.date`, already occurrence-scoped — a stale code comment calling this a TODO understates what the code already correctly does).

Recorded per the requested format: `classId`/`scheduleId` — two distinct schedule rows under one class; participant identity — one student email; `bookingId` — two distinct booking rows; Tuesday `occurrenceDate` = `2026-07-28`; Thursday `occurrenceDate` = `2026-07-30`; the object resolving the Paid badge — `bookings.tsx`'s per-row `b.paymentStatus` and `classes.tsx`'s `activeBooking` lookup, both independently correct **at the source level**, unverified on a running mobile app.

**No runtime behavior was changed for this part**, and this task did not attempt to broaden scope to add a real mobile-UI reproduction harness (none exists in the repo today, and building one was out of scope for this fix-only task). If the symptom persists in production, the residual DB-level concurrency gap closed by Part F2 (no unique constraint existed before Batch 1) and legacy null-occurrence rows remain candidate explanations not fully ruled out — but the authoritative next step is the UAT verification below, not further automated reproduction.

**This must remain an open item and must be verified on the deployed mobile app (real device or simulator, real recurring class, real payment confirmation) before this issue is closed** — see `FINANCE_FINAL_CLOSURE_BATCH_1_REVIEW_RESPONSE.md` for the tracked open item.

## 15. Tests Executed and Exact Counts

| Test file | Count | Result |
|---|---|---|
| `financeReadModel.test.ts` (Part A, +11 new) | 37 | 37 pass |
| `financeFilters.test.ts` + `financeExport.test.ts` + `financeUi.test.ts` (regression) | 88 | 88 pass |
| `unifiedAttendanceDialog.test.ts` (Part C, +3 new, 1 pre-existing repaired) | 5 | 5 pass |
| `tests/booking/flow.duplicateBooking.test.ts` (Part F1 + Blocker 1, relocated + expanded) | 13 | 13 pass |
| `students.creditAggregation.integration.test.ts` (Part B, new) | 5 | 5 pass |
| `adminAttendanceGateway.studioWalkIn.integration.test.ts` (Part D, +2 new) | 18 | 18 pass |
| `bookings.paymentConfirmation.integration.test.ts` (Part E, +3 new) | 15 | 15 pass |
| `bookings.financeConfirmation.integration.test.ts` (Part E, 1 corrected) | 23 | 23 pass |
| `bookings.notificationPostCommit.integration.test.ts` (regression) | 3 | 3 pass |
| `bookings.creationCapture.integration.test.ts` (regression) | 12 | 12 pass |
| `bookings.creationCapture.atomicity.integration.test.ts` (regression) | 3 | 3 pass |
| `bookings.creationCapture.zeroWriter.integration.test.ts` (regression) | 3 | 3 pass |
| `bookings.delete.integration.test.ts` (regression) | 7 | 7 pass |
| `bookings.occurrenceUniqueness.integration.test.ts` (Part F2/F3 + Blocker 2, expanded) | 6 | 6 pass |
| `myBookings.occurrenceIndependence.integration.test.ts` (Part G, new) | 1 | 1 pass |
| `packageOrders.activation.integration.test.ts` (regression) | 10 | 10 pass |
| **Total** | **242** | **242 pass, 0 fail** |

New tests added across both rounds: 11 (Part A) + 3 (Part C) + 13 (Part F1 + Blocker 1) + 5 (Part B) + 2 (Part D) + 3 (Part E, `bookings.paymentConfirmation`) + 6 (Part F2/F3 + Blocker 2) + 1 (Part G) = **44 new tests**; 1 pre-existing test corrected to match the fixed policy (Part E's B8) and 1 pre-existing broken regex test repaired (unrelated pre-existing bug, `unifiedAttendanceDialog.test.ts`, found while adding Part C tests to the same file).

## 16. Stability Results

Repeated 3× each (round 1), no intermittent failures:
- `adminAttendanceGateway.studioWalkIn.integration.test.ts` "Part D" concurrency test (package-credit deduction race).
- `bookings.occurrenceUniqueness.integration.test.ts` "Part F3" concurrency test (DB-constraint race).
- `bookings.financeConfirmation.integration.test.ts` full file (payment/booking atomic-confirmation, including its own pre-existing B13 concurrency test).

Repeated 5× (round 2, per independent-review requirement), no intermittent failures:
- `bookings.occurrenceUniqueness.integration.test.ts` "Part F3 / Blocker 2" concurrency test — 5/5 pass, exactly one 201 + one 409/duplicate_booking every run, never a 500.

One test-authoring bug was found and fixed during this process (not a product bug): a first draft of the Part F3 concurrency assertion sorted HTTP status codes with default (lexicographic) `.sort()`, inverting the expected index — corrected to a numeric comparator; the actual product behavior (one 201, one 409, exactly one credit/booking) was correct on the very first run once instrumented with debug output.

## 17. Typecheck/Build Results

- `pnpm run typecheck` (root, which builds `lib/db`/`lib/api-zod` via `tsc --build` first, then typechecks every workspace): **`admin` and `api-server` clean, zero errors.**
- `central` typecheck reports errors, but exclusively `TS2307: Cannot find module 'node:assert/strict'`/`'node:test'`/`'node:fs'`/`'node:path'` on `.test.ts` files (a pre-existing, repo-wide `@types/node`/tsconfig `types` resolution gap affecting every Node-test-runner-based test file in `central`, confirmed present on a clean, unmodified baseline checkout before any of this batch's changes) plus two pre-existing unrelated errors in `tests/ballet/BalletMultipleSchedulesUi.test.ts` (a Ballet file, untouched by this batch). No new typecheck errors were introduced by this batch's source changes.
- `node artifacts/central/scripts/checkNoNativeAlert.js`: **✓ No direct native Alert usage found (scanned 134 files).**
- `mock.module is not a function`: encountered exactly as anticipated in three integration test files that use `node:test`'s experimental module-mocking API. Root cause confirmed: this repo's `tsx`-based invocation doesn't enable Node's `--experimental-test-module-mocks` flag. Resolved (not worked around) by invoking these specific files as `node --import <tsx-loader.mjs> --experimental-test-module-mocks --test <file>` — a real, repo-compatible invocation (uses the project's own installed `tsx` loader), not a fabricated pass. Every test in every affected file was confirmed to actually execute and pass under this invocation, not silently skipped.

## 18. Known Limitations

- Migration 0085 was hand-authored (paired with a hand-written journal entry) rather than produced via `drizzle-kit generate`, due to a pre-existing interactive-TTY-prompt limitation in this environment — see §4 for the runtime-correctness argument and the recommended follow-up check.
- Part G's Tuesday/Thursday symptom was not reproduced; if it resurfaces in production, it may require a live UAT capture with exact screenshots/network traces to pin down a surface not covered by this session's trace (e.g., a push-notification body, or an admin-side view not yet examined).
- Part C's fix hides Walk-in candidates whenever any real booking exists for the account for the current search — a deliberate, conservative reading of "do not present unrelated family members as booked"; if the product later wants Walk-in offers visible in a clearly separate section even alongside real bookings (the brief's Case 1/2 explicitly allows this as optional), that's a follow-up UI change, not a backend change.
- The mobile duplicate-detection in `flow.tsx` matches a child booking by `participantName === child.fullName` (name-based), since the mapped local `Booking` type has no `participantChildId` field today — precise but not identical to matching by numeric child id; adding that field to the mobile booking mapper would be a small, separate follow-up.

## 19. Deployment Plan

1. Review this branch (`feat/finance-final-closure-batch-1`, commit `c965188`) and this report.
2. Apply migration 0085 to a staging database first; re-run the duplicate-diagnostic query from §4 against staging data before promoting to production, per policy.
3. Deploy `api-server`, `admin`, and `central` together (the Finance read-model change, the credit-aggregation fix, the booking-confirmation fix, and the new DB index are interdependent within this batch; no partial-deploy ordering constraint was identified beyond "run the migration before or alongside the api-server deploy that assumes the index exists" — the app code does not currently query the index directly, so ordering is not strict, but running it first is the safer default).
4. No feature flag was used or is recommended — every change here is a bug fix to already-shipped Finance/booking/attendance/credit behavior, not new functionality behind a flag.

## 20. Rollback Plan

- Application code: revert the commits `c965188`/`82d3cb4`/`8eaa560` (or the merge commit once merged) — every change in this batch is additive/corrective with no destructive data operations, so a code revert alone is safe.
- Migration 0085: `DROP INDEX "bookings_active_occurrence_participant_unique";` — safe, reversible, no data loss, since the index carries no data of its own.
- No data was migrated or backfilled, so there is nothing to roll back at the data layer.

## Independent Review Blocker Fixes

An independent review of commit `82d3cb4` returned `CHANGES REQUIRED` with two confirmed merge blockers and one pre-deploy test-structure issue. All three are resolved as of commit `8eaa560`.

### 1. Stable participant-ID fix (Blocker 1)

Confirmed defect: `booking/flow.tsx`'s `childAlreadyBooked` matched on `participantName === child.fullName` — unsafe because names are editable and not unique across siblings. Fixed by:
- Adding `participantChildId?: number | null` to `AppContext.tsx`'s local `Booking` interface.
- Mapping it in the canonical (only) API→local mapper, `mapMyBookingToLocal`: `participantChildId: r.participantChildId ?? null`.
- **A gap not mentioned in the original bug report was found and fixed**: the server's `GET /api/my/bookings` route (`myRoutes.ts`) did not actually include `participantChildId` in its response object at all — only the raw DB row had it. Added it to the response, since the mobile fix is a no-op without it.
- Rewriting `childAlreadyBooked` to check `booking.participantChildId != null` first (`String(booking.participantChildId) === String(child.id)`), falling back to the normalized name comparison only when `participantChildId` is `null`.

### 2. Legacy fallback decision

**Retained, but isolated and documented as legacy-only.** Every current and new booking row now carries `participantChildId` (server-side, from the `bookings.participant_child_id` column, always populated at creation — see `bookings.ts`'s insert). The name-based fallback is unreachable for any row created going forward; it exists solely so a booking row created before this field was mapped into the API response doesn't silently stop being detected as a duplicate at all. It was not removed entirely because the task's own instructions treat this as "acceptable only... and must be clearly isolated/documented" rather than requiring outright removal, and removing it would regress detection for any such legacy row still present. The isolation is enforced structurally (an early-return inside the `participantChildId != null` branch) and proven by a dedicated test asserting the id-check is evaluated strictly before the name-check in the source.

### 3. Test relocation

`flow.duplicateBooking.test.ts` moved from `app/booking/` to `tests/booking/` (new directory), with its `readFileSync` import path updated to `../../app/booking/flow.tsx`. Expanded from 4 to 13 tests: the original 4 source-assertion tests (updated for the new stable-ID logic) plus 9 new tests — a dedicated "id check precedes name fallback" source assertion, a Booking-model/mapper assertion, and 7 behavioral tests (one per required scenario 1–7) run against a standalone re-implementation of the exact algorithm, kept honest by the source-level regex assertions in the same file.

### 4. PostgreSQL 23505 mapping (Blocker 2)

`bookings.ts`'s booking-creation `db.transaction(...)` call is now wrapped in `try/catch`. A new `isOccurrenceDuplicateViolation(error)` helper narrowly matches only the constraint this batch's migration added, mapping it to the existing `409 { error: "You already have an active booking for this class.", code: "duplicate_booking" }` response — identical to the app-level check's own response for the same business condition. Any other error is rethrown unchanged.

### 5. Constraint-name verification

Proved the exact runtime error shape against a disposable database (`central_studio_disposable_occurrence_unique`) before writing the detection helper, using a throwaway script that inserted a genuine duplicate row through the real `db.insert(bookingsTable)` call path:
```
err.constructor.name: DrizzleQueryError
err.code: undefined
err.cause.code: '23505'
err.cause.constraint: 'bookings_active_occurrence_participant_unique'
```
Confirms drizzle-orm (node-postgres driver) wraps the raw `pg` error in a `DrizzleQueryError`, exposing `code`/`constraint` only on `.cause` — exactly why the helper checks `error.code ?? error.cause?.code` and `error.constraint ?? error.cause?.constraint`, per the reviewer's own preferred shape. The throwaway proof script was deleted after use; it is not part of the committed diff.

### 6. Concurrency results

- Batch 1's original "Part F3" test updated to assert the loser is exactly `409`/`duplicate_booking` (previously only asserted "not 201"). Re-run 5× — 5/5 pass, no intermittent failures.
- New test proving a *different* participant can still book the identical occurrence concurrently (both succeed) — the index is scoped per `account_owner_student_id`, not per-occurrence alone.
- New test proving an unrelated `23505` (a `students.email` unique-constraint violation, same SQLSTATE, different constraint name) is confirmed structurally distinct from `bookings_active_occurrence_participant_unique` and would not be matched by the detection helper.
- All 6 tests in `bookings.occurrenceUniqueness.integration.test.ts` (4 original + 2 new) pass.

### 7. Typecheck comparison

Ran a side-by-side comparison: a fresh worktree of the unmodified baseline (`d5ab3bd`) typechecked via the correct root `pnpm run typecheck` (which builds `lib/db`/`lib/api-zod` first) produced errors in exactly these `central` files: `components/ballet/BalletAssessmentSuccessActions.test.ts`, `BalletChildManagementSafety.test.ts`, `BalletStudentPreviewCard.test.ts`, `balletAssessmentStateModel.test.ts`, `providers/centralAlertBridge.test.ts`, `centralAlertLogic.test.ts`, `services/backgroundMusic.test.ts`, `backgroundMusicRules.test.ts`, `balletClassScheduleModel.test.ts`, `balletMyClassesModel.test.ts`, `notificationNavigation.test.ts`, `tests/ballet/BalletMultipleSchedulesUi.test.ts` — 12 files, all pre-existing `node:test`/`node:assert`/`node:fs`/`node:path` module-resolution gaps (a repo-wide `@types/node`/tsconfig gap affecting every Node-test-runner file), none touched by this batch. After this fix commit, the exact same 12 files still error, **plus exactly one new file**: `tests/booking/flow.duplicateBooking.test.ts` — the relocated test file itself, which inherits the identical pre-existing error category (every test file in `central` has it) rather than a new kind of error. No `.tsx`/non-test source file gained a new error. `admin` and `api-server` remain fully clean (zero errors) on both the baseline and this fix commit.

### 8. Tuesday/Thursday open UAT status

Not claimed as closed. Reworded per instructions to the exact required wording — see §14 above and the review-response document.

## Central Typecheck Scope Fix

A second independent review of commit `63a0e04` found one remaining merge blocker: `artifacts/central/tests/booking/flow.duplicateBooking.test.ts` was still compiled as part of Central's production TypeScript project, introducing `node:test`/`node:assert`/`node:fs` module-resolution errors. Fixed in commit `5633d29`.

### Resolving the reviewer's stated arithmetic inconsistency

The second review claimed baseline Central typecheck = 0 errors, current branch = 37, only 3 attributed to the relocated test. This was investigated **before** making any change, per instructions:

1. **Exact baseline error count**: **34**, not 0. Verified by creating a clean worktree at `d5ab3bd`, running `pnpm install` fresh, then the exact command `pnpm --filter @workspace/central run typecheck` from repository root — but only after the required root-level prerequisite (`pnpm run typecheck:libs`, i.e. `tsc --build` for `lib/db`/`lib/api-zod`), since running the filtered command alone without building the referenced projects first produces a large, unrelated cascade of `TS6305`/implicit-`any` errors that are an artifact of stale/missing project-reference output, not real diagnostics. With the prerequisite run first, baseline Central consistently produces exactly 34 errors across 12 pre-existing `node:test`/`node:assert`/`node:fs`/`node:path` module-resolution gaps (Ballet test files, `providers/`, `services/` — none touched by Batch 1), confirmed identically via both `pnpm --filter @workspace/central run typecheck` (after the prerequisite) and the root `pnpm run typecheck` orchestrator, and reproduced 3 times.
2. **Exact pre-fix branch error count**: **37** — the same 12 baseline files plus exactly 1 new file, `tests/booking/flow.duplicateBooking.test.ts` (3 errors: `node:assert/strict`, `node:fs`, `node:test`), confirmed via `comm` diffing the sorted file lists between the two runs.
3. **Exact new-error delta before this fix**: **+3** (one new file, the relocated test, inheriting the same pre-existing error category every other test file in `central` already has — not a new kind of error).
4. **Conclusion**: the reviewer's arithmetic was internally consistent (`34 + 3 = 37`) once the correct baseline (34, not 0) is used. The "0" baseline figure in the second review appears to have been produced by a different invocation than the one specified in this task (most likely without the `typecheck:libs` prerequisite, which — as this task's own investigation reproduced — can swing Central's and other packages' error counts unpredictably depending on stale/missing referenced-project build output).

### Chosen test/tsconfig boundary

No dedicated test-tsconfig pattern (Option A) exists anywhere in this repository — confirmed by searching for every `tsconfig*.json` file (10 total: root, base, and one per workspace package) and finding none scoped specifically to Node-runner tests. Applied **Option B**: added a narrow `exclude` array to `artifacts/central/tsconfig.json`:
```json
"exclude": ["node_modules", "tests/**", "**/*.test.ts", "**/*.test.tsx"]
```
This is the exact array specified in the task. It excludes only the `tests/` directory and any `*.test.ts(x)` file anywhere in the project — no normal runtime source file matches either pattern, so nothing that ships in the app is excluded. `strict: true` was left untouched.

### Why global Node types were not added

Adding `@types/node` (or similar) to the Central/Expo production project was explicitly out of scope and was not done, for the reason the task itself states: the React Native app project has no legitimate use for Node's global/module types (`node:test`, `node:fs`, etc.) in its own runtime code, and introducing them would blur the boundary between "code that ships in the app" and "Node-runner test scaffolding that merely lives in the same repository directory." Excluding the test files from the production project's `include` graph is the correct fix in both directions — it also means a future accidental `import "node:fs"` in real app code would still correctly fail to typecheck, which adding global Node types would have silently permitted.

### Post-fix verification

- **Central**: `pnpm run typecheck` → **0 errors**, reproduced 3 times in a row after a fresh `pnpm install` and full `.tsbuildinfo`/`dist` cleanup each time. Fully deterministic.
- **Admin**: `pnpm --filter @workspace/admin run typecheck` → 0 errors (unchanged).
- **api-server**: `pnpm --filter @workspace/api-server run typecheck` (and the equivalent root-pipeline invocation) was found to be **non-deterministic** — it flip-flopped between 0 and 126 errors (all in pre-existing, untouched Ballet integration-test files, e.g. `balletAssessmentPostgresIntegration.test.ts`, `balletAttendanceWrite.integration.test.ts`) across repeated runs. Critically, **this same flip-flop was reproduced on the unmodified `d5ab3bd` baseline commit itself**, under an identical fresh-install/clean-build procedure, with zero Batch 1 or Blocker-fix changes present. This is pre-existing flakiness in this repository's TypeScript composite-project (`tsc --build`) incremental caching for the `pg`/`@types/pg` ambient-module resolution, unrelated to Central, unrelated to Finance runtime logic, and out of this task's explicitly narrow scope (git diff for this task touches exactly one file: `artifacts/central/tsconfig.json`). It is documented here for transparency, not left silently unmentioned, but it is **not** a merge blocker introduced by this fix.
- Relocated test (`tests/booking/flow.duplicateBooking.test.ts`) run explicitly via `node --test`: **13/13 pass.**
- `bookings.occurrenceUniqueness.integration.test.ts` (Part F2/F3 + Blocker 2) re-run once: **6/6 pass.**
- `node artifacts/central/scripts/checkNoNativeAlert.js`: **✓ pass** (134 files scanned).
- `git diff --stat` for this task: **1 file changed** (`artifacts/central/tsconfig.json`, 14 insertions) — no Finance runtime file, no Ballet file, no other test file touched.
- No test was skipped, deleted, or weakened — the exclude only affects which files TypeScript's `tsc --noEmit` visits for Central; the relocated test still runs and passes under `node --test`, exactly as before.

### Tuesday/Thursday open UAT status (unchanged)

**Open UAT item — Tuesday/Thursday paid-state bleed was not reproduced automatically and must be verified on the deployed mobile flow before final feature closure.**

## 21. Final Decision

**PASS — Central typecheck scope blocker fixed; Finance Final Closure Batch 1 is ready for final independent verification.**
