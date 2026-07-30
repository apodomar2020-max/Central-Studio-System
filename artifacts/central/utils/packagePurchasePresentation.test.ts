import assert from "node:assert/strict";
import test from "node:test";

import { presentPackagePurchaseError } from "./packagePurchasePresentation";

test("maps participant DOB validation without connection or raw HTTP wording", () => {
  const result = presentPackagePurchaseError({
    data: { code: "PARTICIPANT_DOB_REQUIRED", message: "Date of birth is required." },
  });

  assert.equal(result.title, "Date of birth required");
  assert.match(result.message, /Add this child’s date of birth/);
  assert.doesNotMatch(result.message, /connection|HTTP 409/i);
  assert.equal(result.isNetworkFailure, false);
});

test("retains connection guidance only for actual network failures", () => {
  const result = presentPackagePurchaseError(new TypeError("Network request failed"));

  assert.equal(result.title, "Connection Problem");
  assert.match(result.message, /check your connection/i);
  assert.equal(result.isNetworkFailure, true);
});

test("uses a safe non-network fallback for unknown server failures", () => {
  const result = presentPackagePurchaseError(new Error("HTTP 500: internal detail"));

  assert.equal(result.title, "Request Failed");
  assert.doesNotMatch(result.message, /connection|HTTP 500|internal detail/i);
  assert.equal(result.isNetworkFailure, false);
});
