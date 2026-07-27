# Finance Final Closure Batch 1 — Independent Review Response

Review history addressed, in order:
- **Round 1**: `CHANGES REQUIRED` on commit `82d3cb4` (stable participant-ID identity bug, PostgreSQL 23505 not mapped to `duplicate_booking`) → fixed in `8eaa560`.
- **Round 2**: review of `63a0e04` found one remaining merge blocker (Central typecheck scope — a Node test file still compiled by the RN production TypeScript project) → fixed in `5633d29`.
- **Round 3 (final)**: independent review of `35b3f7c` returned verdict `PASS WITH DOCUMENTATION CLEANUP` — the runtime implementation was independently verified and merge-ready; only stale documentation remained to be corrected (this document and the implementation report).

Branch: `feat/finance-final-closure-batch-1`. Final reviewed head: `35b3f7cd4b3a18c7f2e71a32ecf873dd8b688ae3` (`35b3f7c`).

## Blocker 1 — Stable participant identity in mobile duplicate-booking detection

**Status: Fixed.**

- Confirmed the exact defect: `booking/flow.tsx`'s `childAlreadyBooked` matched on `participantName === child.fullName`, unsafe for the reasons cited (shared names, edits, casing/spacing).
- Added `participantChildId?: number | null` to `AppContext.tsx`'s `Booking` interface and to `ApiMyBooking`; mapped it in the sole API→local mapper, `mapMyBookingToLocal`.
- **Found and closed a gap the bug report didn't call out**: the server's `GET /api/my/bookings` (`myRoutes.ts`) never actually included `participantChildId` in its JSON response — only the raw DB row had it internally. Added the field to the response object; without this, the mobile fix would have had nothing to map.
- Rewrote `childAlreadyBooked` to the reviewer's preferred shape: check `booking.participantChildId != null` first (exact `String()` comparison against `child.id`), falling back to a normalized (`trim().toLowerCase()`) name comparison only when `participantChildId` is `null`.
- The optimistic local booking object created immediately after a successful `POST /bookings` (in `flow.tsx`, before the next server refetch) also now carries `participantChildId`, so the fix is consistent immediately, not only after the next `/my/bookings` refresh.

## Blocker 2 — Map PostgreSQL 23505 to duplicate_booking

**Status: Fixed.**

- Confirmed the exact defect: the losing side of a true concurrent duplicate-booking race hit migration 0085's DB constraint with no `try/catch` around the transaction, so the raw Postgres error propagated to Express's default handler as a 500.
- Proved the exact runtime error shape against a disposable database before writing any detection code — see the review-response §"Constraint-name verification" in the updated implementation report, or directly: `err.code` is `undefined` at the top level; `err.cause.code === "23505"`; `err.cause.constraint === "bookings_active_occurrence_participant_unique"` (drizzle-orm/node-postgres wraps the raw `pg` error in `DrizzleQueryError`, exposing SQLSTATE/constraint only on `.cause`).
- Implemented `isOccurrenceDuplicateViolation(error)` exactly matching the reviewer's preferred narrow-detection shape (checks both the top-level and `.cause`-nested `code`/`constraint`), wrapped the booking-creation transaction in `try/catch`, and mapped a match to the existing `409 duplicate_booking` response — verbatim the same message/code the pre-existing application-level check already returns for this business condition. Any other error is rethrown unchanged.

## Migration 0085 Re-verification

**Status: Confirmed correct, not rewritten.**

- Re-diffed the applied index definition on a disposable database against the Drizzle schema declaration — match confirmed (only a trailing-newline formatting difference in the diff tool output, not a real difference).
- Re-confirmed: `occurrence_date IS NOT NULL` (non-null occurrence only), `booking_status IN ('pending','confirmed')` (active duplicate-blocking statuses only, cancelled/rejected excluded), `account_owner_student_id IS NOT NULL` (excludes pre-Membership-Engine legacy rows), `coalesce(participant_child_id, 0)` (stable participant identity, collides two "self" bookings correctly).
- No historical data was mutated. Applied only to the disposable database `central_studio_disposable_occurrence_unique` in this task; **not applied to production**.

## Tuesday/Thursday Occurrence Issue

**Status: Open UAT item — not claimed as closed.**

> Open UAT item — Tuesday/Thursday paid-state bleed was not reproduced automatically and must be verified on the deployed mobile flow before final feature closure.

