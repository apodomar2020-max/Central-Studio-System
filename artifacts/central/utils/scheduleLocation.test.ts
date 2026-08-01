import assert from "node:assert/strict";
import test from "node:test";
import { scheduleLocationLabel } from "./scheduleLocation";

test("resolved Branch and Room take precedence", () => {
  assert.equal(scheduleLocationLabel({ branch: { name: "Downtown" }, room: { name: "Studio A" }, legacyLocation: "Old hall" }), "Downtown · Studio A");
});

test("regular fallback preserves legacy Schedule then Class location", () => {
  assert.equal(scheduleLocationLabel({ legacyLocation: "Legacy hall", classLocation: "Class hall" }), "Legacy hall");
  assert.equal(scheduleLocationLabel({ classLocation: "Class hall" }), "Class hall");
});

test("missing and partial resolved data does not invent a location", () => {
  assert.equal(scheduleLocationLabel({ branch: { name: "Downtown" } }), null);
  assert.equal(scheduleLocationLabel({}), null);
});
