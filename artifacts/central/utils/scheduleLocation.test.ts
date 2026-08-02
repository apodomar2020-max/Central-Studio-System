import assert from "node:assert/strict";
import test from "node:test";
import { scheduleLocationLabel } from "./scheduleLocation";

test("branch takes precedence and returns branch name only, ignoring room", () => {
  assert.equal(
    scheduleLocationLabel({ branch: { name: "Downtown" }, room: { name: "Studio A" }, legacyLocation: "Old hall" }),
    "Downtown",
  );
  assert.equal(
    scheduleLocationLabel({ branch: { name: "New Cairo" }, room: null }),
    "New Cairo",
  );
});

test("regular fallback preserves legacy Schedule then Class location when branch is missing", () => {
  assert.equal(scheduleLocationLabel({ legacyLocation: "Legacy hall", classLocation: "Class hall" }), "Legacy hall");
  assert.equal(scheduleLocationLabel({ classLocation: "Class hall" }), "Class hall");
});

test("empty source returns null", () => {
  assert.equal(scheduleLocationLabel({}), null);
});
