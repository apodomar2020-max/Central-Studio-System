import assert from "node:assert/strict";
import { test } from "node:test";
import { changePromotionCondition, readPromotionConditions, validatePromotionConditions } from "./promotionConditions";

test("existing condition values round trip without normalization or omitted-value defaults", () => {
  const rules = { verifiedStudentOnly: false, minimumBasketAmount: 0, branches: ["Main", "Giza"], maxGlobalUses: 2, maxUsesPerUser: 1 };
  assert.deepEqual(validatePromotionConditions(JSON.stringify(rules)), rules);
  assert.deepEqual(validatePromotionConditions("{}"), {});
});
test("changing one field preserves every other condition and legacy key", () => {
  const next = changePromotionCondition('{"legacyFlag":true,"packageIds":[7],"maxGlobalUses":2}', "minimumBasketAmount", 12.75);
  assert.deepEqual(readPromotionConditions(next), { legacyFlag: true, packageIds: [7], maxGlobalUses: 2, minimumBasketAmount: 12.75 });
  assert.throws(() => validatePromotionConditions(next), /legacyFlag/);
});
test("explicitly clearing a limit removes only that limit", () => {
  assert.deepEqual(readPromotionConditions(changePromotionCondition('{"maxGlobalUses":2,"maxUsesPerUser":1}', "maxGlobalUses", undefined)), { maxUsesPerUser: 1 });
});
test("malformed or non-object legacy conditions fail closed", () => {
  for (const value of ["null", "[]", "true", "{broken"]) assert.throws(() => readPromotionConditions(value));
});
test("invalid counts and types cannot become a broader valid promotion", () => {
  for (const value of [0, -1, 1.5, 2147483648, null, "2"]) assert.throws(() => validatePromotionConditions(JSON.stringify({ maxGlobalUses: value })));
  for (const value of [-1, null, "10"]) assert.throws(() => validatePromotionConditions(JSON.stringify({ minimumBasketAmount: value })));
});
test("package/branch/boolean validation matches the existing contract", () => {
  for (const rules of [{ packageIds: [0] }, { branches: [""] }, { branches: ["A\0B"] }, { verifiedStudentOnly: "true" }]) assert.throws(() => validatePromotionConditions(JSON.stringify(rules)));
});

test("obsolete package conditions remain readable but cannot be saved, even empty or false", () => { for(const rules of [{packageIds:[7]},{packageIds:[]},{firstPackagePurchaseOnly:true},{firstPackagePurchaseOnly:false}]) { const raw=JSON.stringify(rules); assert.deepEqual(readPromotionConditions(raw),rules); assert.throws(()=>validatePromotionConditions(raw),/preserved|incompatible/i); } });
