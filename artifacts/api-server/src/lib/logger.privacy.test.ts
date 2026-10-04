import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorForLog } from "./logger";
test("error serialization never includes provider/SQL payloads or nested causes", () => {
  const error = Object.assign(new Error("synthetic-private-medical-and-token"), { params: ["synthetic-private"], cause: new Error("synthetic-private") });
  const output = safeErrorForLog(error);
  assert.equal(JSON.stringify(output).includes("synthetic-private"), false);
  assert.match(output.stack ?? "", /at /);
  assert.equal(output.type, "Error");
});
