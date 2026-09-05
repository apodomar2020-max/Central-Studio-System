import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAccountTypeChangePolicy } from "./accountTypeChangePolicy";

test("account type remains editable without dependent activity", () => {
  assert.deepEqual(evaluateAccountTypeChangePolicy({
    hasChildClassBooking: false,
    hasBalletApplication: false,
  }), { locked: false, reasons: [], message: null });
});

test("a child class booking permanently locks account-type changes", () => {
  const policy = evaluateAccountTypeChangePolicy({
    hasChildClassBooking: true,
    hasBalletApplication: false,
  });
  assert.equal(policy.locked, true);
  assert.deepEqual(policy.reasons, ["child_class_booking"]);
});

test("any ballet application permanently locks account-type changes", () => {
  const policy = evaluateAccountTypeChangePolicy({
    hasChildClassBooking: false,
    hasBalletApplication: true,
  });
  assert.equal(policy.locked, true);
  assert.deepEqual(policy.reasons, ["ballet_application"]);
});

test("both lock reasons are returned when both types of dependent activity exist", () => {
  const policy = evaluateAccountTypeChangePolicy({
    hasChildClassBooking: true,
    hasBalletApplication: true,
  });
  assert.deepEqual(policy.reasons, ["child_class_booking", "ballet_application"]);
});
