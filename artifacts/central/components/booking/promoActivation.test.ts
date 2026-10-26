import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingPromoActivationCode } from "./promoActivation";
test("entered code survives an automatic-winning quote with no selected code", () => {
  const quote = { promotionCode: null, finalSubtotal: 240 };
  assert.equal(quote.promotionCode, null);
  assert.equal(
    bookingPromoActivationCode("pay_at_studio", " manual10 "),
    "MANUAL10",
  );
});
test("package-credit and unsupported payment modes never carry an activation code", () => {
  for (const mode of ["package_credit", "free", "online_payment"])
    assert.equal(bookingPromoActivationCode(mode, "MANUAL10"), undefined);
});
test("empty activation is omitted for a normal undiscounted class booking", () => {
  assert.equal(bookingPromoActivationCode("pay_at_studio", "   "), undefined);
});
