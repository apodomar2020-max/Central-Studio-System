/**
 * Wave 3.1 (Gap 3) — pending-payment package customer self-cancellation.
 *
 * Confirms:
 *   1. AppContext.cancelPackage now calls the real student self-cancel
 *      route (PATCH /package-orders/:id/cancel), not the admin-only bare
 *      PATCH /package-orders/:id that a student JWT could never reach —
 *      the pre-existing bug this correction fixes.
 *   2. cancelPackage no longer silently swallows a failed cancellation.
 *   3. Package Center disables removal for active packages, cancels pending
 *      requests through the backend, and only hides expired/history packages
 *      from this device without deleting studio records.
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

test("active packages are protected from the status-card removal action", () => {
  assert.match(screenSource, /if \(kind === "active"\) return;/);
  assert.match(screenSource, /disabled=\{cancelling \|\| kind === "active"\}/);
});

test("expired packages are hidden locally and not cancelled in the backend", () => {
  const expiredStart = screenSource.indexOf('if (kind === "expired")');
  const expiredEnd = screenSource.indexOf("return;", expiredStart);
  const expiredBlock = screenSource.slice(expiredStart, expiredEnd);
  assert.match(expiredBlock, /hidePackageLocally\(String\(pkg\.id\)\)/);
  assert.doesNotMatch(expiredBlock, /cancelPackage/);
});

test("pending packages use the real cancellation operation before being hidden locally", () => {
  assert.match(screenSource, /await cancelPackage\(String\(pkg\.id\)\);\s*await hidePackageLocally\(String\(pkg\.id\)\);/);
});

test("cancellation goes through the existing useCentralAlert confirmation pattern, not a bespoke dialog", () => {
  assert.match(screenSource, /import \{ useCentralAlert \} from "@\/hooks\/useCentralAlert";/);
  assert.match(screenSource, /const alert = useCentralAlert\(\);/);
  assert.match(screenSource, /alert\.show\(\{/);
});
