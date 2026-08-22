/**
 * Student Account Lifecycle — Phase B1C.
 *
 * `deriveAuthErrorMessage` is the exact pure function login.tsx,
 * useGoogleSignIn.ts, and useFacebookSignIn.ts each call on a failed
 * POST /api/auth/{login,google,facebook} response — these three "fresh auth
 * attempt" call sites predate customFetch and parse `fetch` responses
 * directly, so they have no session to tear down and don't go through
 * custom-fetch.ts's centralized handler. This file proves the shared logic
 * itself is correct; the three call sites are read-verified to call it with
 * their own fallback copy (see the login.tsx / useGoogleSignIn.ts /
 * useFacebookSignIn.ts diffs).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_DEACTIVATED_MESSAGE, deriveAuthErrorMessage } from "./accountDeactivation";

test("ACCOUNT_DEACTIVATED code overrides any error string with the fixed, non-technical copy", () => {
  const message = deriveAuthErrorMessage(
    { code: "ACCOUNT_DEACTIVATED", error: "some raw backend string" },
    "Login failed. Please try again.",
  );
  assert.equal(message, ACCOUNT_DEACTIVATED_MESSAGE);
});

test("a normal wrong-password rejection is never shown as the deactivation message", () => {
  const message = deriveAuthErrorMessage(
    { error: "Invalid email or password." },
    "Login failed. Please try again.",
  );
  assert.equal(message, "Invalid email or password.");
  assert.notEqual(message, ACCOUNT_DEACTIVATED_MESSAGE);
});

test("a response with neither code nor error falls back to the caller-supplied generic message", () => {
  assert.equal(deriveAuthErrorMessage(null, "Login failed. Please try again."), "Login failed. Please try again.");
  assert.equal(deriveAuthErrorMessage(undefined, "Google sign-in failed. Please try again."), "Google sign-in failed. Please try again.");
  assert.equal(deriveAuthErrorMessage({}, "Facebook sign-in failed. Please try again."), "Facebook sign-in failed. Please try again.");
});

test("an unrelated code string does not trigger the deactivation copy", () => {
  const message = deriveAuthErrorMessage(
    { code: "SOME_OTHER_CODE", error: "Something else went wrong." },
    "Login failed. Please try again.",
  );
  assert.equal(message, "Something else went wrong.");
});

test("all three fallback copies used at the real call sites are distinct from the deactivation copy", () => {
  // Guards against a future edit accidentally making one of the generic
  // per-provider fallbacks equal to the deactivation copy, which would make
  // this test suite's "distinct message" assertions meaningless.
  const fallbacks = [
    "Login failed. Please try again.",
    "Google sign-in failed. Please try again.",
    "Facebook sign-in failed. Please try again.",
  ];
  for (const fallback of fallbacks) {
    assert.notEqual(fallback, ACCOUNT_DEACTIVATED_MESSAGE);
  }
});
