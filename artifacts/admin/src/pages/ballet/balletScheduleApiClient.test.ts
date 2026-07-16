import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError, classifyErrorResponse, scheduleErrorMessage } from "./balletScheduleApiClient";

test("structured backend validation error (4xx) is shown to the admin verbatim", () => {
  const err = classifyErrorResponse(422, "application/json", {
    error: "The selected Ballet class no longer exists.",
    code: "CLASS_NOT_FOUND",
  });
  assert.equal(err.kind, "validation");
  assert.equal(scheduleErrorMessage(err, "fallback"), "The selected Ballet class no longer exists.");
});

test("structured backend duration validation error is shown to the admin verbatim", () => {
  const err = classifyErrorResponse(400, "application/json", {
    error: "durationMins must be a positive number",
    code: "VALIDATION_ERROR",
  });
  assert.equal(err.kind, "validation");
  assert.equal(scheduleErrorMessage(err, "fallback"), "durationMins must be a positive number");
});

test("structured backend 500 JSON response never leaks its raw message to the admin", () => {
  const err = classifyErrorResponse(500, "application/json", {
    error: "Failed query: select ... column \"capacity\" does not exist",
    code: "INTERNAL_ERROR",
    requestId: 42,
  });
  assert.equal(err.kind, "server");
  // The frontend never trusts a 5xx body's own message text, even though
  // this route's backend already sanitizes it — defense in depth.
  assert.equal(scheduleErrorMessage(err, "fallback"), "The schedules service returned an unexpected server error.");
  assert.notEqual(scheduleErrorMessage(err, "fallback").includes("capacity"), true);
});

test("non-JSON 500 (gateway/proxy crash page) is distinguished from a structured validation error", () => {
  const err = classifyErrorResponse(500, "text/html", null);
  assert.equal(err.kind, "gateway");
  assert.equal(scheduleErrorMessage(err, "fallback"), "The schedules service returned an unexpected server error.");
});

test("a JSON body missing the expected `error` string is treated as a gateway failure, not a validation error", () => {
  const err = classifyErrorResponse(502, "application/json", { message: "Bad Gateway" });
  assert.equal(err.kind, "gateway");
});

test("network/CORS failure produces a distinct, non-technical message", () => {
  const err = new AdminApiError("network", "Unable to reach the schedules service.");
  assert.equal(scheduleErrorMessage(err, "fallback"), "Unable to reach the schedules service.");
});

test("an unrecognized thrown value falls back to the caller-supplied default message", () => {
  assert.equal(scheduleErrorMessage(new Error("some unrelated error"), "Failed to save schedule."), "Failed to save schedule.");
  assert.equal(scheduleErrorMessage("a plain string", "Failed to save schedule."), "Failed to save schedule.");
});
