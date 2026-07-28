import assert from "node:assert/strict";
import { test } from "node:test";
import { getBookingErrorMessage } from "./bookingErrorMessages";

test("participant eligibility failures receive specific safe guidance", () => {
  assert.match(getBookingErrorMessage("DOB_REQUIRED")!.message, /date of birth/i);
  assert.match(getBookingErrorMessage("AGE_BELOW_MINIMUM")!.message, /older age range/i);
  assert.match(getBookingErrorMessage("AGE_ABOVE_MAXIMUM")!.message, /younger age range/i);
});

test("package usability failures preserve the existing Pay at Studio alternative", () => {
  for (const code of [
    "PACKAGE_PARTICIPANT_MISMATCH",
    "PACKAGE_EXPIRED",
    "PACKAGE_DANCE_TYPE_MISMATCH",
    "PACKAGE_NO_CREDITS",
  ]) {
    assert.match(getBookingErrorMessage(code)!.message, /Pay at Studio/i, code);
  }
});

test("integrity, capacity, and occurrence failures receive safe messages", () => {
  assert.ok(getBookingErrorMessage("PACKAGE_CREDIT_INTEGRITY_MISMATCH"));
  assert.ok(getBookingErrorMessage("schedule_capacity_full"));
  assert.ok(getBookingErrorMessage("OCCURRENCE_INVALID"));
});

test("unknown backend errors retain the existing generic fallback", () => {
  assert.equal(getBookingErrorMessage("SOME_FUTURE_ERROR"), null);
  assert.equal(getBookingErrorMessage(undefined), null);
});
