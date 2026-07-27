# Finance Roles & Permissions Integration Report

## Starting repository state

- Recovered worktree: `/private/tmp/finance-roles-permissions`
- Branch: `feat/finance-roles-permissions`
- Starting HEAD: `4c32e9e838b40becf8fe29850f1a758977415c32`
- Starting `origin/main`: `4c32e9e838b40becf8fe29850f1a758977415c32`
- Claude's uncommitted implementation and four partially completed test files were preserved.
- No rebase or merge was performed while completing and verifying the feature.

## Existing Roles architecture

The implementation uses the existing catalog in `@workspace/api-zod`, JSON role assignments stored by the existing Roles system, `hasRolePermission`, `requireAdminPermission`, `RouteGuard`, and `AdminAuthContext.can`. No second role or authorization system was introduced.

## Exact Finance permission keys

- `finance.view`
- `finance.paymentsConfirm`
- `finance.refundsManage`
- `finance.exports`

## Permission registration and default assignment behavior

The previously reserved `finance` module is activated additively. Undefined permissions remain false for ordinary roles. Existing custom role JSON is not rewritten. Catalog registration is static and idempotent. No database migration is required. Super Admin/Owner continues to bypass individual grants through the existing `isSuperAdmin` behavior.

## Protected Admin navigation/routes

All `/finance` pages and the Finance navigation group require `finance.view`. The sidebar recursively removes groups with no visible children, so no empty Finance group remains. Direct routes render `AccessDenied` and do not render protected children. Ballet payment/refund financial pages also require `finance.view`.

Payment controls on Bookings, Package Orders, Ballet Payments, Attendance/Walk-in entry points, and refund mutation controls use the matching Finance action permission. Finance export controls require `finance.exports` in addition to the page's `finance.view`.

## Protected Finance read APIs

| Method | Route | Capability | Guard position |
|---|---|---|---|
| GET | `/api/finance/overview` | Finance overview | `finance.view` before query |
| GET | `/api/finance/transactions` | Transaction feed | `finance.view` before query |
| GET | `/api/finance/backfill-batches*` | Backfill financial evidence | `finance.view` or existing Super Admin control before query/write |
| GET | `/api/admin/ballet/payments` | Ballet financial records | `finance.view` before query |
| GET | `/api/admin/ballet/refunds` | Refund records | `finance.view` before query |
| GET | `/api/admin/ballet/refunds/:id` | Single refund | `finance.view` before query |

Public/mobile customer payment initiation and customer-owned cancellation/refund reads were not given Admin Finance permissions.

## Protected payment confirmation paths

| Method | Route | Financial transition | Required permissions |
|---|---|---|---|
| PATCH | `/api/package-orders/:id` | `status: active` | existing Package Order action + `finance.paymentsConfirm` |
| PATCH | `/api/bookings/:id` | `paymentStatus: paid` | existing Booking update + `finance.paymentsConfirm` |
| POST | `/api/attendance` | `settlementMode: pay_at_studio` | existing Attendance/QR permissions + `finance.paymentsConfirm` |
| POST | `/api/admin/attendance/confirm` | Studio `paymentMode: pay_at_studio` | existing Attendance/QR permissions + `finance.paymentsConfirm` |
| PATCH | `/api/admin/ballet/payments/:id/status` | `status: paid` | `ballet.payments.edit` + `finance.paymentsConfirm` |
| PATCH | `/api/admin/ballet/applications/:applicationId/payments/:id/status` | `status: paid` | `ballet.payments.edit` + `finance.paymentsConfirm` |

Each conditional Finance guard is middleware before the handler. Non-payment edits and `status: absent` attendance behavior are unchanged. Pending Ballet creation/renewal is not classified as confirmation.

## Protected refund paths

Refund list/single reads require `finance.view`. Approve, reject, mark-processing, mark-refunded, and mark-failed compose the existing `ballet.payments.edit` guard with `finance.refundsManage`, before any handler write.

## Protected export paths

