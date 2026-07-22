import assert from "node:assert/strict";
import test from "node:test";
import { balletScheduleFormSchema } from "./balletScheduleFormSchema";
import { classifyErrorResponse, scheduleErrorMessage } from "./balletScheduleApiClient";

const base = {
  classId: 1,
  dayOfWeek: 1,
  startTime: "16:00",
  endTime: "17:00",
  status: "active" as const,
};

test("Admin Schedule form accepts a strictly increasing time range", () => {
  assert.equal(balletScheduleFormSchema.safeParse(base).success, true);
});

test("Admin Schedule form rejects equal start and end times on endTime", () => {
  const parsed = balletScheduleFormSchema.safeParse({ ...base, endTime: "16:00" });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(parsed.error.issues[0]?.path, ["endTime"]);
  assert.equal(parsed.error.issues[0]?.message, "End time must be later than start time.");
});

test("Admin Schedule form rejects an end time earlier than the start time", () => {
  const parsed = balletScheduleFormSchema.safeParse({ ...base, endTime: "15:00" });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.equal(parsed.error.issues[0]?.message, "End time must be later than start time.");
});

test("Admin surfaces exact-duplicate and overlap API messages verbatim", () => {
  for (const body of [
    {
      error: "This Class already has a Schedule with the same day, start time, and end time.",
      code: "DUPLICATE_BALLET_SCHEDULE_SLOT",
    },
    {
      error: "This Class already has an overlapping Schedule on this day.",
      code: "BALLET_SCHEDULE_TIME_CONFLICT",
    },
  ]) {
    const error = classifyErrorResponse(409, "application/json", body);
    assert.equal(error.code, body.code);
    assert.equal(scheduleErrorMessage(error, "fallback"), body.error);
  }
});
