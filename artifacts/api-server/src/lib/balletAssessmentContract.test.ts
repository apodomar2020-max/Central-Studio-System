import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  balletApplicationDisplayReference,
  resolveStoredChildDob,
} from "./balletAssessmentContract";

const route = readFileSync(
  resolve(process.cwd(), "artifacts/api-server/src/routes/ballet.ts"),
  "utf8",
);

test("stored child DOB prefers dateOfBirth and preserves legacy birthday fallback", () => {
  assert.equal(resolveStoredChildDob({ dateOfBirth: "2018-04-03", birthday: "2017-01-01" }), "2018-04-03");
  assert.equal(resolveStoredChildDob({ dateOfBirth: null, birthday: "2017-01-01" }), "2017-01-01");
  assert.equal(resolveStoredChildDob({ dateOfBirth: null, birthday: null }), null);

  assert.equal(route.match(/resolveStoredChildDob\(/g)?.length, 2);
  assert.match(route, /code: "MISSING_BIRTHDAY"/);
  assert.match(route, /This child has no birthday on file/);
});

test("application display reference is stable and derived from the persisted id", () => {
  assert.equal(balletApplicationDisplayReference(42), "BALLET-42");
});

test("submission serializes and rechecks occurrence capacity as a recoverable rule", () => {
  const lockIndex = route.indexOf("pg_advisory_xact_lock(hashtext");
  const countIndex = route.indexOf("ASSESSMENT_SCHEDULE_FULL");
  const insertIndex = route.indexOf(".insert(balletApplicationsTable)", countIndex);

  assert.notEqual(lockIndex, -1);
  assert.notEqual(countIndex, -1);
  assert.notEqual(insertIndex, -1);
  assert(lockIndex < countIndex);
  assert(countIndex < insertIndex);
  assert.match(route, /status: 422, code: "ASSESSMENT_SCHEDULE_FULL"/);
});

test("public schedule and submit responses expose the website contract additions", () => {
  for (const field of [
    "bookedCount",
    "remainingCapacity",
    "branchName",
    "roomName",
    "branch:",
    "room:",
    "displayLocation",
    "assessmentFeeAmountEgp",
    "displayReference",
  ]) {
    assert.match(route, new RegExp(field));
  }
});

test("initial application audit wording is channel-neutral", () => {
  assert.match(route, /note:\s+"Application submitted"/);
  assert.doesNotMatch(route, /Application submitted via mobile app/);
});
