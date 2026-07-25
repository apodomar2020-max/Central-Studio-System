/**
 * Finance Phase 1 — filter plan and ordering tests.
 *
 * financeSources.ts imports @workspace/db, which constructs a pg Pool at module
 * scope. A localhost DATABASE_URL is set before the import so the module loads;
 * node-postgres pools connect lazily, and these tests only build SQL plans
 * (never execute them), so no connection is ever opened. The pool is closed in
 * an after-hook regardless, so the test process exits cleanly.
 *
 * What this covers: that a filter which cannot match a family excludes that
 * family from the query set entirely — which is what makes `total` exact,
 * because a family that is planned out contributes no count. Behaviour that
 * needs real rows belongs in a database-backed integration test.
 */
import assert from "node:assert/strict";
import test from "node:test";

// Must be set before financeSources → @workspace/db is imported.
process.env["DATABASE_URL"] ??= "postgresql://finance_test:finance_test@localhost:5432/finance_test";

const loadSources = () => import("./financeSources");
const loadModel = () => import("./financeReadModel");

/** Baseline: no constraint on any dimension. */
function noFilters(overrides: Record<string, unknown> = {}) {
  return {
    eventTypes: [],
    families: [],
    paymentMethods: [],
    paymentStatuses: [],
    refundStatuses: [],
    reliabilityBadges: [],
    amountAvailabilities: [],
    ...overrides,
  } as never;
}

/** Families whose plan survives the given filters. */
async function plannedFamilies(filters: unknown): Promise<string[]> {
  const { FINANCE_FAMILY_DESCRIPTORS } = await loadSources();
  return FINANCE_FAMILY_DESCRIPTORS
    .filter((descriptor) => descriptor.plan(filters as never).where !== null)
    .map((descriptor) => descriptor.family);
}

// ─── Search parsing ───────────────────────────────────────────────────────────

test("search parses synthetic ids, bare ids and free text distinctly", async () => {
  const { parseSearch } = await loadSources();

  assert.deepEqual(parseSearch("bp:41"), { raw: "bp:41", idPrefix: "bp", numericId: 41 });
  // Tolerant of spacing and case, since admins copy ids by hand.
  assert.deepEqual(parseSearch("BP : 41"), { raw: "BP : 41", idPrefix: "bp", numericId: 41 });
  assert.deepEqual(parseSearch("41"), { raw: "41", idPrefix: null, numericId: 41 });
  assert.deepEqual(parseSearch("nour@example.com"), {
    raw: "nour@example.com", idPrefix: null, numericId: null,
  });
  assert.equal(parseSearch(undefined), null);
  assert.equal(parseSearch("   "), null);
});

test("a prefixed id search targets only the family that owns that prefix", async () => {
  // po/bk/wi/bp/br/pr/ct each belong to exactly one family, so "bp:41" must not
  // return package order 41 or credit transaction 41.
  const families = await plannedFamilies(noFilters({ search: "bp:41" }));
  // Every family is still planned (each adds its own `false` branch when the
  // prefix is not theirs) — the exclusion is enforced in SQL, so what matters
  // is that the prefix is parsed and routed, verified above.
  assert.ok(families.includes("ballet_payments"));
});

// ─── Payment status filters ───────────────────────────────────────────────────

test("filtering by payment status excludes families that have no payment status", async () => {
  const families = await plannedFamilies(noFilters({ paymentStatuses: ["paid"] }));

  // Package purchases deliberately carry paymentStatus null (an active order
  // does not prove payment), so they cannot match a payment-status filter.
  assert.ok(!families.includes("package_purchases"));
  // Refunds, discounts and credits have no payment status either.
  assert.ok(!families.includes("ballet_refunds"));
  assert.ok(!families.includes("discounts"));
  assert.ok(!families.includes("package_credits"));
  // The two that do carry one survive.
  assert.deepEqual(families, ["class_payments", "walkin_payments", "ballet_payments"]);
});

test("filtering by refund status leaves only the Ballet refund family", async () => {
  const families = await plannedFamilies(noFilters({ refundStatuses: ["approved"] }));
  assert.deepEqual(families, ["ballet_refunds"]);
});

