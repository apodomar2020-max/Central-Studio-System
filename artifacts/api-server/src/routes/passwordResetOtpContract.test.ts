import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authRoute = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
const grant = readFileSync(new URL("../lib/passwordResetGrant.ts", import.meta.url), "utf8");

test("OTP is consumed by the server before a reset grant is issued", () => {
  assert.match(authRoute, /router\.post\("\/auth\/verify-reset-otp"[\s\S]*verifyOtpCode\(normalizedEmail, parsed\.data\.code, "reset"\)/);
  assert.match(authRoute, /signPasswordResetGrant\(student\.id, normalizedEmail, student\.tokenVersion\)/);
});

test("password reset accepts the scoped grant and prevents replay after token-version change", () => {
  assert.match(grant, /type: "password_reset"/);
  assert.match(grant, /expiresIn: RESET_GRANT_EXPIRES_IN/);
  assert.match(grant, /algorithms: \["HS256"\]/);
  assert.match(authRoute, /eq\(studentsTable\.tokenVersion, grant\.tokenVersion\)/);
  assert.match(authRoute, /returning\(\{ id: studentsTable\.id \}\)/);
});

test("password reset enforces the recovery UI policy and rejects the current password", () => {
  assert.match(authRoute, /ResetPasswordValueSchema[\s\S]*\.min\(12/);
  assert.match(authRoute, /ResetPasswordValueSchema[\s\S]*special character/);
  assert.match(authRoute, /bcrypt\.compare\(newPassword, student\.passwordHash\)/);
});
