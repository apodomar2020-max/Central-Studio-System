import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const changePassword = readFileSync(new URL("../../app/change-password.tsx", import.meta.url), "utf8");
const forgotPassword = readFileSync(new URL("../../app/auth/forgot-password.tsx", import.meta.url), "utf8");
const otpVerification = readFileSync(new URL("../../app/auth/otp-verification.tsx", import.meta.url), "utf8");
const resetPassword = readFileSync(new URL("../../app/auth/reset-password.tsx", import.meta.url), "utf8");
const artwork = new URL("../../assets/images/enter-otp-amico.svg", import.meta.url);
const otpArtwork = new URL("../../assets/images/my-password-pana.svg", import.meta.url);

test("all forgot-password callers include a verified bot token", () => {
  for (const source of [changePassword, forgotPassword, otpVerification]) {
    assert.match(source, /buildForgotPasswordPayload\([^,]+,\s*[^)]+BotToken|buildForgotPasswordPayload\([^,]+,\s*botToken\)/i);
    assert.match(source, /<BotChallenge action="forgot_password"/);
  }
});

test("the supplied OTP illustration is bundled into both recovery entry screens", () => {
  assert.equal(existsSync(artwork), true);
  assert.match(changePassword, /enter-otp-amico\.svg/);
  assert.match(forgotPassword, /enter-otp-amico\.svg/);
});

test("OTP entry and new-password entry remain separate responsive steps", () => {
  assert.equal(existsSync(otpArtwork), true);
  assert.match(otpVerification, /OTP VERIFICATION/);
  assert.match(resetPassword, /RESET PASSWORD/);
  assert.match(otpVerification, /Array\.from\(\{ length: 6 \}/);
  assert.match(otpVerification, /customFetch<\{ resetToken: string \}>\("\/api\/auth\/verify-reset-otp"/);
  assert.match(otpVerification, /storePasswordResetGrant\(\{ email: targetEmail, resetToken: result\.resetToken \}\)/);
  assert.match(otpVerification, /pushOnce\("\/auth\/reset-password"\)/);
  assert.match(resetPassword, /buildResetPasswordWithGrantPayload\(resetGrant\.email, resetGrant\.resetToken, newPassword\)/);
});

test("both send-code entry points navigate to the real OTP route", () => {
  assert.match(changePassword, /pathname: "\/auth\/otp-verification"/);
  assert.match(forgotPassword, /pathname: "\/auth\/otp-verification"/);
});

test("public password-recovery calls never attach the current student session", () => {
  for (const source of [changePassword, forgotPassword, otpVerification, resetPassword]) {
    assert.match(source, /auth: "omit"/);
  }
  assert.match(otpVerification, /verifyResetOtpErrorOutcome\(apiError\)\.message/);
  assert.doesNotMatch(otpVerification, /setError\(message \|\|/);
});