`GET /api/finance/export` requires both `finance.view` and `finance.exports` before the data query or workbook/PDF generation. JSON, XLSX, and PDF share this middleware chain. The Admin export page and buttons are unavailable without the matching grants.

## Super Admin behavior

The existing Super Admin bypass remains authoritative for all four capabilities. Real-route integration coverage verifies Finance reads and export; refund and permission tests verify read/mutation behavior without explicit Finance grants.

## Financial leakage audit

The Admin Dashboard previously returned and rendered revenue, payment-method totals, refund totals, and refund exposure with only `dashboard.view`. The API now redacts every financial amount to zero and removes financial metadata unless `finance.view` is present; the Admin page also omits the revenue hero and financial sections.

Financial values intentionally remain on operational Booking and Package Order records for users who already have those modules' read permissions. These values are needed to identify and service the underlying operational record; the dedicated Finance aggregate/feed and mutation capabilities remain independently protected. A separate product decision can further field-redact mixed operational APIs if the owner wants `finance.view` to govern every per-record price.

## Files changed

See the committed diff for the exact authoritative list. Scope is limited to the Finance permission catalog, Admin route/navigation/action visibility, backend authorization middleware, Dashboard financial redaction, focused tests, and this report. No Central mobile file is changed.

## Test results

204 affected assertions passed with zero skips, including:

- 12 Finance catalog/UI/middleware authorization contracts
- 11 real-built-server Finance read, Dashboard redaction, export matrix, authentication, and Super Admin checks
- 7 cross-route payment permission checks, including 403 + global zero-write snapshots for Package, Booking, Walk-in, Ballet assessment, and Ballet subscription paths
- 7 refund permission checks, including read denial, view-only mutation denial with zero writes, authorized mutation, and Super Admin
- 13 pre-existing Finance permission-scope regressions
- 56 Package and Booking confirmation invariants
- 26 Studio Walk-in settlement, atomicity, zero-writer, absence, and post-commit notification invariants
- 39 Ballet cancellation/payment/refund route invariants
- 33 refund-cycle eligibility invariants

The existing Node module-mock suites require `--experimental-test-module-mocks` to be forwarded through `tsx` on this machine. The 39-test Ballet suite's default port-5602 database was unavailable, so it was run successfully against the already migrated local disposable hotfix database. Neither adjustment changes application behavior or test assertions.

## Typecheck/build results

- `pnpm install --frozen-lockfile`: pass
- `pnpm run typecheck:libs`: pass
- API production build: pass
- Admin typecheck: pass
- Admin production build: pass
- Central native-alert scan: pass, 134 files scanned
- API typecheck: known baseline noise only. Exact `4c32e9e` baseline: 125 errors total / 60 in subsequently touched target files. Feature state: 123 total / 58 in target files. The feature adds zero errors and removes two baseline errors; production build remains clean.

## Independent review findings

The initial takeover review found and fixed two blockers in the partial work: Ballet financial reads could still bypass `finance.view` via legacy Ballet permissions, and Dashboard financial values were exposed through `dashboard.view`. Final committed-diff answers and regression findings are recorded after commit.

## Deployment plan

After commit and independent review: fetch `origin/main`, compare upstream, create a clean release worktree, merge with `--no-ff`, rerun affected verification, push through the normal process, and monitor Railway API, Railway Worker, and Vercel Admin. Central mobile is excluded.

## Rollback plan

Revert the release merge commit and redeploy API/Admin. No schema migration or destructive data operation is introduced, so rollback does not require a database reversal.

## Manual UAT deferred to the owner

Manual role-based UI checks remain pending: no Finance permission, view-only, payment-confirm, refund-manage, export-with-view, and Super Admin scenarios. Lack of an authenticated browser session is not used to fabricate evidence or block release after automated verification.

## Remaining Dashboard cleanup task

The authorization leak is closed. A later design cleanup may replace hidden sections with a non-financial Dashboard layout and may decide whether mixed operational record prices should be redacted at field level for non-Finance roles.
