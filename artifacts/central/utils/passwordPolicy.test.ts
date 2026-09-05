import assert from "node:assert/strict";
import test from "node:test";
import { passwordPolicyError, PASSWORD_MIN_LENGTH, resetPasswordPolicyError } from "./passwordPolicy";

test("fewer than 8 characters is invalid", () => {
  assert.match(passwordPolicyError("Ab1")!, /at least 8 characters/);
});

test("no letter is invalid", () => {
  assert.match(passwordPolicyError("12345678")!, /at least one letter/);
});

test("no number is invalid", () => {
  assert.match(passwordPolicyError("Abcdefgh")!, /at least one number/);
});

test("length + letter + number passes", () => {
  assert.equal(passwordPolicyError("Abcdef12"), null);
  assert.equal(passwordPolicyError("Password123"), null);
});

test("boundary: exactly PASSWORD_MIN_LENGTH with letter+number passes", () => {
  const boundary = "a1".padEnd(PASSWORD_MIN_LENGTH, "a");
  assert.equal(boundary.length, PASSWORD_MIN_LENGTH);
  assert.equal(passwordPolicyError(boundary), null);
});

test("boundary: one under PASSWORD_MIN_LENGTH fails even with letter+number", () => {
  const tooShort = "a1".padEnd(PASSWORD_MIN_LENGTH - 1, "a");
  assert.equal(tooShort.length, PASSWORD_MIN_LENGTH - 1);
  assert.match(passwordPolicyError(tooShort)!, /at least 8 characters/);
});

test("password recovery reset enforces the requirements shown on screen", () => {
  assert.match(resetPasswordPolicyError("Short1!")!, /at least 12 characters/);
  assert.match(resetPasswordPolicyError("12345678901!")!, /at least one letter/);
  assert.match(resetPasswordPolicyError("LongPassword!")!, /at least one number/);
  assert.match(resetPasswordPolicyError("LongPassword1")!, /special character/);
  assert.equal(resetPasswordPolicyError("LongPassword1!"), null);
});
