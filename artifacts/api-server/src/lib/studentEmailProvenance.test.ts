/**
 * Phase B3B0-1A — pure-function tests for student email-provenance
 * fingerprinting. No database required.
 */
import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";

const ORIGINAL_PEPPER = process.env.IDENTITY_PROVENANCE_PEPPER;

beforeEach(() => {
  process.env.IDENTITY_PROVENANCE_PEPPER = "test-provenance-pepper".padEnd(64, "0");
});
afterEach(() => {
  if (ORIGINAL_PEPPER === undefined) delete process.env.IDENTITY_PROVENANCE_PEPPER;
  else process.env.IDENTITY_PROVENANCE_PEPPER = ORIGINAL_PEPPER;
});

test("item 2: fingerprint is deterministic for the same input", async () => {
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  const a = fingerprintStudentEmail("person@example.com");
  const b = fingerprintStudentEmail("person@example.com");
  assert.equal(a, b);
});

test("item 3: different normalized emails produce different fingerprints", async () => {
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  const a = fingerprintStudentEmail("person@example.com");
  const b = fingerprintStudentEmail("other@example.com");
  assert.notEqual(a, b);
});

test("item 4: case/whitespace-equivalent emails fingerprint equally", async () => {
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  const a = fingerprintStudentEmail(" Foo@Bar.com ");
  const b = fingerprintStudentEmail("foo@bar.com");
  assert.equal(a, b);
});

test("item 21: stored format matches v1:k1:<64 lowercase hex>", async () => {
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  const fp = fingerprintStudentEmail("versioned@example.com");
  assert.match(fp, /^v1:k1:[0-9a-f]{64}$/);
});

test("item 24: equivalent normalized emails fingerprint identically under new format", async () => {
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  const a = fingerprintStudentEmail(" Casing@Example.com ");
  const b = fingerprintStudentEmail("casing@example.com");
  assert.equal(a, b);
  assert.match(a, /^v1:k1:[0-9a-f]{64}$/);
});

test("item 26: same email under same key deterministic", async () => {
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  assert.equal(fingerprintStudentEmail("det@example.com"), fingerprintStudentEmail("det@example.com"));
});

test("item 27: v/k/digest segments parse independently", async () => {
  const { fingerprintStudentEmail, parseStoredFingerprint } = await import("./studentEmailProvenance");
  const fp = fingerprintStudentEmail("parse@example.com");
  const parsed = parseStoredFingerprint(fp);
  assert.ok(parsed);
  assert.equal(parsed!.version, "v1");
  assert.equal(parsed!.keyId, "k1");
  assert.match(parsed!.digest, /^[0-9a-f]{64}$/);
  // A malformed/legacy "v1:<hex>" (no k-segment) must fail to parse.
  assert.equal(parseStoredFingerprint("v1:" + "a".repeat(64)), null);
  assert.equal(parseStoredFingerprint("v1:xyz:" + "a".repeat(64)), null);
});

test("item 1: reuses the canonical normalizeEmail (not reimplemented)", async () => {
  const { normalizeEmail } = await import("./membershipIdentity");
  const mod = await import("./studentEmailProvenance");
  // Indirect proof: fingerprinting two raw forms that normalizeEmail treats
  // as equal produces the same fingerprint, AND the module imports
  // normalizeEmail from membershipIdentity (source-level check below).
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("./studentEmailProvenance.ts", import.meta.url), "utf8");
  assert.match(source, /import\s*\{\s*normalizeEmail\s*\}\s*from\s*"\.\/membershipIdentity"/);
  assert.equal(normalizeEmail(" A@B.com "), "a@b.com");
  assert.equal(mod.fingerprintStudentEmail("A@B.com"), mod.fingerprintStudentEmail(" a@b.com "));
});

test("item 8: missing pepper fails an actual fingerprint attempt closed", async () => {
  delete process.env.IDENTITY_PROVENANCE_PEPPER;
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  assert.throws(() => fingerprintStudentEmail("fails-closed@example.com"));
});

test("fingerprint never contains studentId-derived variance (same email, different callers, same result)", async () => {
  const { fingerprintStudentEmail } = await import("./studentEmailProvenance");
  const a = fingerprintStudentEmail("shared@example.com");
  const b = fingerprintStudentEmail("shared@example.com");
  assert.equal(a, b, "fingerprint must depend only on the normalized email, never on any per-student context");
});