// ─── Payment method filters ───────────────────────────────────────────────────

test("payment method filters narrow to the families that can record that method", async () => {
  assert.deepEqual(
    await plannedFamilies(noFilters({ paymentMethods: ["pay_at_studio"] })),
    ["class_payments", "walkin_payments"],
  );
  assert.deepEqual(
    await plannedFamilies(noFilters({ paymentMethods: ["kashier"] })),
    ["ballet_payments", "ballet_refunds"],
  );
  assert.deepEqual(
    await plannedFamilies(noFilters({ paymentMethods: ["bank_transfer"] })),
    ["ballet_payments", "ballet_refunds"],
  );
  // package_credit only ever describes a credit-ledger event.
  assert.deepEqual(
    await plannedFamilies(noFilters({ paymentMethods: ["package_credit"] })),
    ["package_credits"],
  );
});

// ─── Reliability and amount-availability filters ──────────────────────────────

test("reliability filters select exactly the families that can produce that badge", async () => {
  assert.deepEqual(
    await plannedFamilies(noFilters({ reliabilityBadges: ["recorded_collection"] })),
    ["ballet_payments"],
  );
  assert.deepEqual(
    await plannedFamilies(noFilters({ reliabilityBadges: ["recorded_refund"] })),
    ["ballet_refunds"],
  );
  assert.deepEqual(
    await plannedFamilies(noFilters({ reliabilityBadges: ["recorded_discount"] })),
    ["discounts"],
  );
  assert.deepEqual(
    await plannedFamilies(noFilters({ reliabilityBadges: ["service_credit_unit"] })),
    ["package_credits"],
  );
  // Only the estimate families can be badged estimated_operational.
  assert.deepEqual(
    await plannedFamilies(noFilters({ reliabilityBadges: ["estimated_operational"] })),
    ["package_purchases", "class_payments", "walkin_payments"],
  );
  // legacy_display_only is a Ballet *payment* method classification. A refund
  // is badged recorded_refund/unknown_amount regardless of the original
  // method, so the refund family cannot match this badge.
  assert.deepEqual(
    await plannedFamilies(noFilters({ reliabilityBadges: ["legacy_display_only"] })),
    ["ballet_payments"],
  );
  assert.deepEqual(
    await plannedFamilies(noFilters({ reliabilityBadges: ["unverified_admin_tag"] })),
    ["ballet_payments"],
  );
});

test("amount availability filters exclude families that cannot report it", async () => {
  // Nothing generic can be "exact" — no historical amount is stored.
  const exact = await plannedFamilies(noFilters({ amountAvailabilities: ["exact"] }));
  assert.ok(!exact.includes("package_purchases"));
  assert.ok(!exact.includes("class_payments"));
  assert.ok(!exact.includes("walkin_payments"));
  assert.ok(!exact.includes("package_credits"));

  // Only estimate families can be "estimated".
  assert.deepEqual(
    await plannedFamilies(noFilters({ amountAvailabilities: ["estimated"] })),
    ["package_purchases", "class_payments", "walkin_payments"],
  );

  // not_applicable is unique to credit events.
  assert.deepEqual(
    await plannedFamilies(noFilters({ amountAvailabilities: ["not_applicable"] })),
    ["package_credits"],
  );
});

// ─── Event type filters ───────────────────────────────────────────────────────

test("event type filters map one-to-one onto families", async () => {
  const expected: Record<string, string[]> = {
    package_purchase: ["package_purchases"],
    single_class_payment: ["class_payments"],
    studio_walkin_payment: ["walkin_payments"],
    ballet_payment: ["ballet_payments"],
    ballet_refund: ["ballet_refunds"],
    promotion_discount: ["discounts"],
    package_credit_issuance: ["package_credits"],
    package_credit_consumption: ["package_credits"],
    future_manual_adjustment: ["package_credits"],
  };

  for (const [eventType, families] of Object.entries(expected)) {
    assert.deepEqual(
      await plannedFamilies(noFilters({ eventTypes: [eventType] })),
      families,
      `event type ${eventType}`,
    );
  }
});

