import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./children.ts", import.meta.url), "utf8");

test("child age and date of birth lock covers every historical participation source", () => {
  assert.match(route, /bookingsTable\.participantChildId/);
  assert.match(route, /packageOrdersTable\.participantChildId/);
  assert.match(route, /balletApplicationsTable\.childId/);
  assert.match(route, /Promise\.all\(\[/);
});

test("the lock is returned by GET and enforced before updating the child", () => {
  assert.match(route, /dateOfBirthLocked: policies\.get\(rest\.id\)\?\.locked \?\? false/);
  assert.match(route, /changesDateOfBirth \|\| changesAge/);
  assert.match(route, /code: "CHILD_DATE_OF_BIRTH_LOCKED"/);
  assert.match(route, /res\.status\(409\)/);
});
