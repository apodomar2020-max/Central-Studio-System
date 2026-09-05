import assert from "node:assert/strict";
import test from "node:test";

import { presentUserFacingError } from "./userFacingError";

test("preserves readable business errors", () => {
  assert.equal(
    presentUserFacingError({ status: 409, data: { error: "This booking has already been cancelled." } }),
    "This booking has already been cancelled.",
  );
});

test("hides server and transport internals", () => {
  assert.equal(
    presentUserFacingError(
      Object.assign(new Error("HTTP 500: Internal server error"), { status: 500 }),
      "We couldn’t complete this request. Please try again.",
    ),
    "We couldn’t complete this request. Please try again.",
  );
});

test("hides technical-looking details even without a status", () => {
  assert.equal(
    presentUserFacingError(new Error("Failed query: SELECT * FROM students")),
    "Something went wrong. Please try again.",
  );
});

test("gives network failures actionable copy", () => {
  assert.equal(
    presentUserFacingError(new TypeError("Network request failed")),
    "Please check your internet connection and try again.",
  );
});
