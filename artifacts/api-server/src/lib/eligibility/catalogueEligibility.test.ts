import assert from "node:assert/strict";
import test from "node:test";
import {
  ageRangeMetadata,
  evaluateClassCatalogueEligibility,
  evaluatePackageCatalogueEligibility,
  evaluateScheduleCatalogueEligibility,
  studentCatalogueVisible,
} from "./catalogueEligibility";
import { parseIsoDate } from "./dateOnly";

function isoDate(value: string) {
  const parsed = parseIsoDate(value, { rejectFuture: false });
  assert.equal(parsed.eligible, true);
  if (!parsed.eligible) throw new Error(`Invalid test ISO date: ${value}`);
  if (!parsed.value) throw new Error(`Missing parsed test ISO date: ${value}`);
  return parsed.value;
}

const kids = { allowAllAges: false, minAge: 5, maxAge: 12 };
const teens = { allowAllAges: false, minAge: 13, maxAge: 17 };
const adults = { allowAllAges: false, minAge: 18, maxAge: null };
const allAges = { allowAllAges: true, minAge: null, maxAge: null };

test("guests and parents receive metadata without participant evaluation", () => {
  assert.deepEqual(evaluateClassCatalogueEligibility({ kind: "guest" }, kids, isoDate("2026-07-28")), {
    evaluated: false, eligible: null, evaluatedOn: null, reasons: [],
  });
  assert.equal(evaluatePackageCatalogueEligibility(
    { kind: "parent", studentId: 1, dateOfBirth: "1980-01-01" },
    kids,
    isoDate("2026-07-28"),
  ).evaluated, false);
});

test("student catalogue uses inclusive age boundaries", () => {
  const ages = [
    ["2022-07-28", kids, false], // 4
    ["2021-07-28", kids, true],  // 5
    ["2014-07-28", kids, true],  // 12
    ["2013-07-28", teens, true], // 13
    ["2009-07-28", teens, true], // 17
    ["2008-07-28", adults, true], // 18
  ] as const;
  for (const [dateOfBirth, range, expected] of ages) {
    const result = evaluateClassCatalogueEligibility(
      { kind: "student", studentId: 1, dateOfBirth: isoDate(dateOfBirth) },
      range,
      isoDate("2026-07-28"),
    );
    assert.equal(result.eligible, expected);
  }
});

test("schedule eligibility uses the supplied occurrence date", () => {
  const beforeBirthday = evaluateScheduleCatalogueEligibility(
    { kind: "student", studentId: 1, dateOfBirth: "2008-07-29" },
    adults,
    isoDate("2026-07-28"),
  );
  const onBirthday = evaluateScheduleCatalogueEligibility(
    { kind: "student", studentId: 1, dateOfBirth: "2008-07-29" },
    adults,
    isoDate("2026-07-29"),
  );
  assert.equal(beforeBirthday.eligible, false);
  assert.equal(onBirthday.eligible, true);
});

test("legacy unconfigured rows are visible but explicitly marked", () => {
  const range = { allowAllAges: null, minAge: null, maxAge: null };
  assert.equal(ageRangeMetadata(range).configurationState, "legacy_unconfigured");
  const result = evaluatePackageCatalogueEligibility(
    { kind: "student", studentId: 1, dateOfBirth: "2010-01-01" },
    range,
    isoDate("2026-07-28"),
  );
  assert.equal(result.eligible, true);
  assert.equal(studentCatalogueVisible(result), true);
});

test("missing DOB is visible with a stable profile reason", () => {
  const result = evaluateClassCatalogueEligibility(
    { kind: "student", studentId: 1, dateOfBirth: null },
    allAges,
    isoDate("2026-07-28"),
  );
  assert.equal(result.eligible, false);
  assert.equal(result.reasons[0]?.code, "DOB_REQUIRED");
  assert.equal(studentCatalogueVisible(result), true);
});
