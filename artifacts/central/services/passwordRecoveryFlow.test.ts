import assert from "node:assert/strict";
import test from "node:test";
import {
  forgotPasswordOutcome,
  resetPasswordOutcome,
  changePasswordOutcome,
  buildResetPasswordPayload,
  buildChangePasswordPayload,
  maskEmail,
  persistChangePasswordToken,
} from "./passwordRecoveryFlow";

// ─── Forgot Password: no account-existence branching ────────────────────────

test("forgotPasswordOutcome always continues to reset — it takes no response body to branch on", () => {
  // The function's signature itself takes no parameters: there is nothing
  // for it to branch on, which is the whole point. Calling it repeatedly
  // (simulating an "account exists" request and a "nonexistent account"
  // request, both of which produce the same generic backend response)
  // proves the client cannot distinguish the two cases.
  assert.deepEqual(forgotPasswordOutcome(), { action: "continue-to-reset" });
  assert.deepEqual(forgotPasswordOutcome(), forgotPasswordOutcome());
});

// ─── Reset Password: request shape ───────────────────────────────────────────

test("buildResetPasswordPayload sends exactly {email, code, newPassword} — no studentId", () => {
  const payload = buildResetPasswordPayload(" user@example.com ", " 123456 ", "Password123");
  assert.deepEqual(payload, { email: "user@example.com", code: "123456", newPassword: "Password123" });
  assert.equal("studentId" in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), ["code", "email", "newPassword"]);
});

// ─── Reset Password: outcome mapping ─────────────────────────────────────────

test("resetPasswordOutcome: null error means success", () => {
  assert.deepEqual(resetPasswordOutcome(null), { kind: "success" });
});

test("resetPasswordOutcome: 429 maps to locked with the lockout message", () => {
  const outcome = resetPasswordOutcome({ status: 429, data: { error: "Too many incorrect attempts. Please request a new code." } });
  assert.deepEqual(outcome, { kind: "locked", message: "Too many incorrect attempts. Please request a new code." });
});

test("resetPasswordOutcome: generic 400 maps to error with the backend's message", () => {
  const outcome = resetPasswordOutcome({ status: 400, data: { error: "Invalid or expired code. Please request a new one." } });
  assert.deepEqual(outcome, { kind: "error", message: "Invalid or expired code. Please request a new one." });
});

test("resetPasswordOutcome: missing/malformed data falls back to a safe generic message", () => {
  assert.deepEqual(resetPasswordOutcome({ status: 400, data: undefined }), { kind: "error", message: "Reset failed. Please try again." });
  assert.deepEqual(resetPasswordOutcome({ status: 500, data: "not an object" }), { kind: "error", message: "Reset failed. Please try again." });
});

// ─── Change Password: request shape ──────────────────────────────────────────

test("buildChangePasswordPayload sends exactly {currentPassword, newPassword} — no identity field", () => {
  const payload = buildChangePasswordPayload("oldpass1", "NewPass123");
  assert.deepEqual(payload, { currentPassword: "oldpass1", newPassword: "NewPass123" });
  assert.deepEqual(Object.keys(payload).sort(), ["currentPassword", "newPassword"]);
});

// ─── Change Password: a failure must never map to success ───────────────────

test("changePasswordOutcome: null error means success", () => {
  assert.deepEqual(changePasswordOutcome(null), { kind: "success" });
});

test("changePasswordOutcome: wrong current password never maps to success", () => {
  const outcome = changePasswordOutcome({ status: 400, data: { error: "Current password is incorrect." } });
  assert.equal(outcome.kind, "error");
  assert.deepEqual(outcome, { kind: "error", message: "Current password is incorrect." });
});

test("changePasswordOutcome: password-reuse rejection never maps to success", () => {
  const outcome = changePasswordOutcome({ status: 400, data: { error: "New password must be different from your current password." } });
  assert.equal(outcome.kind, "error");
  assert.deepEqual(outcome, { kind: "error", message: "New password must be different from your current password." });
});

test("changePasswordOutcome: any error object, however malformed, never maps to success", () => {
  for (const errorLike of [{}, { status: 500 }, { data: null }, { status: 401, data: {} }]) {
    const outcome = changePasswordOutcome(errorLike);
    assert.notEqual(outcome.kind, "success");
  }
});

// ─── maskEmail: display-only masking for the authenticated recovery UI ──────

test("maskEmail: normal email masks correctly", () => {
  assert.equal(maskEmail("user@example.com"), "u***@example.com");
});

test("maskEmail: one-character local part", () => {
  assert.equal(maskEmail("a@example.com"), "a***@example.com");
});

test("maskEmail: short local part", () => {
  assert.equal(maskEmail("ab@example.com"), "a***@example.com");
});

test("maskEmail: longer local part — mask length never reveals real length", () => {
  const masked = maskEmail("alexander.hamilton@example.com");
  assert.equal(masked, "a***@example.com");
  // Same fixed-length mask regardless of the real local part being 2 vs 18
  // characters — proves no length leakage.
  assert.equal(masked.split("@")[0]!.length, maskEmail("ab@example.com").split("@")[0]!.length);
});

test("maskEmail: empty input is handled safely, never throws", () => {
  assert.doesNotThrow(() => maskEmail(""));
  assert.equal(maskEmail(""), "your email");
});

test("maskEmail: malformed input is handled safely, never throws", () => {
  for (const malformed of ["not-an-email", "@example.com", "user@", "   ", "@"]) {
    assert.doesNotThrow(() => maskEmail(malformed));
    assert.equal(maskEmail(malformed), "your email");
  }
});

test("maskEmail: domain remains intact and identifiable while the local part stays masked", () => {
  const masked = maskEmail("test@centralstudioco.com");
  assert.ok(masked.endsWith("@centralstudioco.com"));
  assert.ok(!masked.startsWith("test"), "the real local part must not appear in the masked output");
});

// ─── Security-02B (CS-SEC-H-03): change-password replacement token ──────────

test("persistChangePasswordToken: stores the token and reports it persisted, when present", async () => {
  const stored: Record<string, string> = {};
  const storage = { setItem: async (key: string, value: string) => { stored[key] = value; } };

  const didPersist = await persistChangePasswordToken({ accessToken: "fresh.jwt.token" }, storage);

  assert.equal(didPersist, true);
  assert.equal(stored["studentToken"], "fresh.jwt.token");
});

test("persistChangePasswordToken: no-ops and reports false when the server omits accessToken (older build)", async () => {
  let setItemCalls = 0;
  const storage = { setItem: async () => { setItemCalls += 1; } };

  const didPersist = await persistChangePasswordToken({}, storage);

  assert.equal(didPersist, false);
  assert.equal(setItemCalls, 0, "must not touch storage at all when there is nothing to persist");
});

test("persistChangePasswordToken: an empty-string accessToken is treated as absent", async () => {
  let setItemCalls = 0;
  const storage = { setItem: async () => { setItemCalls += 1; } };

  const didPersist = await persistChangePasswordToken({ accessToken: "" }, storage);

  assert.equal(didPersist, false);
  assert.equal(setItemCalls, 0);
});
