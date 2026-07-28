# Finance Operational Amount Visibility Report

## Starting production commit

- Starting `origin/main`: `6ff48fee65b6bea7a22315d76fa21e2820e889c3`
- Feature worktree: `/private/tmp/finance-operational-amount-redaction`
- Feature branch: `codex/finance-operational-amount-redaction`
- No Central mobile source was changed.

## Exposure inventory

| Surface | Financial fields found | Previous visibility | Final requirement | Action amount needed? |
| --- | --- | --- | --- | --- |
| `GET /api/bookings` | `schedulePriceEgp` | Operational Booking viewers | `finance.view`; otherwise `null` | No |
| `GET /api/bookings/:id` | No price field in its established response schema | Operational Booking viewers | No financial field returned | No |
| `GET /api/bookings/:id/payment-confirmation-amount` | Captured final payable amount | New focused endpoint | `bookings.view` + `finance.paymentsConfirm`; pending Pay-at-Studio record only | Yes |
| `GET /api/package-orders` | `priceEgp` | Operational Package Order viewers | Captured payable amount for `finance.view`; otherwise `null` | No |
| `GET /api/package-orders/:id` | No price field in its established response schema | Operational Package Order viewers | No financial field returned | No |
| `GET /api/package-orders/:id/payment-confirmation-amount` | Captured final payable amount | New focused endpoint | `packageOrders.view` + `finance.paymentsConfirm`; pending activation only | Yes |
| `POST /api/admin/attendance/resolve` | `walkinPriceEgp` | Attendance check-in viewers | `finance.view`; otherwise `null` | No |
| `POST /api/admin/attendance/walkin-payment-amount` | Current server-resolved single-class price | New focused endpoint | `attendance.checkIn` + `finance.paymentsConfirm`; exact selected, currently open occurrence only | Yes |
| `GET /api/dashboard` | Revenue, refund exposure, payment-method totals | Dashboard viewers received zero placeholders | `finance.view`; otherwise explicit `null` | No |
| `GET /api/admin/ballet/applications/:id` | Payment history, current payment, refund amounts, eligibility amounts | Ballet application viewers | Full history only with `finance.view`; refund action values additionally allowed to `finance.refundsManage` | Yes, narrowly |
| `GET /api/admin/ballet/students/:assignmentId` | Current/historical Ballet payment amounts | Ballet application viewers | `finance.view`; otherwise `null` | No |
| `GET /api/admin/ballet/payments` | Full Ballet payments | Already `finance.view` protected | Unchanged | No |
| `GET /api/admin/ballet/payments/:id/payment-confirmation-amount` | Exact pending in-person amount | New focused endpoint | `ballet.payments.edit` + `finance.paymentsConfirm` | Yes |
| `GET /api/admin/ballet/refunds*` | Refund/payment amounts | Already `finance.view` protected | Unchanged | Refund mutations remain `finance.refundsManage` protected |
| `GET /api/admin/ballet/applications/:id/export.pdf` | Payment history and amounts | Ballet application viewers | `finance.view` + `finance.exports` | No |
| `GET /api/feedback/:id` | `scheduleSnapshot.priceEgp` | Feedback viewers | `finance.view`; otherwise `null` | No |
| `GET /api/admin/logs` | Amount-bearing `before`, `after`, and summaries | Audit-log viewers | Financial keys/text redacted without `finance.view`; summary search cannot be used as an amount oracle | No |
| Finance exports | All normalized financial fields | Finance view plus export permission | Existing `finance.view` + `finance.exports` gates retained | No |

Public/mobile catalog endpoints for class and package prices remain unchanged because they are required for customer purchase initiation and are explicitly outside the Admin operational-record policy. Operational captured amounts are not sourced from those public payloads.

## Final visibility policy

- `finance.view`: all operational financial fields and Finance reports.
- `finance.paymentsConfirm` without `finance.view`: only a server-authoritative amount for the exact eligible confirmation action, requested after selecting that record.
- `finance.refundsManage` without `finance.view`: only the exact eligibility values required for the selected refund action; no broader payment/refund history.
- Neither permission: operational details remain readable where the existing role permits them, while money fields are `null` or absent.
- Super Admin: retains full access through the canonical bypass.

## Backend redaction design

`financialVisibility.ts` is the canonical policy helper. It separates broad Finance visibility from payment/refund action visibility and provides an explicit `null` serializer. General operational responses never grant broad visibility because a user can confirm payments.

