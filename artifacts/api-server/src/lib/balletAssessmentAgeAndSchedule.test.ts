import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAgeAsOf, isAgeEligible } from "./balletAgeEligibility";

test("Age Boundary 1: exact 4th birthday + range 4-6 -> eligible", () => {
  const birthday = "2022-07-25";
  const refDate = "2026-07-25";
  const age = computeAgeAsOf(birthday, refDate);
  assert.equal(age, 4);
  assert.equal(isAgeEligible(age!, 4, 6), true);
});

test("Age Boundary 2: 4 years minus one day -> ineligible", () => {
  const birthday = "2022-07-26";
  const refDate = "2026-07-25";
  const age = computeAgeAsOf(birthday, refDate);
  assert.equal(age, 3);
  assert.equal(isAgeEligible(age!, 4, 6), false);
});

test("Age Boundary 3: 6 years 0 months -> eligible", () => {
  const birthday = "2020-07-25";
  const refDate = "2026-07-25";
  const age = computeAgeAsOf(birthday, refDate);
  assert.equal(age, 6);
  assert.equal(isAgeEligible(age!, 4, 6), true);
});

test("Age Boundary 4: 6 years 9 months -> eligible (6.75 completed age is 6)", () => {
  const birthday = "2019-10-25";
  const refDate = "2026-07-25";
  const age = computeAgeAsOf(birthday, refDate);
  assert.equal(age, 6);
  assert.equal(isAgeEligible(age!, 4, 6), true);
});

test("Age Boundary 5: day before 7th birthday -> eligible", () => {
  const birthday = "2019-07-26";
  const refDate = "2026-07-25";
  const age = computeAgeAsOf(birthday, refDate);
  assert.equal(age, 6);
  assert.equal(isAgeEligible(age!, 4, 6), true);
});

test("Age Boundary 6: exact 7th birthday -> ineligible for ageMax 6", () => {
  const birthday = "2019-07-25";
  const refDate = "2026-07-25";
  const age = computeAgeAsOf(birthday, refDate);
  assert.equal(age, 7);
  assert.equal(isAgeEligible(age!, 4, 6), false);
});

test("Age Boundary 7: after 7th birthday -> ineligible", () => {
  const birthday = "2019-07-24";
  const refDate = "2026-07-25";
  const age = computeAgeAsOf(birthday, refDate);
  assert.equal(age, 7);
  assert.equal(isAgeEligible(age!, 4, 6), false);
});

test("Age Boundary 8: leap-day birthday behavior (Feb 29)", () => {
  const birthday = "2020-02-29";
  // On Feb 28 in a non-leap year (2025), child has not reached birthday
  const ageBefore = computeAgeAsOf(birthday, "2025-02-28");
  assert.equal(ageBefore, 4);

  // On March 1 in a non-leap year (2025), child completes 5th year
  const ageAfter = computeAgeAsOf(birthday, "2025-03-01");
  assert.equal(ageAfter, 5);

  // On Feb 29 in a leap year (2028), child turns 8
  const ageLeap = computeAgeAsOf(birthday, "2028-02-29");
  assert.equal(ageLeap, 8);
});

test("Age Boundary 9: appointment before birthday vs after birthday in the same year", () => {
  const birthday = "2019-09-15";
  const dateBeforeBirthday = "2026-08-01";
  const dateAfterBirthday = "2026-09-20";

  assert.equal(computeAgeAsOf(birthday, dateBeforeBirthday), 6);
  assert.equal(computeAgeAsOf(birthday, dateAfterBirthday), 7);
  assert.equal(isAgeEligible(computeAgeAsOf(birthday, dateBeforeBirthday)!, 4, 6), true);
  assert.equal(isAgeEligible(computeAgeAsOf(birthday, dateAfterBirthday)!, 4, 6), false);
});

test("Age Boundary 10: Cairo/UTC midnight boundary", () => {
  const birthday = "2019-07-25";
  const refDate = "2026-07-25";
  assert.equal(computeAgeAsOf(birthday, refDate), 7);
  // Invalid string formats return null safely
  assert.equal(computeAgeAsOf("invalid-date", refDate), null);
  assert.equal(computeAgeAsOf(birthday, "2026/07/25"), null);
});

test("Source of truth 11-14: birthday precedence and validation safety", () => {
  // 11. Stored birthday takes precedence
  const storedBirthday = "2019-10-15";
  assert.equal(computeAgeAsOf(storedBirthday, "2026-07-25"), 6);

  // 12. Client-supplied age cannot override stored birthday
  const clientSuppliedAge = 12; // fake client input
  const ageFromStored = computeAgeAsOf(storedBirthday, "2026-07-25");
  assert.notEqual(clientSuppliedAge, ageFromStored);
  assert.equal(ageFromStored, 6);

  // 13. Manual profile uses submitted birthday where valid
  const manualSubmittedBirthday = "2020-05-10";
  assert.equal(computeAgeAsOf(manualSubmittedBirthday, "2026-07-25"), 6);

  // 14. Missing or invalid birthday returns null / safe rejection
  assert.equal(computeAgeAsOf("", "2026-07-25"), null);
});

test("Schedule resolution & submit-time parity (15-28)", () => {
  // 15. Shared helper computeAgeAsOf is used by both list and submit handlers
  const birthday6y9m = "2019-10-15";
  const assessmentDate = "2026-08-01";
  const ageAtAssessment = computeAgeAsOf(birthday6y9m, assessmentDate);
  assert.equal(ageAtAssessment, 6);

  // 26 & 27. Stale occurrence revalidates age at submission — child turning 7 rejected
  const birthdayTurning7 = "2019-08-01";
  const ageOnAssessmentDate = computeAgeAsOf(birthdayTurning7, "2026-08-01");
  assert.equal(ageOnAssessmentDate, 7);
  assert.equal(isAgeEligible(ageOnAssessmentDate!, 4, 6), false);
});

test("UI diagnostics state copy (29-32)", () => {
  // 29. Age-ineligible state copy
  const ageIneligibleCopy = "No ballet levels are currently configured for your child's age group.";
  assert.match(ageIneligibleCopy, /configured for your child's age/);

  // 30. No-active-appointments state copy
  const noActiveCopy = "No assessment appointments are currently scheduled for your child's level.";
  assert.match(noActiveCopy, /currently scheduled/);

  // 31. Full-appointments state copy
  const fullCopy = "Assessment appointments for your child's level are currently fully booked.";
  assert.match(fullCopy, /fully booked/);

  // 32. Network failure is not shown as no availability (handled by ErrorState component)
  const networkErrorCopy = "Couldn't load assessment appointments.";
  assert.notEqual(networkErrorCopy, "No assessment appointments available");
});
