import assert from "node:assert/strict";
import test from "node:test";

import { presentProfileSaveError, profileSaveErrorCode } from "./profileSaveError";

test("duplicate phone conflict has readable account guidance", () => {
  const error = { status: 409, data: { code: "PHONE_ALREADY_IN_USE", error: "Internal detail" } };
  assert.equal(profileSaveErrorCode(error), "PHONE_ALREADY_IN_USE");
  assert.equal(presentProfileSaveError(error), "This phone number is already associated with another account.");
});

test("HTTP 500 details never reach the user", () => {
  const error = Object.assign(new Error("HTTP 500: internal server error"), {
    status: 500,
    data: { error: "Internal server error" },
  });
  const message = presentProfileSaveError(error);
  assert.equal(message, "We couldn’t save your profile right now. Please try again.");
  assert.doesNotMatch(message, /HTTP|500|internal/i);
});

test("network failures have actionable copy", () => {
  assert.equal(
    presentProfileSaveError(new TypeError("Network request failed")),
    "Please check your internet connection and try again.",
  );
});

test("safe business validation from a 4xx response remains readable", () => {
  assert.equal(
    presentProfileSaveError({ status: 400, data: { error: "You must be at least 16 years old." } }),
    "You must be at least 16 years old.",
  );
});

test("technical-looking 4xx details are also hidden", () => {
  assert.equal(
    presentProfileSaveError({ status: 400, data: { error: "Endpoint failed query SQL" } }),
    "We couldn’t save your profile right now. Please try again.",
  );
});
