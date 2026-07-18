import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  APPLICATION_DETAIL_TABS,
  buildApplicationDetailTabUrl,
  parseApplicationTab,
} from "../../../admin/src/pages/ballet/application-detail/tabState.ts";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const dangerZone = read("artifacts/central/components/ballet/BalletProgramDangerZone.tsx");
const programScreen = read("artifacts/central/app/ballet/index.tsx");
const adminDetailPage = read("artifacts/admin/src/pages/ballet/ApplicationDetailPage.tsx");
const adminDetailTabFiles = [
  "artifacts/admin/src/pages/ballet/application-detail/OverviewTab.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/ApplicationTab.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/EnrollmentTab.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/PaymentsSubscriptionTab.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/CancellationRefundsTab.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/ActivityTab.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/shared.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/index.tsx",
  "artifacts/admin/src/pages/ballet/application-detail/types.ts",
  "artifacts/admin/src/pages/ballet/application-detail/tabState.ts",
];
const adminDetailTabs = adminDetailTabFiles.map(read).join("\n");
const adminDetailSource = `${adminDetailPage}\n${adminDetailTabs}`;
const cancellationListPage = read("artifacts/admin/src/pages/ballet/BalletCancellationRequestsPage.tsx");
const adminPaymentsPage = read("artifacts/admin/src/pages/ballet/BalletPaymentsPage.tsx");
const adminPaymentsRoute = read("artifacts/api-server/src/routes/adminBalletPayments.ts");
const balletPaymentsSchema = read("lib/db/src/schema/balletPayments.ts");
const pendingRenewalMigration = read("lib/db/migrations/0071_ballet_pending_renewal_uniqueness.sql");

// ─── Mobile Danger Zone (spec §2–4, §10) ────────────────────────────────────────

