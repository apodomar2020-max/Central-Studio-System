/**
 * Wave 3.1 (Gap 3) — pending-payment package customer self-cancellation.
 *
 * Confirms:
 *   1. AppContext.cancelPackage now calls the real student self-cancel
 *      route (PATCH /package-orders/:id/cancel), not the admin-only bare
 *      PATCH /package-orders/:id that a student JWT could never reach —
 *      the pre-existing bug this correction fixes.
 *   2. cancelPackage no longer silently swallows a failed cancellation.
 *   3. Package Center only ever offers Cancel on the pendingRequests list
 *      (pendingPayment) — never on the active/past lists, and never on
 *      rejectedRequests (already terminal).
 *
 * package-center.tsx / AppContext.tsx are Expo Router / React Context
 * files (JSX, react-native imports) that cannot be imported into a plain
 * Node test process — this follows the repo's established source-assertion
 * convention (see bookingCancellationConsistency.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const CONTEXT = "artifacts/central/contexts/AppContext.tsx";
const SCREEN = "artifacts/central/app/package-center.tsx";
const contextSource = readFileSync(resolve(process.cwd(), CONTEXT), "utf8");
const screenSource = readFileSync(resolve(process.cwd(), SCREEN), "utf8");

test("cancelPackage calls the real student self-cancel route, not the admin-only bare PATCH", () => {
  assert.match(contextSource, /await customFetch\(`\/api\/package-orders\/\$\{userPackageId\}\/cancel`, \{ method: "PATCH" \}\);/);
  assert.equal(/status: "cancelled"/.test(contextSource), false, "must never PATCH status:\"cancelled\" directly — that is the admin-only bare-cancel path");
});

test("cancelPackage no longer swallows a failed cancellation silently", () => {
  const start = contextSource.indexOf("const cancelPackage = useCallback");
  const end = contextSource.indexOf("}, []);", start);
  const body = contextSource.slice(start, end);
  assert.equal(/catch/.test(body), false, "cancelPackage must let a failed cancellation propagate to its caller, not swallow it");
});

test("Cancel Request is offered only on the pendingRequests list", () => {
  assert.match(screenSource, /onCancel=\{\(\) => confirmCancelPackage\(pkg\)\}/);
  const pendingBlockStart = screenSource.indexOf("{pendingRequests.map(");
  const pendingBlockEnd = screenSource.indexOf("))}", pendingBlockStart);
  const pendingBlock = screenSource.slice(pendingBlockStart, pendingBlockEnd);
  assert.match(pendingBlock, /onCancel=/);
});

test("the rejected/history and active/past lists never receive onCancel — only pendingRequests does", () => {
  const rejectedBlockStart = screenSource.indexOf("{rejectedRequests.map(");
  const rejectedBlockEnd = screenSource.indexOf(")}", rejectedBlockStart);
  const rejectedBlock = screenSource.slice(rejectedBlockStart, rejectedBlockEnd);
  assert.equal(/onCancel=/.test(rejectedBlock), false);

  const listBlockStart = screenSource.indexOf("{list.map(");
  const listBlockEnd = screenSource.indexOf(")}", listBlockStart);
  const listBlock = screenSource.slice(listBlockStart, listBlockEnd);
  assert.equal(/onCancel=/.test(listBlock), false, "the Active/Past tab list (active or paid packages) must never render a self-cancel action");
});

test("PackageCard only renders the Cancel affordance when onCancel is actually supplied", () => {
  assert.match(screenSource, /\{onCancel && \(/);
});

test("cancellation goes through the existing useCentralAlert confirmation pattern, not a bespoke dialog", () => {
  assert.match(screenSource, /import \{ useCentralAlert \} from "@\/hooks\/useCentralAlert";/);
  assert.match(screenSource, /const alert = useCentralAlert\(\);/);
  assert.match(screenSource, /alert\.show\(\{/);
});
