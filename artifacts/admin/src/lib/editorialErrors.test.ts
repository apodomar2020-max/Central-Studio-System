/**
 * Wave 2.1A — Editorial error interpretation.
 *
 * Real unit tests: lib/editorial-errors.ts is deliberately dependency-free so
 * it can be imported and exercised directly.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITORIAL_GENERIC_ERROR_MESSAGE,
  editorialErrorMessage,
  toEditorialError,
} from "./editorial-errors.ts";

/** Minimal stand-in for the generated client's ApiError shape. */
function apiError(status: number, body: unknown) {
  return Object.assign(new Error(`HTTP ${status}`), { status, data: body });
}

test("400 — the backend's editor-grade message is shown verbatim", () => {
  const result = toEditorialError(apiError(400, { error: "Slug may only contain lowercase letters, numbers and hyphens." }));
  assert.equal(result.status, 400);
  assert.equal(result.message, "Slug may only contain lowercase letters, numbers and hyphens.");
  assert.equal(result.isBackendMessage, true);
  assert.equal(result.isServerError, false);
});

test("404 — the backend's message is preserved", () => {
  const result = toEditorialError(apiError(404, { error: "Post not found." }));
  assert.equal(result.status, 404);
  assert.equal(result.message, "Post not found.");
  assert.equal(result.isBackendMessage, true);
});

test("409 — the backend's conflict message is preserved", () => {
  const result = toEditorialError(apiError(409, { error: "A post with this slug already exists." }));
  assert.equal(result.status, 409);
  assert.equal(result.message, "A post with this slug already exists.");
  assert.equal(result.isBackendMessage, true);
});

test("500 — internal detail is never leaked; a safe generic message is returned", () => {
  const result = toEditorialError(
    apiError(500, { error: "relation \"editorial_post_translations\" does not exist at character 42" }),
  );
  assert.equal(result.status, 500);
  assert.equal(result.message, EDITORIAL_GENERIC_ERROR_MESSAGE);
  assert.equal(result.isBackendMessage, false);
  assert.equal(result.isServerError, true);
  assert.doesNotMatch(result.message, /relation|character/i);
});

test("malformed and non-API failures are handled safely without throwing", () => {
  for (const value of [
    new TypeError("Failed to fetch"), // network failure
    undefined,
    null,
    "boom",
    42,
    {},
    { status: "500" }, // status not a number
    { status: 400 }, // no body at all
    { status: 400, data: null },
    { status: 409, data: { error: "   " } }, // blank message
    { status: 422, data: { error: 7 } }, // wrong message type
  ]) {
    const result = toEditorialError(value);
    assert.equal(result.message, EDITORIAL_GENERIC_ERROR_MESSAGE, `unexpected message for ${JSON.stringify(value)}`);
    assert.equal(result.isBackendMessage, false);
  }
});

test("editorialErrorMessage is a thin wrapper over toEditorialError", () => {
  assert.equal(editorialErrorMessage(apiError(409, { error: "Already published." })), "Already published.");
  assert.equal(editorialErrorMessage(new Error("kaboom")), EDITORIAL_GENERIC_ERROR_MESSAGE);
});

test("a 5xx status is classified as a server error even with a well-formed body", () => {
  const result = toEditorialError(apiError(503, { error: "Upstream database unavailable" }));
  assert.equal(result.isServerError, true);
  assert.equal(result.message, EDITORIAL_GENERIC_ERROR_MESSAGE);
});
