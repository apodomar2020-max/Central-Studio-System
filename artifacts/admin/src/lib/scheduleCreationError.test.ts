import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { scheduleCreationErrorMessage } from "./scheduleCreationError";

test("expected API errors retain their actual explanation and safe error code", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(scheduleCreationErrorMessage({ status, data: { error: "Selected room is occupied.", code: "SCHEDULE_TIME_CONFLICT" } }), "Selected room is occupied. (SCHEDULE_TIME_CONFLICT)");
  }
  assert.equal(scheduleCreationErrorMessage({ status: 422, data: { message: "Room does not belong to branch." } }), "Room does not belong to branch.");
});
test("network and internal errors do not expose raw bodies or stack traces", () => {
  assert.match(scheduleCreationErrorMessage(new Error("secret internal stack")), /^Failed to create/);
  assert.match(scheduleCreationErrorMessage({ status: 500, data: { error: "secret SQL" } }), /^The server could not/);
  assert.match(scheduleCreationErrorMessage(null), /^Failed to create/);
});
test("create mutation renders error toast without closing form or changing permissions", () => {
  const source = readFileSync(new URL("../pages/schedules.tsx", import.meta.url), "utf8");
  const create = source.slice(source.indexOf("createSchedule.mutate("), source.indexOf("const getClassName"));
  assert.match(create, /onSuccess: invalidate/);
  assert.match(create, /onError:[\s\S]*toast\([\s\S]*scheduleCreationErrorMessage\(err\)/);
  assert.doesNotMatch(create.slice(create.indexOf("onError:")), /setOpen\(false\)/);
  assert.match(source, /can\("schedules", "create"\)/);
  assert.match(source, /if \(!values.branchId\)/);
  assert.match(source, /if \(!values.roomId\)/);
});
