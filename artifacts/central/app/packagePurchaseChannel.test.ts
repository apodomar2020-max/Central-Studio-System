/**
 * R4 / F-06 correction: every live Mobile package-purchase entry point
 * must send an explicit, identical paymentMode — since Online Payment is
 * disabled everywhere, "pay_at_studio" is the only real channel, and an
 * omitted paymentMode previously landed as requestedPaymentChannel:
 * "unknown" in Finance for the exact same business action.
 *
 * app/(tabs)/index.tsx and app/(tabs)/packages.tsx are Expo Router
 * screens that cannot be imported into a plain Node test process — this
 * follows the repo's established source-assertion convention (see
 * artifacts/api-server/src/routes/bookingPriceBinding.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const HOME_SCREEN = "artifacts/central/app/(tabs)/index.tsx";
const PACKAGES_SCREEN = "artifacts/central/app/(tabs)/packages.tsx";

function purchasePackageCallBody(source: string): string {
  const start = source.indexOf("await purchasePackage({");
  assert.notEqual(start, -1, "expected a purchasePackage({ ... }) call");
  const end = source.indexOf("});", start);
  return source.slice(start, end);
}

for (const path of [HOME_SCREEN, PACKAGES_SCREEN]) {
  test(`${path}: purchasePackage() explicitly sends paymentMode: "pay_at_studio"`, () => {
    const body = purchasePackageCallBody(read(path));
    assert.match(
      body,
      /paymentMode:\s*"pay_at_studio"/,
      `${path} must send an explicit paymentMode so Finance never records "unknown" for this purchase`,
    );
  });
}

test("both entry points send the exact same paymentMode value", () => {
  const homeBody = purchasePackageCallBody(read(HOME_SCREEN));
  const packagesBody = purchasePackageCallBody(read(PACKAGES_SCREEN));

  const extract = (body: string) => body.match(/paymentMode:\s*"([^"]+)"/)?.[1];
  assert.equal(extract(homeBody), extract(packagesBody));
  assert.equal(extract(homeBody), "pay_at_studio");
});

test("the Packages tab's participant selection and promo code are unchanged by this correction", () => {
  const body = purchasePackageCallBody(read(PACKAGES_SCREEN));
  assert.match(body, /promoCode,/);
  assert.match(body, /participant,/);
});