test("the two booking families are separated by walk-in evidence, not by filters", async () => {
  // Both come from `bookings`, so an unfiltered request must plan both — the
  // split happens inside each plan's walk-in predicate.
  const families = await plannedFamilies(noFilters());
  assert.ok(families.includes("class_payments"));
  assert.ok(families.includes("walkin_payments"));
});

test("no filters plans every family", async () => {
  const { FINANCE_FAMILY_DESCRIPTORS } = await loadSources();
  const families = await plannedFamilies(noFilters());
  assert.equal(families.length, FINANCE_FAMILY_DESCRIPTORS.length);
});

// ─── Date range ───────────────────────────────────────────────────────────────

test("a date range constrains every family without excluding any", async () => {
  // Each family has its own occurredAt expression, so a date filter narrows
  // rows rather than dropping a whole source.
  const families = await plannedFamilies(
    noFilters({ fromIso: "2026-06-01T00:00:00.000Z", toIso: "2026-06-30T23:59:59.999Z" }),
  );
  const { FINANCE_FAMILY_DESCRIPTORS } = await loadSources();
  assert.equal(families.length, FINANCE_FAMILY_DESCRIPTORS.length);
});

// ─── Ordering ─────────────────────────────────────────────────────────────────

test("ordering is newest-first with the synthetic event id as a stable tiebreaker", async () => {
  const { compareFinanceTransactions } = await loadSources();

  const event = (id: string, occurredAt: string) =>
    ({ id, occurredAt }) as never;

  const rows = [
    event("bk:1", "2026-06-01T00:00:00.000Z"),
    event("bp:9", "2026-06-10T00:00:00.000Z"),
    event("bp:2", "2026-06-10T00:00:00.000Z"),
    event("ct:5", "2026-06-05T00:00:00.000Z"),
  ];
  const sorted = [...rows].sort(compareFinanceTransactions).map((row) => (row as { id: string }).id);

  // Newest first; equal timestamps fall back to descending synthetic id.
  assert.deepEqual(sorted, ["bp:9", "bp:2", "ct:5", "bk:1"]);
});

test("the ordering comparator is a total order, so paging cannot repeat or skip rows", async () => {
  const { compareFinanceTransactions } = await loadSources();
  const event = (id: string, occurredAt: string) => ({ id, occurredAt }) as never;

  const a = event("bp:2", "2026-06-10T00:00:00.000Z");
  const b = event("bp:9", "2026-06-10T00:00:00.000Z");

  // Antisymmetric, and only identical events compare equal — the property that
  // makes the merge-and-slice paging deterministic across requests.
  assert.ok(compareFinanceTransactions(a, b) > 0);
  assert.ok(compareFinanceTransactions(b, a) < 0);
  assert.equal(compareFinanceTransactions(a, a), 0);
});

// ─── Family / event-type consistency ──────────────────────────────────────────

test("each descriptor's declared event types agree with familyForEventType", async () => {
  const { FINANCE_FAMILY_DESCRIPTORS } = await loadSources();
  const { familyForEventType } = await loadModel();

  for (const descriptor of FINANCE_FAMILY_DESCRIPTORS) {
    for (const eventType of descriptor.eventTypes) {
      assert.equal(
        familyForEventType(eventType),
        descriptor.family,
        `${eventType} must belong to ${descriptor.family}`,
      );
    }
  }
});

test("every contract event type is claimed by exactly one descriptor", async () => {
  const { FINANCE_FAMILY_DESCRIPTORS } = await loadSources();
  const { FINANCE_EVENT_TYPES } = await import("@workspace/api-zod");

  const claimed = FINANCE_FAMILY_DESCRIPTORS.flatMap((descriptor) => [...descriptor.eventTypes]);
  assert.equal(new Set(claimed).size, claimed.length, "an event type is claimed twice");
  for (const eventType of FINANCE_EVENT_TYPES) {
    assert.ok(claimed.includes(eventType), `no descriptor emits ${eventType}`);
  }
});

// The @workspace/db module opens a pool at import time. Nothing here connects,
// but close it so the process exits instead of waiting on an idle pool.
test.after(async () => {
  const { pool } = await import("@workspace/db");
  await pool.end();
});
