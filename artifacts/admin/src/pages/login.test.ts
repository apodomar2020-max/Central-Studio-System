import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./login.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./login.css", import.meta.url), "utf8");

test("login uses the Central Studio brand, supplied group photo, and operational feature list", () => {
  assert.match(page, /"\/logo-central-studio\.png"/);
  assert.match(page, /src="\/central-studio-group\.jpg"/);
  assert.match(page, /Studio[\s\S]*Management[\s\S]*Made Simple\./);
  for (const label of ["Classes", "Students", "Instructors", "Reports"]) {
    assert.match(page, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(page, /<video|cloudinary\.com/);
});

test("password visibility remains an accessible button backed by Lucide icons", () => {
  assert.match(page, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(page, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
  assert.match(page, /showPassword \? <EyeOff[^>]*> : <Eye[^>]*>/);
});

test("login shares the persisted Admin theme and keeps a full-page photograph on mobile", () => {
  assert.match(page, /useAdminTheme/);
  assert.match(page, /onClick=\{toggleTheme\}/);
  assert.match(styles, /min-height: 100dvh/);
  assert.match(styles, /\.admin-login-photo \{[^}]*inset: 0/);
  assert.match(styles, /data-login-theme="light"/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(styles, /\.admin-login-photo[^}]*display: none/);
});

test("the card exposes visible focus, disabled, loading, and error treatments", () => {
  assert.match(styles, /\.admin-login-field:focus-within/);
  assert.match(styles, /\.admin-login-password-toggle:focus-visible/);
  assert.match(styles, /\.admin-login-submit:focus-visible/);
  assert.match(styles, /\.admin-login-submit:disabled/);
  assert.match(styles, /\.admin-login-submit\[aria-busy="true"\]/);
  assert.match(styles, /\.admin-login-feedback[^}]*color: var\(--login-error\)/);
});

test("sign-in logic still submits through AdminAuthContext", () => {
  assert.match(page, /await login\(username\.trim\(\)\.toLowerCase\(\), password\)/);
  assert.match(page, /<form className="admin-login-form" onSubmit=\{handleSubmit\}/);
  assert.match(page, /type="submit"/);
  assert.match(page, /className="admin-login-submit"/);
  assert.match(page, /disabled=\{!canSubmit\}/);
  assert.match(page, /aria-busy=\{loading\}/);
  assert.match(page, /autoComplete="username"/);
  assert.match(page, /autoComplete="current-password"/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /admin-login-submit\$\{username/);
});
