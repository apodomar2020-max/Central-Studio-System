import assert from "node:assert/strict";
import test from "node:test";
import { parseIsoDate } from "./dateOnly";
import { evaluatePackagePurchaseEligibility } from "./packagePurchaseEligibility";

function iso(value: string) {
  const parsed = parseIsoDate(value, { rejectFuture: false });
  assert.equal(parsed.eligible, true);
  assert.ok(parsed.value);
  return parsed.value;
}

const evaluatedOn = iso("2026-07-28");

test("purchase eligibility uses inclusive canonical age boundaries", () => {
  const cases = [
    ["2021-07-28", { allowAllAges: false, minAge: 5, maxAge: 12 }, true],
    ["2014-07-28", { allowAllAges: false, minAge: 5, maxAge: 12 }, true],
    ["2013-07-28", { allowAllAges: false, minAge: 13, maxAge: 17 }, true],
    ["2009-07-28", { allowAllAges: false, minAge: 13, maxAge: 17 }, true],
    ["2008-07-28", { allowAllAges: false, minAge: 18, maxAge: null }, true],
    ["2022-07-28", { allowAllAges: false, minAge: 5, maxAge: 12 }, false],
  ] as const;
  for (const [dob, range, expected] of cases) {
    assert.equal(evaluatePackagePurchaseEligibility(dob, range, evaluatedOn).eligible, expected);
  }
});

test("birthday on purchase date is the new age", () => {
  const result = evaluatePackagePurchaseEligibility(
    "2008-07-28",
    { allowAllAges: false, minAge: 18, maxAge: null },
    evaluatedOn,
  );
  assert.equal(result.eligible, true);
  if (result.eligible) assert.equal(result.value.participantAgeAtPurchase, 18);
});

test("All Ages still requires authoritative valid DOB", () => {
  const range = { allowAllAges: true, minAge: null, maxAge: null };
  assert.equal(evaluatePackagePurchaseEligibility(null, range, evaluatedOn).eligible, false);
  assert.equal(evaluatePackagePurchaseEligibility("not-a-date", range, evaluatedOn).eligible, false);
  assert.equal(evaluatePackagePurchaseEligibility("2027-01-01", range, evaluatedOn).eligible, false);
});

test("custom and open-ended ranges return stable boundary reasons", () => {
  const below = evaluatePackagePurchaseEligibility(
    "2017-07-28",
    { allowAllAges: false, minAge: 10, maxAge: 15 },
    evaluatedOn,
  );
  assert.equal(below.eligible, false);
  if (!below.eligible) assert.equal(below.reasons[0]?.code, "AGE_BELOW_MINIMUM");

  const above = evaluatePackagePurchaseEligibility(
    "2000-07-28",
    { allowAllAges: false, minAge: 10, maxAge: 15 },
    evaluatedOn,
  );
  assert.equal(above.eligible, false);
  if (!above.eligible) assert.equal(above.reasons[0]?.code, "AGE_ABOVE_MAXIMUM");
});

test("legacy-unconfigured packages are temporarily allowed and snapshotted", () => {
  const result = evaluatePackagePurchaseEligibility(
    "2010-01-01",
    { allowAllAges: null, minAge: null, maxAge: null },
    evaluatedOn,
  );
  assert.equal(result.eligible, true);
  if (result.eligible) {
    assert.equal(result.value.purchaseEligibilityConfigurationState, "legacy_unconfigured");
    assert.equal(result.value.packageAllowAllAgesSnapshot, null);
    assert.equal(result.warnings.length, 1);
  }
});
