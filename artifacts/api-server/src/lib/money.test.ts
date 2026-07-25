import assert from "node:assert/strict";
import test from "node:test";
import { MoneyValidationError, egpToMinor, minorToEgp } from "./money";

// ─── Locked conversion cases ────────────────────────────────────────────────

test("minorToEgp(15050) = 150.5", () => {
  assert.equal(minorToEgp(15050), 150.5);
});

test("minorToEgp(9999) = 99.99", () => {
  assert.equal(minorToEgp(9999), 99.99);
});

test("minorToEgp(10000) = 100", () => {
  assert.equal(minorToEgp(10000), 100);
});

test("egpToMinor(150.505) = 15051", () => {
  // 150.505 * 100 === 15050.5 exactly in IEEE 754 double precision;
  // Math.round rounds half-up, so this locks to 15051, not 15050.
  assert.equal(egpToMinor(150.505), 15051);
});

test("egpToMinor(150.5) = 15050", () => {
  assert.equal(egpToMinor(150.5), 15050);
});

test("egpToMinor(99.99) = 9999", () => {
  assert.equal(egpToMinor(99.99), 9999);
});

test("egpToMinor(0) = 0", () => {
  assert.equal(egpToMinor(0), 0);
});

// ─── Rejection cases ────────────────────────────────────────────────────────

test("egpToMinor rejects negative EGP", () => {
  assert.throws(() => egpToMinor(-1), MoneyValidationError);
});

test("minorToEgp rejects negative minor units", () => {
  assert.throws(() => minorToEgp(-1), MoneyValidationError);
});

test("egpToMinor rejects NaN", () => {
  assert.throws(() => egpToMinor(NaN), MoneyValidationError);
});

test("minorToEgp rejects NaN", () => {
  assert.throws(() => minorToEgp(NaN), MoneyValidationError);
});

test("egpToMinor rejects Infinity", () => {
  assert.throws(() => egpToMinor(Infinity), MoneyValidationError);
  assert.throws(() => egpToMinor(-Infinity), MoneyValidationError);
});

test("minorToEgp rejects Infinity", () => {
  assert.throws(() => minorToEgp(Infinity), MoneyValidationError);
  assert.throws(() => minorToEgp(-Infinity), MoneyValidationError);
});

test("minorToEgp rejects non-integer minor units", () => {
  assert.throws(() => minorToEgp(150.5), MoneyValidationError);
  assert.throws(() => minorToEgp(0.1), MoneyValidationError);
});

test("egpToMinor rejects a value whose converted result exceeds Number.MAX_SAFE_INTEGER", () => {
  // (MAX_SAFE_INTEGER / 100) * 10 EGP converts to well beyond the safe range.
  const tooLargeEgp = (Number.MAX_SAFE_INTEGER / 100) * 10;
  assert.throws(() => egpToMinor(tooLargeEgp), MoneyValidationError);
});

test("minorToEgp rejects an unsafe-integer minor-unit input", () => {
  assert.throws(() => minorToEgp(Number.MAX_SAFE_INTEGER + 2), MoneyValidationError);
});

// ─── Round-trip and roundMoney() boundary parity ───────────────────────────

test("values with up to two decimal places round-trip through egpToMinor/minorToEgp", () => {
  const cases = [0, 1, 1.5, 1.05, 1.5, 12.34, 99.99, 150.5, 999.99, 1000, 4999.99];
  for (const egp of cases) {
    assert.equal(minorToEgp(egpToMinor(egp)), egp, `round-trip failed for ${egp}`);
  }
});

test("egpToMinor matches promotionService.ts's roundMoney() boundary for representative fractional package/promotion values", () => {
  // roundMoney(value) = Math.round(value * 100) / 100 — the existing
  // rounding function this helper is deliberately matched against. For any
  // value already passed through roundMoney(), egpToMinor's own rounding
  // must reproduce the identical cent value (i.e. egpToMinor(roundMoney(v))
  // === Math.round(v * 100)), proving both functions round the same
  // fractional inputs to the same boundary rather than silently disagreeing
  // by a cent on some inputs.
  const roundMoney = (value: number): number => Math.round(value * 100) / 100;

  const representativeValues = [
    499.995, // half-cent package price after a percentage discount
    150.505, // the locked edge case from the spec
    33.333, // a 1/3-style percentage-discount remainder
    1250.005,
    0.005,
  ];

  for (const raw of representativeValues) {
    const rounded = roundMoney(raw);
    assert.equal(egpToMinor(rounded), Math.round(raw * 100), `boundary mismatch for ${raw}`);
  }
});
