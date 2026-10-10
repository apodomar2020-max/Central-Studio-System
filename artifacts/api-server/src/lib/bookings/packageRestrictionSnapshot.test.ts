import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePackageRestrictionSnapshot as evaluate } from "./packageRestrictionSnapshot";

for (const state of [null, "restricted"]) {
  test(`saved restricted IDs enforce original styles (${state ?? "legacy"})`, () => {
    const order = { allowedDanceTypeIdsSnapshot: [11, 12], danceTypeRestrictionStateSnapshot: state };
    assert.deepEqual(evaluate(order, 11), { ok: true });
    assert.equal(evaluate(order, 13).ok, false);
    assert.equal(evaluate(order, null).ok, false);
  });
}
test("explicitly unrestricted requires affirmative state plus empty snapshot", () => {
  assert.deepEqual(evaluate({ allowedDanceTypeIdsSnapshot: [], danceTypeRestrictionStateSnapshot: "unrestricted" }, 99), { ok: true });
  assert.deepEqual(evaluate({ allowedDanceTypeIdsSnapshot: [], danceTypeRestrictionStateSnapshot: "unrestricted" }, null), { ok: true });
});
for (const [label, ids, state] of [
  ["missing", null, null], ["legacy empty", [], null],
  ["restricted empty", [], "restricted"], ["unrestricted missing", null, "unrestricted"],
  ["contradictory", [11], "unrestricted"], ["invalid state", [11], "unknown"],
  ["zero ID", [0], null], ["negative ID", [-1], null],
  ["null array member", [null], null],
] as const) {
  test(`${label} evidence fails closed, never unrestricted`, () => {
    const result = evaluate({ allowedDanceTypeIdsSnapshot: ids as number[] | null, danceTypeRestrictionStateSnapshot: state }, 11);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PACKAGE_CREDIT_INTEGRITY_MISMATCH");
  });
}
