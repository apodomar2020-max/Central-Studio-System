import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const dangerZone = read("artifacts/central/components/ballet/BalletProgramDangerZone.tsx");
const programScreen = read("artifacts/central/app/ballet/index.tsx");
const adminDetailPage = read("artifacts/admin/src/pages/ballet/ApplicationDetailPage.tsx");
const cancellationListPage = read("artifacts/admin/src/pages/ballet/BalletCancellationRequestsPage.tsx");

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

test("mobile refund option is shown only for an eligible paid inPerson payment, with no amount input", () => {
  assert.match(dangerZone, /payment\.status === "paid" &&\s*\n?\s*payment\.paymentMethod === "inPerson"/);
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
  assert.match(adminDetailPage, /Danger Zone/);
  assert.match(adminDetailPage, /border-red-500\/40/);
  assert.match(adminDetailPage, /AlertTriangle/);
});

test("admin Danger Zone is gated on ballet.applications cancel and derives the shared action", () => {
  assert.match(adminDetailPage, /const canCancel = can\("ballet\.applications", "cancel"\)/);
  assert.match(adminDetailPage, /resolveBalletDangerAction\(\{[\s\S]*?viewer: "admin"/);
  assert.match(adminDetailPage, /\{canCancel && \(/);
});

test("admin pre-activation Cancel Application calls the existing admin cancel transaction", () => {
  assert.match(adminDetailPage, /applications\/\$\{appId\}\/cancel/);
  assert.match(adminDetailPage, /Cancel Application/);
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
  assert.match(adminDetailPage, /Manage Cancellation Request/);
  assert.match(adminDetailPage, /dangerAction\.kind === "viewCancellationRequest"/);
});

test("admin reason requires min 5 characters before submit is enabled", () => {
  assert.match(adminDetailPage, /cancelReason\.trim\(\)\.length < 5/);
});

test("admin cancellation mutations refetch (invalidate) server state on success", () => {
  assert.match(adminDetailPage, /queryClient\.invalidateQueries\(\{ queryKey: \["ballet-cancellation-requests"\] \}\)/);
});

// ─── Initiator attribution surfaced in admin UI (spec §6) ────────────────────────

test("admin detail page attributes each cancellation request to Parent or the Admin name", () => {
  assert.match(adminDetailPage, /Initiated by:/);
  assert.match(adminDetailPage, /request\.initiatedByType === "admin"/);
});

test("admin cancellation list page shows an Initiated By column", () => {
  assert.match(cancellationListPage, /<TableHead>Initiated By<\/TableHead>/);
  assert.match(cancellationListPage, /row\.initiatedByType === "admin" \? \(row\.initiatedByAdminName/);
});