test("mobile Danger Zone derives its action from the shared authoritative rule", () => {
  assert.match(dangerZone, /import \{ resolveBalletDangerAction,[^}]*\} from "@workspace\/api-zod"/);
  assert.match(dangerZone, /resolveBalletDangerAction\(\{[\s\S]*?viewer: "parent"/);
});

test("mobile Danger Zone refetches authoritative server state on focus (no polling)", () => {
  assert.match(dangerZone, /useFocusEffect\(/);
  assert.match(dangerZone, /fetchBalletApplicationDetail\(/);
  assert.doesNotMatch(dangerZone, /setInterval|setTimeout\(/);
});

test("mobile Danger Zone renders each status-gated action label", () => {
  assert.match(dangerZone, /label="Cancel Application"/);
  assert.match(dangerZone, /label="Cancel Program"/);
  assert.match(dangerZone, /View Cancellation Request/);
  assert.match(dangerZone, /Withdraw Cancellation Request/);
  assert.match(dangerZone, /Apply Again/);
});

test("mobile reason validation enforces trimmed 5–500 characters", () => {
  assert.match(dangerZone, /trimmedReason\.length < 5/);
  assert.match(dangerZone, /trimmedReason\.length > 500/);
  assert.match(dangerZone, /const trimmedReason = reasonText\.trim\(\)/);
});

test("mobile Danger Zone prevents duplicate submissions via a busy guard", () => {
  assert.match(dangerZone, /if \(!reasonModal \|\| reasonError \|\| busy\) return;/);
  assert.match(dangerZone, /disabled=\{Boolean\(reasonError\) \|\| busy\}/);
});

test("mobile refund option is shown only from backend refund eligibility, with no amount input", () => {
  assert.match(dangerZone, /detail\?\.eligibleRefund\?\.eligible === true/);
  assert.match(dangerZone, /Request Cash Refund/);
  assert.doesNotMatch(dangerZone, /amountEgp.*TextInput|TextInput.*amount/i);
});

test("mobile Danger Zone uses the semantic danger token (not a hardcoded random red)", () => {
  assert.match(dangerZone, /const DANGER = colors\.error;/);
  assert.match(dangerZone, /minHeight: 48/);
});

test("mobile Danger Zone handles 409/422 by refetching and showing a safe message", () => {
  assert.match(dangerZone, /status === 409 \|\| status === 422/);
  assert.match(dangerZone, /await load\(\);/);
});

test("main Ballet program screen mounts the Danger Zone for a parent, after program content", () => {
  assert.match(programScreen, /import BalletProgramDangerZone from "@\/components\/ballet\/BalletProgramDangerZone"/);
  assert.match(programScreen, /user\?\.accountType === "parent" && <BalletProgramDangerZone \/>/);
});

// ─── Admin Danger Zone (spec §5, §10) ────────────────────────────────────────────

test("admin detail page renders a visually-separated Danger Zone card", () => {
  assert.match(adminDetailSource, /Danger Zone/);
  assert.match(adminDetailSource, /border-red-500\/40/);
  assert.match(adminDetailSource, /AlertTriangle/);
});

test("admin Danger Zone is gated on ballet.applications cancel and derives the shared action", () => {
  assert.match(adminDetailPage, /const canCancel = can\("ballet\.applications", "cancel"\)/);
  assert.match(adminDetailPage, /resolveBalletDangerAction\(\{[\s\S]*?viewer: "admin"/);
  assert.match(adminDetailTabs, /\{canCancel && \(/);
});

test("admin pre-activation Cancel Application calls the existing admin cancel transaction", () => {
  assert.match(adminDetailPage, /applications\/\$\{appId\}\/cancel/);
  assert.match(adminDetailSource, /Cancel Application/);
});

test("admin active Cancel Program modal offers Immediate + End of Current Period, reason and internal notes", () => {
  assert.match(adminDetailPage, /applications\/\$\{appId\}\/request-cancellation/);
  assert.match(adminDetailPage, /<SelectItem value="immediate">Immediate<\/SelectItem>/);
  assert.match(adminDetailPage, /End of Current Period/);
  assert.match(adminDetailPage, /Internal admin notes \(optional\)/);
});

test("admin Danger Zone shows the eligible payment summary (original, refunded, remaining) with no amount input", () => {
  assert.match(adminDetailPage, /Original amount: \{eligibleRefund\.originalAmountEgp\}/);
  assert.match(adminDetailPage, /Already refunded: \{eligibleRefund\.alreadyRefundedEgp\}/);
  assert.match(adminDetailPage, /Remaining refundable: \{eligibleRefund\.remainingRefundableEgp\}/);
  assert.doesNotMatch(adminDetailPage, /Bank Transfer.*<input|Online Payment.*<input/);
});

test("admin refund toggle is cash-only — no Bank Transfer / Online Payment refund options", () => {
  assert.match(adminDetailPage, /no Bank Transfer \/ Online refund/);
  assert.doesNotMatch(adminDetailPage, /refundMethod: "bankTransfer"|refundMethod: "originalPaymentMethod"/);
});

test("admin open-request state shows Manage Cancellation Request (no duplicate Cancel button)", () => {
  assert.match(adminDetailSource, /Manage Cancellation Request/);
  assert.match(adminDetailSource, /dangerAction\.kind === "viewCancellationRequest"/);
});

test("admin reason requires min 5 characters before submit is enabled", () => {
  assert.match(adminDetailPage, /cancelReason\.trim\(\)\.length < 5/);
});

test("admin cancellation mutations refetch (invalidate) server state on success", () => {
  assert.match(adminDetailPage, /queryClient\.invalidateQueries\(\{ queryKey: \["ballet-cancellation-requests"\] \}\)/);
});

// ─── Initiator attribution surfaced in admin UI (spec §6) ────────────────────────

test("admin detail page attributes each cancellation request to Parent or the Admin name", () => {
  assert.match(adminDetailSource, /Initiated by:/);
  assert.match(adminDetailSource, /request\.initiatedByType === "admin"/);
});

test("admin cancellation list page shows an Initiated By column", () => {
  assert.match(cancellationListPage, /<TableHead>Initiated By<\/TableHead>/);
  assert.match(cancellationListPage, /row\.initiatedByType === "admin" \? \(row\.initiatedByAdminName/);
});

// ─── Ballet subscription/payment lifecycle cleanup ───────────────────────────

test("admin application detail no longer exposes Subscription Actions", () => {
  assert.doesNotMatch(adminDetailSource, /Subscription Actions/);
  assert.doesNotMatch(adminDetailSource, /Extend Subscription/);
  assert.doesNotMatch(adminDetailSource, /Renew Subscription/);
  assert.doesNotMatch(adminDetailSource, /subscriptions\/renew/);
  assert.doesNotMatch(adminDetailSource, /payments\/\$\{payment\.id\}\/extend/);
});

test("admin application detail keeps read-only payment/subscription summary and compact management actions", () => {
  assert.match(adminDetailTabs, /<SummaryCard label="Payment Status"/);
  assert.match(adminDetailTabs, /<SummaryCard label="Subscription"/);
  assert.match(adminDetailTabs, /<Section title="Payment">/);
  assert.match(adminDetailTabs, /<Section title="Activation Readiness">/);
  assert.match(adminDetailTabs, /<Section title="Subscription Management">/);
  assert.match(adminDetailTabs, /Adjust Expiry/);
  assert.match(adminDetailTabs, /Open Payment History/);
  assert.doesNotMatch(adminDetailSource, /Create Pending Renewal/);
  assert.doesNotMatch(adminDetailSource, /Renew Subscription/);
});

test("admin application detail exposes initial-payment actions without restoring renewal actions", () => {
  assert.match(adminDetailSource, /Create Initial Payment/);
  assert.match(adminDetailSource, /Initial payment recorded/);
  assert.match(adminDetailSource, /Payment confirmed/);
  assert.match(adminDetailSource, /Subscription period active/);
  assert.match(adminDetailPage, /api\/admin\/ballet\/payments/);
  assert.match(adminDetailSource, /Confirm Payment/);
  assert.doesNotMatch(adminDetailSource, /subscriptions\/renew/);
  assert.doesNotMatch(adminDetailSource, /Extend Subscription/);
});

test("admin application detail renders the approved six tabs in order with URL-backed tab state", () => {
  assert.deepEqual(APPLICATION_DETAIL_TABS, [
    { value: "overview", label: "Overview" },
    { value: "application", label: "Application" },
    { value: "enrollment", label: "Enrollment" },
    { value: "payments", label: "Payments & Subscription" },
    { value: "cancellation", label: "Cancellation & Refunds" },
    { value: "activity", label: "Activity" },
  ]);
  assert.match(adminDetailPage, /const search = useSearch\(\)/);
  assert.match(adminDetailPage, /const activeTab = parseApplicationTab\(search\)/);
  assert.match(adminDetailPage, /navigate\(buildApplicationDetailTabUrl\(\{/);
  assert.match(adminDetailPage, /hash: window\.location\.hash/);
  assert.match(adminDetailPage, /<Tabs value=\{activeTab\} onValueChange=\{setActiveTab\}/);
  assert.match(adminDetailPage, /overflow-x-auto/);
});

test("application detail tab parser defaults safely and recognizes direct links", () => {
  const cases = [
    ["", "overview"],
    ["?tab=payments", "payments"],
    ["tab=enrollment", "enrollment"],
    ["?tab=cancellation", "cancellation"],
    ["?tab=invalid", "overview"],
    ["?other=kept&tab=activity", "activity"],
  ];
  for (const [search, expected] of cases) {
    assert.equal(parseApplicationTab(search), expected);
  }
});

test("application detail tab URLs preserve pathname, unrelated params and hash", () => {
  assert.equal(
    buildApplicationDetailTabUrl({
      pathname: "/ballet/applications/17",
      search: "?filter=open&tab=application",
      hash: "#history",
      tab: "payments",
    }),
    "/ballet/applications/17?filter=open&tab=payments#history",
  );
  assert.equal(
    buildApplicationDetailTabUrl({
      pathname: "/ballet/applications/17",
      search: "?filter=open&tab=payments",
      hash: "#history",
      tab: "overview",
    }),
    "/ballet/applications/17?filter=open#history",
  );
});

test("application detail tab selection follows browser history search values without reloads", () => {
  const historySearches = ["", "?tab=payments", "?tab=enrollment", "?tab=payments"];
  assert.deepEqual(historySearches.map(parseApplicationTab), ["overview", "payments", "enrollment", "payments"]);
  assert.doesNotMatch(adminDetailPage, /window\.location\.(assign|replace)|window\.location\.reload/);
});

test("admin application detail Next Required Action uses the corrected status matrix", () => {
  assert.match(adminDetailPage, /const REVIEW_ACTION_STATUSES = new Set<BalletApplicationStatus>\(\["pending", "needsFollowUp"\]\)/);
  assert.match(adminDetailPage, /const TERMINAL_ACTION_STATUSES = new Set<BalletApplicationStatus>\(\["rejected", "cancelled", "withdrawn"\]\)/);
  assert.match(adminDetailPage, /const applicationStatus = app\.status as BalletApplicationStatus/);
  assert.match(adminDetailPage, /REVIEW_ACTION_STATUSES\.has\(applicationStatus\) \? "Review Application"/);
  assert.match(adminDetailPage, /TERMINAL_ACTION_STATUSES\.has\(applicationStatus\) \? "Application closed"/);
  assert.match(adminDetailPage, /app\.status === "active" \? "No action required"/);
  assert.match(adminDetailPage, /app\.status === "accepted" && !levelAssigned \? "Assign Level"/);
  assert.match(adminDetailPage, /app\.status === "assignedToLevel" && !groupAssigned \? "Assign Group"/);
  assert.match(adminDetailPage, /!initialPaymentRecorded \? "Create Initial Payment"/);
  assert.match(adminDetailPage, /pendingInitialPayment \? "Confirm Payment"/);
  assert.match(adminDetailPage, /paidInitialPaymentRequiresReview \? "Payment data requires review"/);
  assert.match(adminDetailPage, /canActivateApplication \? "Activate Application"/);
});

test("admin application detail warns on paid payment with missing subscription dates instead of confirming again", () => {
  assert.match(adminDetailPage, /const paidInitialPaymentRequiresReview = Boolean/);
  assert.match(adminDetailPage, /parseSubscriptionDate\(paidInitialPayment\?\.subscriptionStartDate\)/);
  assert.match(adminDetailPage, /parseSubscriptionDate\(paidInitialPayment\?\.subscriptionExpiresAt\)/);
  assert.match(adminDetailPage, /!hasValidPaidInitialSubscriptionDates/);
  assert.match(adminDetailPage, /Confirm Payment only supports pending payments/);
  assert.match(adminDetailTabs, /nextRequiredAction === "Payment data requires review"/);
  assert.doesNotMatch(adminDetailPage, /subscriptionReadinessState !== "complete" \? "Confirm Payment"/);
});

test("admin application detail treats malformed or invalid paid subscription date ranges as review-required data", () => {
  assert.match(adminDetailPage, /function parseSubscriptionDate/);
  assert.match(adminDetailPage, /Number\.isNaN\(parsed\.getTime\(\)\) \? null : parsed/);
  assert.match(adminDetailPage, /paidInitialExpiryDate\.getTime\(\) > paidInitialStartDate\.getTime\(\)/);
  assert.match(adminDetailPage, /paidInitialPaymentRequiresReview \? "Payment data requires review"/);
});

test("admin application detail treats valid expired paid subscriptions as renewal-required, not confirmable", () => {
  assert.match(adminDetailPage, /const paidInitialSubscriptionExpired = Boolean/);
  assert.match(adminDetailPage, /hasValidPaidInitialSubscriptionDates/);
  assert.match(adminDetailPage, /paidInitialPayment\.subscriptionStatus === "expired"/);
  assert.match(adminDetailPage, /paidInitialSubscriptionExpired \? "Subscription expired — renewal required"/);
  assert.match(adminDetailTabs, /nextRequiredAction === "Subscription expired — renewal required"/);
  assert.match(adminDetailTabs, /Open Payment History/);
  assert.match(adminDetailSource, /Renewal remains in Ballet Payments/);
  const expiredActionBlock = adminDetailTabs.slice(
    adminDetailTabs.indexOf('nextRequiredAction === "Subscription expired — renewal required"'),
    adminDetailTabs.indexOf('nextRequiredAction === "Activate Application"'),
  );
  assert.doesNotMatch(expiredActionBlock, /Confirm Payment/);
  assert.doesNotMatch(expiredActionBlock, /Create Initial Payment/);
});

test("admin application detail keeps valid active paid subscriptions eligible for explicit activation", () => {
  assert.match(adminDetailPage, /currentSubscription\?\.hasActiveSubscription \? "complete"/);
  assert.match(adminDetailPage, /subscriptionReadinessState === "complete" && canActivateApplication \? "Activate Application"/);
  assert.match(adminDetailTabs, /nextRequiredAction === "Activate Application"/);
  assert.match(adminDetailTabs, /Activate Application/);
});

test("admin application detail places business areas in their tab homes", () => {
  assert.match(adminDetailTabs, /<TabsContent value="overview"/);
  assert.match(adminDetailTabs, /<TabsContent value="application"/);
  assert.match(adminDetailTabs, /<TabsContent value="enrollment"/);
  assert.match(adminDetailTabs, /<TabsContent value="payments"/);
  assert.match(adminDetailTabs, /<TabsContent value="cancellation"/);
  assert.match(adminDetailTabs, /<TabsContent value="activity"/);
  assert.match(adminDetailTabs, /<Section title="Next Required Action">/);
  assert.match(adminDetailTabs, /<Section title="Payment Actions">/);
  assert.match(adminDetailTabs, /<Section title="Payment Cycle History">/);
  assert.match(adminDetailTabs, /<Section title="Event History">/);
});

test("admin application detail keeps activation explicit and localized to Enrollment", () => {
  const confirmPaymentBlock = adminDetailPage.slice(
    adminDetailPage.indexOf("const confirmPaymentMutation"),
    adminDetailPage.indexOf("async function handleExportPdf"),
  );
  assert.match(adminDetailTabs, /<TabsContent value="enrollment"/);
  assert.match(adminDetailTabs, /<Section title="Activation">/);
  assert.match(adminDetailTabs, /statusMutation\.mutate\(\{ status: "active"/);
  assert.match(adminDetailTabs, /Activation remains explicit and uses the existing backend gate/);
  assert.doesNotMatch(confirmPaymentBlock, /status: "active"/);
});

test("admin application detail keeps cancellation and refund actions in the cancellation tab", () => {
  assert.match(adminDetailTabs, /<TabsContent value="cancellation"/);
  assert.match(adminDetailSource, /Danger Zone/);
  assert.match(adminDetailSource, /Cancel Application/);
  assert.match(adminDetailSource, /Cancel Program/);
  assert.match(adminDetailTabs, /<Section title="Cancellation & Refunds">/);
});

test("old extend subscription endpoint is removed and replaced with one canonical expiry-adjustment route", () => {
  assert.doesNotMatch(adminPaymentsRoute, /payments\/:id\/extend/);
  assert.doesNotMatch(adminPaymentsRoute, /ExtendSubscriptionBody/);
  assert.match(adminPaymentsRoute, /applications\/:applicationId\/subscription\/expiry/);
  assert.match(adminPaymentsRoute, /BALLET_NO_ADJUSTABLE_SUBSCRIPTION/);
  assert.match(adminPaymentsRoute, /adjustmentMethod/);
  assert.match(adminPaymentsRoute, /extensionHistory: \[\.\.\.history, historyEntry/);
  assert.match(adminPaymentsRoute, /logActivityWithActor\(tx, adminActivityActor\(req\)/);
});

test("renewal creation is pending-only and ignores client paid state/dates", () => {
  assert.match(adminPaymentsRoute, /status: "pending"/);
  assert.match(adminPaymentsRoute, /subscriptionStartDate: null/);
  assert.match(adminPaymentsRoute, /subscriptionExpiresAt: null/);
  assert.match(adminPaymentsRoute, /paidAt: null/);
  assert.match(adminPaymentsRoute, /amountEgp: pkg\.priceEgp/);
  assert.doesNotMatch(adminPaymentsRoute, /status === "paid" \? startDate : null/);
});

test("payment confirmation is the only supported payment status action and requires a pending row", () => {
  assert.match(adminPaymentsRoute, /BALLET_PAYMENT_STATUS_ACTION_NOT_SUPPORTED/);
  assert.match(adminPaymentsRoute, /BALLET_PAYMENT_NOT_PENDING/);
  assert.match(adminPaymentsRoute, /\.for\("update"\)/);
  assert.match(adminPaymentsRoute, /status: "paid"/);
  assert.match(adminPaymentsRoute, /paidAt: now/);
});

test("pending renewal uniqueness is enforced in schema and migration", () => {
  assert.match(balletPaymentsSchema, /ballet_payments_open_pending_renewal_idx/);
  assert.match(balletPaymentsSchema, /status.*'pending'/);
  assert.match(pendingRenewalMigration, /CREATE UNIQUE INDEX IF NOT EXISTS "ballet_payments_open_pending_renewal_idx"/);
  assert.match(pendingRenewalMigration, /"is_renewal" = true/);
  assert.match(pendingRenewalMigration, /"status" = 'pending'/);
});

test("Ballet Payments page owns pending renewal and confirmation actions only", () => {
  assert.match(adminPaymentsPage, /Create Pending Renewal/);
  assert.match(adminPaymentsPage, /Confirm Paid/);
  assert.match(adminPaymentsPage, /status: "paid"/);
  assert.match(adminPaymentsPage, /payment\.status === "pending"/);
  assert.doesNotMatch(adminPaymentsPage, /Extend Subscription/);
  assert.doesNotMatch(adminPaymentsPage, /paymentStatus.*refunded|status: "refunded"/);
});

test("mobile Danger Zone uses backend refund eligibility instead of duplicating payment/date rules", () => {
  assert.match(dangerZone, /detail\?\.eligibleRefund\?\.eligible === true/);
  assert.doesNotMatch(dangerZone, /payment\.status === "paid"/);
  assert.doesNotMatch(dangerZone, /payment\.paymentMethod === "inPerson"/);
});
