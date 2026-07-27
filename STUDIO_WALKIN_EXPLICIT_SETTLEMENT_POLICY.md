# Studio Walk-in — Explicit Settlement Policy

This document supersedes every prior document, comment, test, or implementation that described or encoded an automatic package-credit preference for Studio Walk-ins.

## Core rules

- Walk-in describes arrival/booking state, not payment method. "Walk-in" means the participant arrived without a prior booking — it says nothing about how the class is being settled.
- Package availability never decides payment automatically. The mere existence of a valid, available package credit must never select `package_credit` on its own.
- Admin choice is mandatory. Every Studio Walk-in requires an explicit Admin selection of exactly one settlement mode: `package_credit`, `pay_at_studio`, or `not_paid`. There is no default and no hidden fallback. A request that omits the choice is rejected with a validation error before any write occurs.
- Pay at Studio never touches credits. Choosing `pay_at_studio` leaves any package credits byte-for-byte unchanged, even when the participant has one or more valid packages available. Package availability is not queried as a reason to deduct on this path.
- Package Credit deducts one credit only after explicit selection. Choosing `package_credit` deducts exactly one credit from the selected package, records exactly one credit ledger entry, and creates zero payment/monetary rows.
- Not Paid creates nothing. Choosing `not_paid` cancels the whole operation — zero attendance, booking, payment, or credit rows are written.

## Exemption: marking "absent"

Recording a participant as `absent` (a no-show status update, not an arrival) is exempt from the mandatory settlement choice — there is no payment decision to make when nobody showed up. This preserves the pre-existing behavior of the legacy manual Attendance page (`artifacts/admin/src/pages/attendance.tsx`), which records status changes (`checked_in` / `late` / `absent`) independently of Walk-in payment capture. Every other status (the default `checked_in`, and `late`) is a genuine arrival and requires the explicit choice.

## Where this is enforced

- **Contract**: `CheckInBodyExtended` in [`lib/api-zod/src/qr-attendance.ts`](lib/api-zod/src/qr-attendance.ts) — `settlementMode: "package_credit" | "pay_at_studio" | "not_paid"`, mandatory via `superRefine` whenever `bookingId` is absent and `status !== "absent"`.
- **Server branching**: [`artifacts/api-server/src/routes/attendance.ts`](artifacts/api-server/src/routes/attendance.ts) — the Walk-in transaction branches strictly on `settlementMode`; nothing is inferred from `packageOrderId`, `creditDeducted`, or participant state.
- **Pay at Studio capture**: [`artifacts/api-server/src/lib/checkInService.ts`](artifacts/api-server/src/lib/checkInService.ts) `performStudioWalkIn()` — resolves the exact server-side single-class price and creates the canonical `payment_records`/`payment_events` rows; never queries or mutates `package_orders`.
- **Admin UI surfaces** (all three now require the explicit choice, none pre-select `package_credit`):
  - `artifacts/admin/src/components/scan-check-in-dialog.tsx` (legacy scan/email Walk-in path)
  - `artifacts/admin/src/components/unified-attendance-dialog.tsx` (Unified Attendance Gateway)
  - `artifacts/admin/src/pages/attendance.tsx` (manual search-by-email Attendance page)

## Package availability must never trigger automatic credit deduction for a Studio Walk-in.
