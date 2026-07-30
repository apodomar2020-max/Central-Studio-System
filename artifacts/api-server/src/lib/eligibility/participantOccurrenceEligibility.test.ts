import assert from "node:assert/strict";
import test from "node:test";
import { evaluateParticipantOnOccurrence } from "./participantOccurrenceEligibility";

const kids = { allowAllAges: false, minAge: 5, maxAge: 12 };
const adults = { allowAllAges: false, minAge: 18, maxAge: null };

test("uses the exact occurrence date and inclusive boundaries", () => {
  assert.equal(evaluateParticipantOnOccurrence("2021-07-30", "2026-07-30", kids).eligible, true);
  assert.equal(evaluateParticipantOnOccurrence("2014-07-30", "2026-07-30", kids).eligible, true);
  assert.equal(evaluateParticipantOnOccurrence("2013-07-30", "2026-07-30", kids).eligible, false);
  assert.equal(evaluateParticipantOnOccurrence("2008-07-30", "2026-07-29", adults).eligible, false);
  assert.equal(evaluateParticipantOnOccurrence("2008-07-30", "2026-07-30", adults).eligible, true);
  assert.equal(evaluateParticipantOnOccurrence("2022-07-30", "2026-07-30", kids).reasonCode, "BELOW_MINIMUM_AGE");
  assert.equal(evaluateParticipantOnOccurrence("2013-07-30", "2026-07-30", kids).reasonCode, "ABOVE_MAXIMUM_AGE");
});

test("missing canonical DOB is never guessed", () => {
  assert.deepEqual(evaluateParticipantOnOccurrence(null, "2026-07-30", kids), {
    eligible: false,
    reasonCode: "PARTICIPANT_DOB_REQUIRED",
    ageOnOccurrenceDate: null,
  });
});

test("all ages still requires a canonical DOB for a participant decision", () => {
  assert.equal(
    evaluateParticipantOnOccurrence("2020-01-01", "2026-07-30", {
      allowAllAges: true,
      minAge: null,
      maxAge: null,
    }).eligible,
    true,
  );
});
