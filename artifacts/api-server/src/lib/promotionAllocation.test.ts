import assert from "node:assert/strict";
import { test } from "node:test";
import { allocatePromotionDiscount as allocate } from "./promotionAllocation";

const cases: Array<[string, number, number[], number[]]> = [
  ["package equal capped", 40000, [32000, 32000], [20000, 20000]],
  ["class equal capped", 30000, [24000, 24000], [15000, 15000]],
  ["unequal capped", 40000, [30000, 20000], [24000, 16000]],
  ["uncapped", 25000, [10000, 15000], [10000, 15000]],
  ["equal remainder", 3, [2, 2], [2, 1]],
  ["three fractional shares", 7, [5, 3, 2], [4, 2, 1]],
  ["single capped", 99, [120], [99]],
  ["all zero", 0, [0, 0], [0, 0]],
  ["zero weight", 1, [0, 2, 2], [0, 1, 0]],
  ["positive weights zero applied", 0, [4, 5], [0, 0]],
  ["one piastre across three", 1, [1, 1, 1], [1, 0, 0]],
  [
    "exact large products",
    Number.MAX_SAFE_INTEGER,
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [4503599627370496, 4503599627370495],
  ],
];
for (const [name, applied, weights, expected] of cases)
  test(name, () => {
    const contributions = weights.map((weightMinor, i) => ({
      promotionId: i + 1,
      weightMinor,
    }));
    const result = allocate(applied, contributions);
    assert.deepEqual(
      contributions.map((c) => result.get(c.promotionId)),
      expected,
    );
    assert.equal(
      [...result.values()].reduce((s, n) => s + BigInt(n), 0n),
      BigInt(applied),
    );
    for (const amount of result.values())
      assert.ok(
        Number.isSafeInteger(amount) && amount >= 0 && amount <= applied,
      );
    const reversed = allocate(applied, [...contributions].reverse());
    assert.deepEqual([...reversed].sort(), [...result].sort());
  });
test("duplicate legacy identity combines weight without adding redemption identity", () => {
  assert.deepEqual(
    allocate(5, [
      { promotionId: 2, weightMinor: 3 },
      { promotionId: 1, weightMinor: 3 },
      { promotionId: 2, weightMinor: 3 },
    ]),
    new Map([
      [2, 3],
      [1, 2],
    ]),
  );
});
test("empty zero allocation", () => assert.equal(allocate(0, []).size, 0));
for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
  test(`invalid minor amount ${amount}`, () => {
    assert.throws(() => allocate(amount, [{ promotionId: 1, weightMinor: 1 }]));
    assert.throws(() => allocate(0, [{ promotionId: 1, weightMinor: amount }]));
  });
test("inconsistent applied discount fails closed", () =>
  assert.throws(() => allocate(2, [{ promotionId: 1, weightMinor: 1 }])));
test("invalid identity fails closed", () =>
  assert.throws(() => allocate(0, [{ promotionId: 0, weightMinor: 0 }])));
