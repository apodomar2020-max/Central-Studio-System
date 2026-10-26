import assert from "node:assert/strict";
import test from "node:test";
import { nativeAuthError } from "./nativeAuthErrors";

test("native admission errors remain generic and cover offline, session and provider failures", () => {
  assert.match(nativeAuthError(new Error("private network details")).message, /Network error/);
  for (const status of [401, 403]) assert.match(nativeAuthError({ status }).message, /sign in again/);
  assert.match(nativeAuthError({ status: 503 }).message, /temporarily unavailable/);
  for (const status of [400, 429, 500]) {
    const outcome = nativeAuthError({ status, data: { error: "internal admission policy", retryAfterSeconds: 60 } });
    assert.doesNotMatch(outcome.message, /internal|admission|bot|Turnstile/);
    assert.equal(outcome.retryAfter, 60);
  }
});

test("cooldown accepts either contract field, rounds up, and rejects unsafe values", () => {
  assert.equal(nativeAuthError({ status: 429, data: { retryAfter: 12.2 } }).retryAfter, 13);
  assert.equal(nativeAuthError({ status: 429, data: { retryAfterSeconds: 10, retryAfter: 20 } }).retryAfter, 10);
  for (const retryAfter of [-1, 0, Infinity, NaN, "60", null]) {
    assert.equal(nativeAuthError({ status: 429, data: { retryAfter } }).retryAfter, 0);
  }
});
