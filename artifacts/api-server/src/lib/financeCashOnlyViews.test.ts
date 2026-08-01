/**
 * H6 regression coverage: monetary Finance pages must never include service
 * credit unit movements. The credit ledger itself remains available to the
 * operational package/student history surfaces.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { FinanceSourceFamily } from "@workspace/api-zod";
import {
  MONETARY_FINANCE_EVENT_TYPES,
  MONETARY_FINANCE_FAMILIES,
  resolveMonetaryRequestScope,
  type FinanceScopeRequest,
} from "./financeAccess";

const EMPTY_REQUEST: FinanceScopeRequest = {
  eventType: [],
  eventNature: [],
  source: [],
  family: [],
};

const ALL_FAMILIES: FinanceSourceFamily[] = [
  "package_purchases",
  "class_payments",
  "walkin_payments",
  "ballet_payments",
  "ballet_refunds",
  "discounts",
  "package_credits",
];

const SERVICE_CREDIT_TYPES = [
  "package_credit_issuance",
  "package_credit_consumption",
  "future_manual_adjustment",
] as const;

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("the monetary Finance scope includes payment/refund/discount families but excludes package credits", () => {
  const scope = resolveMonetaryRequestScope(EMPTY_REQUEST, ALL_FAMILIES);

  assert.deepEqual(scope.families, MONETARY_FINANCE_FAMILIES);
  assert.deepEqual(scope.eventTypes, MONETARY_FINANCE_EVENT_TYPES);
  assert.ok(scope.eventTypes.includes("package_purchase"));
  assert.ok(scope.eventTypes.includes("single_class_payment"));
  assert.ok(scope.eventTypes.includes("studio_walkin_payment"));
  assert.ok(scope.eventTypes.includes("ballet_payment"));
  assert.ok(scope.eventTypes.includes("ballet_refund"));
  assert.ok(scope.eventTypes.includes("promotion_discount"));
  assert.ok(!(scope.families as readonly string[]).includes("package_credits"));
  for (const eventType of SERVICE_CREDIT_TYPES) assert.ok(!scope.eventTypes.includes(eventType));
});

test("client filters cannot reintroduce service-credit rows into a monetary endpoint", () => {
  const attempts: FinanceScopeRequest[] = [
    { ...EMPTY_REQUEST, family: ["package_credits"] },
    { ...EMPTY_REQUEST, source: ["credit_transactions"] },
    { ...EMPTY_REQUEST, eventNature: ["service_credit"] },
    { ...EMPTY_REQUEST, eventType: ["package_credit_consumption"] },
  ];

  for (const request of attempts) {
    const scope = resolveMonetaryRequestScope(request, ALL_FAMILIES);
    assert.deepEqual(scope.families, []);
    assert.deepEqual(scope.eventTypes, []);
  }
});

test("Transactions and exports use the monetary scope before querying and pagination", () => {
  const route = read("artifacts/api-server/src/routes/finance.ts");
  const calls = route.match(/resolveMonetaryRequestScope\(parsed\.data, visibleFamilies\)/g) ?? [];
  assert.equal(calls.length, 2, "transactions and export must both use the monetary boundary");
  assert.match(route, /queryFinanceTransactions\(scope\.families, filters, page, limit\)/);
  assert.match(route, /queryFinanceTransactionsForExport\(\s*scope\.families/);
});

test("Package Payments requests only package purchase rows", () => {
  const pages = read("artifacts/admin/src/pages/finance/FinanceSourcePages.tsx");
  const packagePage = pages.slice(
    pages.indexOf("export function FinancePackagesPage"),
    pages.indexOf("export function FinanceClassPaymentsPage"),
  );

  assert.match(packagePage, /lockedFamilies=\{\["package_purchases"\]\}/);
  assert.match(packagePage, /allowedEventTypes=\{\["package_purchase"\]\}/);
  assert.doesNotMatch(packagePage, /package_credit_issuance|package_credit_consumption|future_manual_adjustment/);
});

test("Transactions offers only monetary event types and never a service-credit nature", () => {
  const page = read("artifacts/admin/src/pages/finance/FinanceTransactionsPage.tsx");
  for (const eventType of SERVICE_CREDIT_TYPES) assert.doesNotMatch(page, new RegExp(eventType));
  assert.doesNotMatch(page, /allowedEventNatures=\{\[[^\]]*service_credit/);
  assert.match(page, /allowedEventTypes=\{\[[\s\S]*?"package_purchase"/);
  assert.match(page, /allowedEventTypes=\{\[[\s\S]*?"ballet_refund"/);
});

test("credit activity remains available outside monetary Finance pages", () => {
  const adminCredits = read("artifacts/api-server/src/routes/adminCredits.ts");
  const myRoutes = read("artifacts/api-server/src/routes/myRoutes.ts");
  const studentDetail = read("artifacts/admin/src/pages/student-detail.tsx");

  assert.match(adminCredits, /from\(creditTransactionsTable\)/);
  assert.match(myRoutes, /from\(creditTransactionsTable\)/);
  assert.match(studentDetail, /creditTransactions\.map/);
});

test("Finance Overview remains based on canonical monetary aggregates, not credit transactions", () => {
  const overview = read("artifacts/api-server/src/lib/financeOverview.ts");
  assert.match(overview, /getFinancialAggregates\(\)/);
  assert.doesNotMatch(overview, /creditTransactionsTable|credit_transactions/);
});
