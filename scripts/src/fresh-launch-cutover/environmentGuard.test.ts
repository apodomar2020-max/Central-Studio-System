import assert from "node:assert/strict";
import test from "node:test";
import { redactDatabaseUrl, validateCutoverEnvironment } from "./environmentGuard";

const valid = {
  rehearsalFlag: "I_UNDERSTAND_THIS_IS_LOCAL_AND_DISPOSABLE",
  sourceUrl: "postgresql://tester:secret@127.0.0.1:5432/central_cutover_source_unit",
  targetUrl: "postgresql://tester:secret@localhost:5432/central_cutover_target_unit",
  env: {},
};

test("accepts distinct disposable loopback databases", () => {
  const result = validateCutoverEnvironment(valid);
  assert.equal(result.source.hostname, "127.0.0.1");
});

test("accepts IPv6 loopback", () => {
  assert.doesNotThrow(() => validateCutoverEnvironment({
    ...valid,
    sourceUrl: "postgresql://tester:secret@[::1]:5432/central_cutover_source_unit",
  }));
});

test("accepts an explicit local Unix socket", () => {
  assert.doesNotThrow(() => validateCutoverEnvironment({
    ...valid,
    sourceUrl: "postgresql://tester@/central_cutover_source_unit?host=%2Ftmp",
  }));
});

for (const [name, patch] of [
  ["missing flag", { rehearsalFlag: undefined }],
  ["remote source", { sourceUrl: "postgresql://u:p@db.example.com/central_cutover_source_unit" }],
  ["remote target", { targetUrl: "postgresql://u:p@10.0.0.8/central_cutover_target_unit" }],
  ["remote IPv6 target", { targetUrl: "postgresql://u:p@[2001:db8::1]/central_cutover_target_unit" }],
  ["wrong source prefix", { sourceUrl: "postgresql://u:p@localhost/not_source" }],
  ["wrong target prefix", { targetUrl: "postgresql://u:p@localhost/not_target" }],
  ["same database", { targetUrl: valid.sourceUrl }],
  ["production marker", { targetUrl: "postgresql://u:p@localhost/central_cutover_target_production" }],
  ["missing database", { targetUrl: "postgresql://u:p@localhost/" }],
  ["malformed URL", { targetUrl: "not-a-url" }],
  ["Railway marker", { env: { RAILWAY_PROJECT_ID: "synthetic" } }],
] as const) {
  test(`rejects ${name}`, () => assert.throws(() => validateCutoverEnvironment({ ...valid, ...patch })));
}

test("redacts credentials and query strings", () => {
  const redacted = redactDatabaseUrl("postgresql://private_user:private_password@localhost:5432/central_cutover_source_x?sslpassword=hidden");
  assert.equal(redacted.includes("private_user"), false);
  assert.equal(redacted.includes("private_password"), false);
  assert.equal(redacted.includes("hidden"), false);
});
