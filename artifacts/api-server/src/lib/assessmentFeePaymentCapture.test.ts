import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("artifacts/api-server/src/routes/adminBallet.ts");
const detail = read("artifacts/admin/src/pages/ballet/ApplicationDetailPage.tsx");
const shared = read("artifacts/admin/src/pages/ballet/application-detail/shared.tsx");

test("paid assessment fees require canonical tender and a positive evidenced amount", () => {
  assert.match(route, /ASSESSMENT_FEE_PAYMENT_METHODS = \["cash", "card", "kashier", "bank_transfer"\]/);
  assert.match(route, /paymentMethod: z\.enum\(ASSESSMENT_FEE_PAYMENT_METHODS\)/);
  assert.match(route, /amountEgp: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  assert.match(route, /resolvedAmountEgp == null \|\| resolvedAmountEgp <= 0/);
  assert.doesNotMatch(route, /assessmentFeePaymentMethod:\s*isSettled \? "inPerson"/);
});

test("waived and unpaid assessment fees clear settlement evidence", () => {
  assert.match(route, /const paymentMethod = isSettled \? parsed\.data\.paymentMethod : null/);
  assert.match(route, /const paidAt = isSettled \? \(parsed\.data\.paidAt \?\? nowIso\) : null/);
});

test("assessment fee dialog offers only canonical tender methods for paid capture", () => {
  for (const value of ["cash", "card", "kashier", "bank_transfer"]) {
    assert.match(detail, new RegExp(`<SelectItem value="${value}">`));
  }
  assert.doesNotMatch(detail, /<SelectItem value="inPerson">/);
  assert.match(detail, /Evidenced Paid Amount \(EGP\)/);
  assert.match(detail, /body: JSON\.stringify\(vars\)/);
});

test("legacy inPerson values remain displayable as method unspecified", () => {
  assert.match(shared, /inPerson: "Pay at Studio \/ Method unspecified"/);
});
