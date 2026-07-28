import assert from "node:assert/strict";
import test from "node:test";
import { computeProfileCompletion, type ProfileCompletionInput } from "./profileCompletion";

function completeProfile(overrides: Partial<ProfileCompletionInput> = {}): ProfileCompletionInput {
  return {
    emailVerified: true,
    accountType: "student",
    name: "Test User",
    phone: "01000000000",
    gender: "female",
    dateOfBirth: "2000-01-01",
    city: "Cairo",
    nationality: "Egyptian",
    howDidYouHearAboutUs: "Friend",
    policiesAcceptedAt: "2026-01-01T00:00:00.000Z",
    childrenCount: 0,
    childrenMissingMedicalCount: 0,
    danceInterestCount: 1,
    ...overrides,
  };
}

test("missing DOB leaves profile completion incomplete", () => {
  const completion = computeProfileCompletion(completeProfile({ dateOfBirth: null }));
  assert.equal(completion.isComplete, false);
  assert.equal(completion.nextStep, "profile");
  assert.ok(completion.missing.includes("dateOfBirth"));
});

test("invalid and future DOB values leave completion incomplete", () => {
  for (const dateOfBirth of ["2020-02-30", "2999-01-01"]) {
    const completion = computeProfileCompletion(completeProfile({ dateOfBirth }));
    assert.equal(completion.isComplete, false);
    assert.ok(completion.missing.includes("dateOfBirth"));
  }
});

test("under-18 Parent cannot become profile complete", () => {
  const completion = computeProfileCompletion(completeProfile({
    accountType: "parent",
    dateOfBirth: "2010-01-01",
    childrenCount: 1,
    childrenMissingMedicalCount: 0,
  }));
  assert.equal(completion.isComplete, false);
  assert.equal(completion.nextStep, "profile");
  assert.ok(completion.missing.includes("dateOfBirth"));
});

test("adult Parent can complete when all Parent steps are complete", () => {
  const completion = computeProfileCompletion(completeProfile({
    accountType: "parent",
    dateOfBirth: "2000-01-01",
    childrenCount: 1,
    childrenMissingMedicalCount: 0,
  }));
  assert.equal(completion.isComplete, true);
  assert.equal(completion.nextStep, "done");
});