The independent review is correct that the existing diagnostic test (`myBookings.occurrenceIndependence.integration.test.ts`) exercises the server data/API layer directly over HTTP, not the actual mobile `app/(tabs)/bookings.tsx`/`app/(tabs)/classes.tsx` rendering path. No attempt was made to invent a fix without reproduction, and no runtime occurrence behavior was changed in this fix task. This remains an explicit, tracked open item pending real-device/simulator UAT.

## Round 2 — Central Typecheck Scope Blocker

**Status: Fixed** (commit `5633d29`).

**Reviewer's stated inconsistency resolved before making any change**: the second review claimed baseline Central typecheck = 0, current branch = 37, only 3 attributed to the relocated test — internally inconsistent arithmetic as stated. Investigation (fresh `d5ab3bd` worktree, exact `pnpm --filter @workspace/central run typecheck` command, run after the required root prerequisite `pnpm run typecheck:libs`) found:
- **Exact baseline count: 34** (not 0) — 12 pre-existing Ballet-related `node:test`/`node:assert`/`node:fs`/`node:path` files, confirmed via 3 repeated runs.
- **Exact pre-fix branch count: 37** — the same 12 files plus exactly 1 new file (the relocated test, 3 errors).
- **Delta: +3**, matching the review's own "3 errors attributed to the relocated test" — the review's arithmetic was actually correct; only its stated baseline (0) was wrong.

**Fix**: no dedicated test-tsconfig pattern exists anywhere in this repo (checked all 10 `tsconfig*.json` files), so applied the task's specified Option B — added `"exclude": ["node_modules", "tests/**", "**/*.test.ts", "**/*.test.tsx"]` to `artifacts/central/tsconfig.json`. No global Node types were added to the RN production project (deliberately — see the report's full rationale). `strict: true` unchanged; no runtime source file matches either exclude pattern.

**Post-fix verification**:
- Central: **0 errors**, reproduced 3× after fresh installs/clean builds — deterministic.
- Admin: 0 errors (unchanged).
- api-server: found to be **non-deterministic** (0/126 flip-flopping) — but reproduced identically on the **unmodified baseline** under the same clean conditions, proving this is pre-existing repo flakiness in `tsc --build`'s incremental caching, unrelated to Central, Finance runtime logic, or this task's one-file change.
- Relocated test via `node --test`: **13/13 pass**.
- `bookings.occurrenceUniqueness.integration.test.ts` re-run once: **6/6 pass**.
- `checkNoNativeAlert.js`: pass.
- `git diff --stat`: **1 file** (`artifacts/central/tsconfig.json`) — confirms no Finance runtime logic was touched.

## Final Verified State (as of `35b3f7c`)

| Item | Status |
|---|---|
| Stable participant-ID (Blocker 1) | **PASS** |
| PostgreSQL 23505 → `duplicate_booking` mapping (Blocker 2) | **PASS** |
| Migration 0085 (re-verified, not rewritten) | **PASS** |
| Central production typecheck | **0 errors** |
| Total tests | **242/242 passed, 0 failed, 0 skipped** |
| API build | **clean** |
| Admin typecheck | **clean (0 errors)** |
| `checkNoNativeAlert.js` | **clean** (134 files scanned) |
| Worktree state at final independent review | **clean** |

## Verification Summary

- **Focused tests**: stable participant-ID duplicate selector (13/13), occurrence uniqueness + concurrent 409 mapping (6/6), Finance read-model regression (37/37 + 88/88 filters/export/UI), payment confirmation regression (15/15 + 23/23), Attendance Gateway regression (18/18) — all passing, part of the final total of **242 tests executed, 242 passed, 0 failed, 0 skipped**. Full run-by-run detail in the updated `FINANCE_FINAL_CLOSURE_BATCH_1_REPORT.md`.
- **Typechecks**: `admin` clean (0), `central` clean (0, deterministic, 3× reproduced). `api-server` exhibits pre-existing, baseline-reproduced non-determinism unrelated to this work (documented, not hidden) — the API build itself is clean.
- **Guard**: `checkNoNativeAlert.js` — passes (134 files scanned).
- **Stability**: the Blocker 2 concurrency test repeated 5× (round 1) — 5/5 pass, no intermittent failures.

## Open UAT Item (unchanged through every round)

**Open UAT item — Tuesday/Thursday paid-state bleed was not reproduced automatically and must be verified on the deployed mobile flow before final feature closure.**

This is not described as fixed or closed at any point in this record.

## Final Status

**PASS — Finance Final Closure Batch 1 independently verified and ready for controlled merge; Tuesday/Thursday remains a required post-deployment UAT item.**
