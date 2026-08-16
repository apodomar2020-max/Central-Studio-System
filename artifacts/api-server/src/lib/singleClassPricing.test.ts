/**
 * Category walk-in pricing — resolver unit tests.
 *
 * resolveSingleClassPriceEgp is deliberately generic over its db client
 * (`Pick<typeof db, "select">`), so it can be exercised here against a fake
 * client that plays back canned rows in call order, with no real Postgres
 * connection needed (mirrors financeReadModel.test.ts's "no @workspace/db
 * import" contract for pure/unit-level coverage).
 *
 * Pins the LOCKED resolution order:
 *   1. schedules.price_egp                                (schedule override)
 *   2. class_pricing_settings.<category>_walkin_price_egp (category price)
 *   3. class_pricing_settings.single_class_price_egp       (legacy fallback)
 *   4. DEFAULT_SINGLE_CLASS_PRICE_EGP                      (hard floor)
 */
import assert from "node:assert/strict";
import test from "node:test";

const load = () => import("./singleClassPricing");

/**
 * A fake `SingleClassPriceClient`: each call to `.select(...)` returns a
 * chainable stub whose terminal `.limit()` resolves to the next canned rows
 * array — in the exact call order resolveSingleClassPriceEgp is documented
 * to issue them (schedule, then class, then settings — skipping whichever
 * steps a given scenario short-circuits past).
 */
function fakeClient(responses: unknown[][]) {
  let call = 0;
  const chain = {
    from() { return chain; },
    where() { return chain; },
    limit() { return Promise.resolve(responses[call++] ?? []); },
  };
  return { select: () => chain } as unknown as import("./singleClassPricing").SingleClassPriceClient;
}

test("schedule override always wins, even when a category price and legacy price both also resolve", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const client = fakeClient([
    [{ priceEgp: 500, classId: 5 }], // schedule select — has an override
  ]);
  const price = await resolveSingleClassPriceEgp(client, { scheduleId: 9, classId: 5 });
  assert.equal(price, 500);
});

test("no schedule override: class's assigned category price is used over the legacy single price", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const client = fakeClient([
    [{ priceEgp: null, classId: 5 }], // schedule select — no override
    [{ pricingCategory: "adults" }], // class select
    [{ singleClassPriceEgp: 300, adultsWalkinPriceEgp: 250, teensWalkinPriceEgp: 200, kidsWalkinPriceEgp: 150 }], // settings
  ]);
  const price = await resolveSingleClassPriceEgp(client, { scheduleId: 9, classId: 5 });
  assert.equal(price, 250);
});

test("teens and kids categories resolve to their own configured price", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const settings = { singleClassPriceEgp: 300, adultsWalkinPriceEgp: 250, teensWalkinPriceEgp: 200, kidsWalkinPriceEgp: 150 };

  const teens = await resolveSingleClassPriceEgp(
    fakeClient([[{ pricingCategory: "teens" }], [settings]]),
    { classId: 6 },
  );
  assert.equal(teens, 200);

  const kids = await resolveSingleClassPriceEgp(
    fakeClient([[{ pricingCategory: "kids" }], [settings]]),
    { classId: 7 },
  );
  assert.equal(kids, 150);
});

test("class has a category assigned, but that category's price is unconfigured (null): falls through to the legacy single price", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const client = fakeClient([
    [{ pricingCategory: "kids" }],
    [{ singleClassPriceEgp: 300, adultsWalkinPriceEgp: 250, teensWalkinPriceEgp: 200, kidsWalkinPriceEgp: null }],
  ]);
  const price = await resolveSingleClassPriceEgp(client, { classId: 7 });
  assert.equal(price, 300);
});

test("class has no assigned pricing category (unaudited/legacy class): falls through to the legacy single price, unchanged from pre-feature behavior", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const client = fakeClient([
    [{ pricingCategory: null }],
    [{ singleClassPriceEgp: 300, adultsWalkinPriceEgp: 250, teensWalkinPriceEgp: 200, kidsWalkinPriceEgp: 150 }],
  ]);
  const price = await resolveSingleClassPriceEgp(client, { classId: 42 });
  assert.equal(price, 300);
});

test("garbage/unrecognized pricing_category value is treated as unassigned, never crashes", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const client = fakeClient([
    [{ pricingCategory: "not-a-real-category" }],
    [{ singleClassPriceEgp: 300, adultsWalkinPriceEgp: 250, teensWalkinPriceEgp: 200, kidsWalkinPriceEgp: 150 }],
  ]);
  const price = await resolveSingleClassPriceEgp(client, { classId: 42 });
  assert.equal(price, 300);
});

test("no class_pricing_settings row at all: hard-coded default floor, never zero/undefined", async () => {
  const { resolveSingleClassPriceEgp, DEFAULT_SINGLE_CLASS_PRICE_EGP } = await load();
  const client = fakeClient([
    [{ pricingCategory: "adults" }],
    [], // settings singleton missing entirely
  ]);
  const price = await resolveSingleClassPriceEgp(client, { classId: 1 });
  assert.equal(price, DEFAULT_SINGLE_CLASS_PRICE_EGP);
});

test("schedule-less booking (classId known, no scheduleId): resolves category directly from the class, no schedule query issued", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const client = fakeClient([
    [{ pricingCategory: "adults" }], // class select is the FIRST call — no schedule select happened
    [{ singleClassPriceEgp: 300, adultsWalkinPriceEgp: 250, teensWalkinPriceEgp: 200, kidsWalkinPriceEgp: 150 }],
  ]);
  const price = await resolveSingleClassPriceEgp(client, { scheduleId: null, classId: 5 });
  assert.equal(price, 250);
});

test("scheduleId given but the schedule row is gone: still resolves via the classId the caller already knew", async () => {
  const { resolveSingleClassPriceEgp } = await load();
  const client = fakeClient([
    [], // schedule select returns nothing (deleted/invalid id)
    [{ pricingCategory: "kids" }],
    [{ singleClassPriceEgp: 300, adultsWalkinPriceEgp: 250, teensWalkinPriceEgp: 200, kidsWalkinPriceEgp: 150 }],
  ]);
  const price = await resolveSingleClassPriceEgp(client, { scheduleId: 999, classId: 7 });
  assert.equal(price, 150);
});

test("isPricingCategory rejects non-category strings and accepts exactly the three supported values", async () => {
  const { isPricingCategory, PRICING_CATEGORIES } = await load();
  for (const category of PRICING_CATEGORIES) {
    assert.equal(isPricingCategory(category), true);
  }
  assert.equal(isPricingCategory("Adults"), false); // case-sensitive — no silent coercion
  assert.equal(isPricingCategory(""), false);
  assert.equal(isPricingCategory(null), false);
  assert.equal(isPricingCategory(undefined), false);
});
