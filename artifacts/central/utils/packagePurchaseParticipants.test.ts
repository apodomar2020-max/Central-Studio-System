import assert from "node:assert/strict";
import test from "node:test";

import type { PricePackage } from "@workspace/api-client-react";

import { buildPackageParticipantOptions, participantSelectionFor } from "./packagePurchaseParticipants";

const kidsPackage = {
  allowAllAges: false,
  minAge: 5,
  maxAge: 12,
} as PricePackage;

const parent = {
  id: "1",
  fullName: "Parent",
  phone: "",
  email: "parent@example.invalid",
  emailVerified: true,
  role: "parent",
  accountType: "parent",
  dateOfBirth: "1980-01-01",
} as const;

test("child eligibility and submitted ID use canonical dateOfBirth", () => {
  const [self, child] = buildPackageParticipantOptions(parent, [{
    id: "42",
    fullName: "Child",
    dateOfBirth: "2020-07-30",
    birthday: "forged-legacy-value",
    age: 99,
    gender: "female",
  }], kidsPackage, "2026-07-30");

  assert.equal(self?.eligible, false);
  assert.equal(child?.age, 6);
  assert.equal(child?.eligible, true);
  assert.deepEqual(participantSelectionFor(child!), {
    participantType: "child",
    participantChildId: 42,
  });
});

test("legacy birthday and numeric age cannot make a missing canonical DOB eligible", () => {
  const [, child] = buildPackageParticipantOptions(parent, [{
    id: "43",
    fullName: "Legacy Child",
    dateOfBirth: null,
    birthday: "2020-07-30",
    age: 6,
    gender: "female",
  }], kidsPackage, "2026-07-30");

  assert.equal(child?.age, null);
  assert.equal(child?.eligible, false);
});

test("switching participants always derives the current selection", () => {
  const options = buildPackageParticipantOptions(parent, [
    { id: "44", fullName: "A", dateOfBirth: "2020-01-01", birthday: "2020-01-01", age: 6, gender: "female" },
    { id: "45", fullName: "B", dateOfBirth: "2019-01-01", birthday: "2019-01-01", age: 7, gender: "male" },
  ], kidsPackage, "2026-07-30");

  assert.deepEqual(participantSelectionFor(options[0]!), { participantType: "self" });
  assert.deepEqual(participantSelectionFor(options[1]!), { participantType: "child", participantChildId: 44 });
  assert.deepEqual(participantSelectionFor(options[2]!), { participantType: "child", participantChildId: 45 });
});
