# Finance Final Closure Batch 1 — Independent Review Response

Review verdict addressed: `CHANGES REQUIRED` on commit `82d3cb4`.
Fix commit: `8eaa560` on branch `feat/finance-final-closure-batch-1`.

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

## Verification Summary

- **Focused tests**: stable participant-ID duplicate selector (13/13), occurrence uniqueness + concurrent 409 mapping (6/6), Finance read-model regression (37/37 + 88/88 filters/export/UI), payment confirmation regression (15/15 + 23/23), Attendance Gateway regression (18/18) — all passing. Full run-by-run detail in the updated `FINANCE_FINAL_CLOSURE_BATCH_1_REPORT.md`.
- **Typechecks**: `admin` and `api-server` clean. `central` has the same pre-existing 12-file `node:test`/`node:assert` baseline error set plus exactly one new file (the relocated test itself, same pre-existing error category) — proven via a direct baseline-vs-fix diff, not asserted.
- **Guard**: `checkNoNativeAlert.js` — passes (134 files scanned).
- **Stability**: the Blocker 2 concurrency test repeated 5× — 5/5 pass, no intermittent failures.

## Final Status

**PASS — Independent-review blockers fixed; Finance Final Closure Batch 1 is ready for re-review.**
