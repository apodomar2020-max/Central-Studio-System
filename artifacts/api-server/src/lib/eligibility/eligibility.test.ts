import assert from "node:assert/strict";
import test from "node:test";
import type { AgeRange } from "@workspace/api-zod";
import { deriveAgeRangeLabel, evaluateAgeRange, validateAgeRange } from "./ageRange";
import { calculateAgeOnDate, getCairoBusinessDate, parseIsoDate } from "./dateOnly";
import { validateProfileAge } from "./profileAgeValidation";
import type { IsoDate } from "./types";

const iso = (value: string): IsoDate => value as IsoDate;

test("strict date parser accepts calendar dates and rejects malformed/impossible dates", () => {
  assert.equal(parseIsoDate("2010-02-28", { today: iso("2026-07-28") }).eligible, true);
  for (const value of ["2010-2-28", " 2010-02-28", "2010-02-30", "2010-13-01", "not-a-date"]) {
    const result = parseIsoDate(value, { today: iso("2026-07-28") });
    assert.equal(result.eligible, false, value);
    if (!result.eligible) assert.equal(result.reasons[0]?.code, "DOB_INVALID");
  }
});

test("date parser rejects future dates using the supplied date-only boundary", () => {
  const result = parseIsoDate("2026-07-29", { today: iso("2026-07-28") });
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.equal(result.reasons[0]?.code, "DOB_FUTURE");
});

test("age changes exactly on the birthday", () => {
  const dob = iso("2008-07-28");
  assert.equal(calculateAgeOnDate(dob, iso("2026-07-27")), 17);
  assert.equal(calculateAgeOnDate(dob, iso("2026-07-28")), 18);
  assert.equal(calculateAgeOnDate(dob, iso("2026-07-29")), 18);
});

test("canonical boundary ages 4, 5, 12, 13, 17, and 18 are exact", () => {
  const on = iso("2026-07-28");
  for (const age of [4, 5, 12, 13, 17, 18]) {
    assert.equal(calculateAgeOnDate(iso(`${2026 - age}-07-28`), on), age);
  }
});

test("February 29 policy is isolated and defaults to February 28", () => {
  const dob = iso("2008-02-29");
  assert.equal(calculateAgeOnDate(dob, iso("2025-02-27")), 16);
  assert.equal(calculateAgeOnDate(dob, iso("2025-02-28")), 17);
  assert.equal(calculateAgeOnDate(dob, iso("2025-02-28"), { leapDayPolicy: "march_1" }), 16);
  assert.equal(calculateAgeOnDate(dob, iso("2025-03-01"), { leapDayPolicy: "march_1" }), 17);
  assert.equal(calculateAgeOnDate(dob, iso("2024-02-29")), 16);
});

test("Cairo business date is derived from the Cairo civil clock, not UTC date text", () => {
  assert.equal(getCairoBusinessDate(new Date("2026-01-01T21:59:59.000Z")), "2026-01-01");
  assert.equal(getCairoBusinessDate(new Date("2026-01-01T22:00:00.000Z")), "2026-01-02");
});

test("valid age ranges and labels cover canonical and custom cases", () => {
  const cases: Array<[AgeRange, string]> = [
    [{ allowAllAges: true, minAge: null, maxAge: null }, "All Ages"],
    [{ allowAllAges: false, minAge: 5, maxAge: 12 }, "Kids"],
    [{ allowAllAges: false, minAge: 13, maxAge: 17 }, "Teens"],
    [{ allowAllAges: false, minAge: 18, maxAge: null }, "Adults"],
    [{ allowAllAges: false, minAge: 10, maxAge: 15 }, "10–15"],
    [{ allowAllAges: false, minAge: 5, maxAge: 17 }, "Kids + Teens"],
  ];
  for (const [range, label] of cases) {
    assert.equal(validateAgeRange(range).eligible, true);
    assert.equal(deriveAgeRangeLabel(range), label);
  }
});

test("invalid age range shapes are rejected", () => {
  const invalid: AgeRange[] = [
    { allowAllAges: true, minAge: 5, maxAge: 12 },
    { allowAllAges: false, minAge: null, maxAge: null },
    { allowAllAges: false, minAge: -1, maxAge: 12 },
    { allowAllAges: false, minAge: 13, maxAge: 12 },
    { allowAllAges: false, minAge: 5, maxAge: 151 },
  ];
  for (const range of invalid) {
    const result = validateAgeRange(range);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reasons[0]?.code, "AGE_RANGE_INVALID");
  }
});

test("age evaluation uses inclusive minimum and maximum boundaries", () => {
  const kids: AgeRange = { allowAllAges: false, minAge: 5, maxAge: 12 };
  assert.equal(evaluateAgeRange(4, kids).eligible, false);
  assert.equal(evaluateAgeRange(5, kids).eligible, true);
  assert.equal(evaluateAgeRange(12, kids).eligible, true);
  assert.equal(evaluateAgeRange(13, kids).eligible, false);
  assert.equal(evaluateAgeRange(999, { allowAllAges: true, minAge: null, maxAge: null }).eligible, true);
});

test("profile validator allows a 17-year-old Student but rejects a 17-year-old Parent", () => {
  const student = validateProfileAge({
    accountType: "student",
    dateOfBirth: "2009-07-28",
    evaluationDate: iso("2026-07-28"),
  });
  assert.equal(student.eligible, true);

  const parent = validateProfileAge({
    accountType: "parent",
    dateOfBirth: "2009-07-28",
    evaluationDate: iso("2026-07-28"),
  });
  assert.equal(parent.eligible, false);
  if (!parent.eligible) assert.equal(parent.reasons[0]?.code, "PARENT_UNDER_18");
});

test("profile validator accepts Parent exactly at age 18", () => {
  const result = validateProfileAge({
    accountType: "parent",
    dateOfBirth: "2008-07-28",
    evaluationDate: iso("2026-07-28"),
  });
  assert.equal(result.eligible, true);
  if (result.eligible) assert.equal(result.value?.age, 18);
});
