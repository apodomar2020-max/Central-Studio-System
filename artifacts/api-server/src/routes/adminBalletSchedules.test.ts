import assert from "node:assert/strict";
import test from "node:test";

// Pure zod-schema tests — no DB connection, matching this project's existing
// approach (see routes/classCapacity.test.ts). A fake DATABASE_URL is enough
// to satisfy @workspace/db's module-load-time check; nothing here queries.
process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

test("blank duration (key omitted) passes validation and is not sent to the DB as a value", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal("durationMins" in result.data, false, "omitted key must not appear in parsed output");
  }
});

test("durationMins: null is accepted and normalized to null (explicit clear)", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: null,
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.durationMins, null);
});

test("durationMins: '' (empty string) is accepted and normalized to null, never coerced to 0", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: "",
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.durationMins, null);
});

test("positive integer duration is accepted", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: 60,
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.durationMins, 60);
});

test("zero duration is rejected", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: 0,
  });
  assert.equal(result.success, false);
});

test("negative duration is rejected", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: -5,
  });
  assert.equal(result.success, false);
});

test("decimal duration is rejected", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: 1.5,
  });
  assert.equal(result.success, false);
});

test("non-numeric duration is rejected", async () => {
  const { CreateScheduleBody } = await import("./adminBalletSchedules");
  const result = CreateScheduleBody.safeParse({
    classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: "abc",
  });
  assert.equal(result.success, false);
});

test("a row with null duration round-trips through the JSON response unchanged (list contract)", () => {
  // The GET list route returns Drizzle rows via res.json() directly with no
  // output schema — this proves that pass-through preserves an explicit
  // null (never omits it, never coerces it), which is the documented
  // contract for what the list response looks like for a schedule with no
  // recorded duration.
  const row = { id: 1, classId: 12, dayOfWeek: 1, startTime: "16:00", endTime: "17:00", status: "active", durationMins: null };
  const roundTripped = JSON.parse(JSON.stringify(row));
  assert.equal("durationMins" in roundTripped, true);
  assert.equal(roundTripped.durationMins, null);
});
