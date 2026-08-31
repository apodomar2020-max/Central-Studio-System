import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_PHONE_REGEX,
  formatAccountPhoneLocal,
  isValidAccountPhone,
  normalizeAccountPhone,
  validateAccountPhone,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./phoneDomain.ts";

const SAME_NUMBER_INPUTS = [
  "01012345678",
  "1012345678",
  "201012345678",
  "+201012345678",
  "00201012345678",
  "010 123 45678",
  "010-123-45678",
  "(010) 123 45678",
  "٠١٠١٢٣٤٥٦٧٨",
];

test("every accepted representation of the same real number normalizes to the same 12-digit canonical value", () => {
  for (const input of SAME_NUMBER_INPUTS) {
    assert.equal(normalizeAccountPhone(input), "201012345678", `expected ${input} to normalize identically`);
  }
});

test("all four supported Egyptian mobile operator prefixes validate", () => {
  for (const prefix of ["10", "11", "12", "15"]) {
    const canonical = `20${prefix}12345678`;
    assert.equal(isValidAccountPhone(canonical), true, `expected ${canonical} to be valid`);
    assert.match(canonical, ACCOUNT_PHONE_REGEX);
  }
});

test("invalid operator prefixes are rejected even though they normalize", () => {
  for (const prefix of ["13", "14", "16", "19"]) {
    const canonical = normalizeAccountPhone(`0${prefix}12345678`);
    assert.equal(canonical, `20${prefix}12345678`, "still normalizes syntactically");
    assert.equal(isValidAccountPhone(canonical!), false, `expected operator ${prefix} to fail validation`);
  }
});

test("landline numbers (non-01 local prefix) do not normalize to a 12-digit canonical value", () => {
  // A typical Cairo landline, e.g. 0223456789 (10 digits) — does not match
  // the 01-prefixed 11-digit mobile shape, so it is correctly rejected at
  // the normalization stage rather than slipping through as a fake mobile.
  assert.equal(normalizeAccountPhone("0223456789"), null);
});

test("a foreign (non-Egyptian) number does not validate even if it parses as digits", () => {
  // A US number normalizes to 12 digits by coincidence of length in some
  // cases, but a real US number like +14155552671 does not start with "20".
  assert.equal(normalizeAccountPhone("+14155552671"), null);
});

test("too short / too long / garbage / empty are all rejected", () => {
  for (const bad of ["12345", "010123456789012345", "abcdefghijk", "", "   ", null, undefined]) {
    const result = validateAccountPhone(bad as string | null | undefined);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be invalid`);
  }
});

test("validateAccountPhone distinguishes empty vs unparseable vs invalid_format", () => {
  assert.deepEqual(validateAccountPhone(""), { ok: false, reason: "empty" });
  assert.deepEqual(validateAccountPhone("abc"), { ok: false, reason: "unparseable" });
  assert.deepEqual(validateAccountPhone("01312345678"), { ok: false, reason: "invalid_format" });
  assert.deepEqual(validateAccountPhone("01012345678"), { ok: true, canonical: "201012345678" });
});

test("formatAccountPhoneLocal round-trips the canonical form back to the familiar local display", () => {
  assert.equal(formatAccountPhoneLocal("201012345678"), "01012345678");
  assert.equal(formatAccountPhoneLocal(null), "");
  assert.equal(formatAccountPhoneLocal(undefined), "");
});