Dedicated action endpoints validate both authorization and current eligibility. They return no unrelated record data, do not write, reject stale/terminal actions, and derive amounts from captured payment records or the existing server-side Walk-in price resolver.

## Booking behavior

Booking lists redact `schedulePriceEgp` for Admin users without `finance.view`. Student-owned customer responses remain unchanged. The confirmation dialog loads the exact captured payable amount only after a permitted Admin selects a pending Pay-at-Studio booking. Payment and booking transition logic was not changed.

## Package Order behavior

Package Order lists expose captured final payable amounts only to `finance.view`; other operational users receive `priceEgp: null`. Package names, credits, status, student identity, and dates remain unchanged. The activation dialog loads only the selected pending order's captured amount. Activation and credit logic was not changed.

## Attendance and Studio Walk-in behavior

Attendance discovery redacts every `walkinPriceEgp` unless the Admin has `finance.view`. Selecting a Walk-in triggers a separate action-amount request that validates account/child ownership, candidate key, schedule, Cairo occurrence date, and open check-in window. Package-credit mode never receives or displays a cash amount. Settlement behavior and the `absent` exemption are unchanged.

## Ballet behavior

Operational application/student detail responses retain statuses, subscription dates, attendance, level/group, and workflow metadata while returning `null` for historical payment/refund amounts without `finance.view`. Payment confirmation retrieves only a selected pending in-person amount. Refund managers may receive the selected action's refund eligibility values without receiving broad history. Full Ballet payment/refund lists remain Finance-view protected.

## Admin UI behavior

General lists do not carry action amounts in client cache. Confirmation dialogs request the amount only when opened and disable confirmation while unavailable. Redacted Ballet values render as `Restricted`, never `0 EGP`, `NaN`, or a misleading dash. Dashboard financial sections remain absent without `finance.view`, including the previously exposed approved/processing refund-exposure card.

## Indirect leakage audit

- Dashboard financial response values are now `null`, not zero.
- Audit-log JSON money keys and amount-bearing summaries are redacted without `finance.view`.
- Unauthorized audit-log search does not search amount-bearing summaries.
- Feedback schedule snapshots redact their captured price.
- Ballet application PDF now requires both Finance view and export permission.
- Finance exports retain the existing dual permission gate.
- Query parameters do not enable optional financial fields on operational endpoints.
- No amount is included in new endpoint names, error messages, or filenames.
- No new logging of customer records or financial payloads was added.

## Tests

- Focused visibility, permission catalog, and Admin Finance UI: 72 passed.
- Real built-server Finance authorization/export/Dashboard: 11 passed.
- Cross-path payment-confirmation/action-amount authorization: 8 passed.
- Refund authorization: 7 passed.
- Booking payment confirmation: 15 passed.
- Package payment confirmation/activation: 18 passed.
- Studio Walk-in settlement: 15 passed.
- Ballet payment/refund lifecycle: 39 passed.
- Total recorded above: 185 passed, 0 failed, 0 skipped.
- Native alert audit: 134 Central files scanned, no direct native Alert usage.

## Typecheck and build results

- Dependency install with frozen lockfile: passed.
- Shared library typecheck: passed after cleaning TypeScript build caches.
- Admin typecheck: passed.
- Admin production build: passed.
- API production build: passed.
- API repository-wide typecheck: 122 known baseline errors remain in untouched files; prior deployed baseline count was 123. A changed-file filter reports zero errors in changed implementation files.

## Manual UAT checklist

- No Finance permission: Booking/Package prices absent; Dashboard money absent; action amounts unavailable.
- Finance view: Booking/Package/Dashboard/Ballet values visible.
- Payment confirmation only: lists remain redacted; selected Booking, Package, Walk-in, and Ballet action shows its exact amount.
- Refund management only: selected eligible refund shows only action-required amounts.
- Direct API calls and optional query parameters cannot widen visibility.
- Super Admin retains full visibility and action access.

These checks are pending for the owner and are not recorded as passed.

## Deployment plan

Fetch current `origin/main`, inspect upstream changes, create a clean release worktree, merge the feature with `--no-ff`, rerun affected verification, push `HEAD:main`, and monitor Railway API/Worker plus Vercel Admin. Central mobile must not be released.

## Rollback plan

Revert the release merge on `main`, push the revert through the normal process, and monitor the same services. No database migration or destructive data change is introduced, so rollback is code-only.

## Remaining work

- Manual role-based browser UAT by the owner.
- Public customer catalog pricing remains intentionally public and is not an Admin operational-record exposure.
