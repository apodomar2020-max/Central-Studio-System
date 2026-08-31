/**
 * Regression guard for the Admin Vercel security headers
 * (artifacts/admin/vercel.json, documented in SECURITY_HEADERS.md).
 *
 * commit 7db0154 ("feat(admin): harden session and browser security")
 * introduced `Permissions-Policy: camera=(), ...` — an empty allowlist that
 * disables the `camera` feature for every origin, including `self`. That
 * broke the Attendance workspace's QR scanner: navigator.mediaDevices.
 * getUserMedia() rejects with NotAllowedError before any normal browser
 * permission prompt/flow can run, and no user-facing "Retry" can recover
 * from a platform-level policy block. Fixed by scoping camera to `self`
 * while leaving every other restricted feature untouched.
 *
 * vercel.json is a plain JSON config file, not an importable module — this
 * follows the repo's established source/config-assertion convention (see
 * artifacts/api-server/src/routes/bookingPriceBinding.test.ts) rather than
 * spinning up an HTTP server just to inspect response headers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const VERCEL_CONFIG_PATH = "artifacts/admin/vercel.json";

function readPermissionsPolicy(): string {
  const raw = readFileSync(resolve(process.cwd(), VERCEL_CONFIG_PATH), "utf8");
  const config = JSON.parse(raw) as {
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const catchAll = config.headers?.find((entry) => entry.source === "/(.*)")
    ?? config.headers?.find((entry) => entry.headers.some((h) => h.key === "Permissions-Policy"));
  assert.ok(catchAll, "expected a headers entry covering all routes");
  const permissionsPolicy = catchAll.headers.find((h) => h.key === "Permissions-Policy")?.value;
  assert.ok(permissionsPolicy, "expected a Permissions-Policy header to be set");
  return permissionsPolicy;
}

test("Admin Permissions-Policy allows camera for same-origin use (Attendance QR scanner)", () => {
  const policy = readPermissionsPolicy();

  // This is the exact regression this test exists to catch: an empty
  // camera allowlist blocks getUserMedia() with NotAllowedError before any
  // browser permission prompt, and no amount of user "Retry" can recover
  // from it — only the header itself can fix it.
  assert.doesNotMatch(
    policy,
    /camera=\(\)/,
    "camera must not be a blanket-denied (empty-allowlist) feature — it breaks Attendance QR scanning for every visitor",
  );
  assert.match(
    policy,
    /camera=\(self\)/,
    "camera must be explicitly scoped to same-origin use, not left unset or opened beyond self",
  );
});

test("every other previously-restricted feature remains denied — this is a surgical, not a broad, loosening", () => {
  const policy = readPermissionsPolicy();

  assert.match(policy, /microphone=\(\)/, "microphone must remain denied");
  assert.match(policy, /geolocation=\(\)/, "geolocation must remain denied");
  assert.match(policy, /payment=\(\)/, "payment must remain denied");
  assert.match(policy, /usb=\(\)/, "usb must remain denied");
  assert.match(policy, /interest-cohort=\(\)/, "interest-cohort (FLoC) must remain denied");
});

test("the surrounding browser-hardening headers from the same wave are unaffected", () => {
  const raw = readFileSync(resolve(process.cwd(), VERCEL_CONFIG_PATH), "utf8");
  const config = JSON.parse(raw) as {
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const catchAll = config.headers?.find((entry) => entry.source === "/(.*)");
  assert.ok(catchAll, "expected a headers entry covering all routes");
  const byKey = new Map(catchAll.headers.map((h) => [h.key, h.value]));

  assert.ok(byKey.get("Content-Security-Policy")?.includes("default-src 'self'"), "CSP must remain enforced");
  assert.equal(byKey.get("Strict-Transport-Security"), "max-age=15552000", "HSTS must be unchanged");
  assert.equal(byKey.get("Cross-Origin-Opener-Policy"), "same-origin", "COOP must be unchanged");
  assert.equal(byKey.get("Cross-Origin-Resource-Policy"), "same-site", "CORP must be unchanged");
  assert.equal(byKey.get("X-Frame-Options"), "DENY", "X-Frame-Options must be unchanged");
  assert.equal(byKey.get("X-Content-Type-Options"), "nosniff", "X-Content-Type-Options must be unchanged");
});
