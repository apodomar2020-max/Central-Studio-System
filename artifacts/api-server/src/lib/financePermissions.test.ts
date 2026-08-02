/**
 * Finance Phase 1 — permission and request-scope tests.
 *
 * These cover the security boundary of the unified endpoint: an admin must only
 * ever receive event-source families they already have permission to view, and
 * that filtering must happen BEFORE totals and pagination are computed.
 *
 * The logic under test lives in lib/financeAccess.ts precisely so it can be
 * exercised without a database: no @workspace/db import, no pool, no teardown
 * (same contract as financialAggregates.test.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
const loadAccess = () => import("./financeAccess");
const loadPermissions = () => import("@workspace/api-zod");

// ─── Admin fixtures ───────────────────────────────────────────────────────────

/**
 * FinanceAccessSubject is structural, so a permission map plus the Super Admin
 * flag is the whole authorization-relevant surface of an admin.
 */
function admin(permissions: Record<string, Record<string, boolean>>, isSuperAdmin = false) {
  return { isSuperAdmin, permissions };
}

const EMPTY_QUERY = {
  eventType: [] as never[],
  eventNature: [] as never[],
  source: [] as never[],
  family: [] as never[],
};

// ─── Family visibility ────────────────────────────────────────────────────────

test("Super Admin sees every finance source family", async () => {
  const { resolveVisibleFamilies } = await loadAccess();
  const { FINANCE_SOURCE_FAMILIES } = await loadPermissions();
  assert.deepEqual(resolveVisibleFamilies(admin({}, true)), [...FINANCE_SOURCE_FAMILIES]);
});

test("an admin with no relevant read permission sees no families at all", async () => {
  const { resolveVisibleFamilies } = await loadAccess();
  // classes.view is a real permission, just not a Finance-relevant one.
  assert.deepEqual(resolveVisibleFamilies(admin({ classes: { view: true } })), []);
  assert.deepEqual(resolveVisibleFamilies(admin({})), []);
});

test("each family is unlocked only by its own existing read permission", async () => {
  const { resolveVisibleFamilies } = await loadAccess();
  const { FINANCE_FAMILY_PERMISSIONS, FINANCE_SOURCE_FAMILIES } = await loadPermissions();

  for (const family of FINANCE_SOURCE_FAMILIES) {
    const [moduleKey, actionKey] = FINANCE_FAMILY_PERMISSIONS[family];
    const visible = resolveVisibleFamilies(admin({ [moduleKey]: { [actionKey]: true } }));
    assert.ok(visible.includes(family), `${moduleKey}.${actionKey} should unlock ${family}`);
    // ballet.payments.view legitimately unlocks both Ballet families; nothing
    // else may unlock more than its own family.
    const expected = FINANCE_SOURCE_FAMILIES.filter((candidate) => {
      const [candidateModule, candidateAction] = FINANCE_FAMILY_PERMISSIONS[candidate];
      return candidateModule === moduleKey && candidateAction === actionKey;
    });
    assert.deepEqual(visible, [...expected]);
  }
});

test("Phase 1 introduces no new permission codes — every family reuses a catalog permission", async () => {
  const { FINANCE_FAMILY_PERMISSIONS, FINANCE_SOURCE_FAMILIES, PERMISSION_CATALOG } = await loadPermissions();

  for (const family of FINANCE_SOURCE_FAMILIES) {
    const [moduleKey, actionKey] = FINANCE_FAMILY_PERMISSIONS[family];
    const module = PERMISSION_CATALOG.find((entry) => entry.key === moduleKey);
    assert.ok(module, `${moduleKey} must already exist in PERMISSION_CATALOG`);
    assert.ok(
      module!.actions.some((action) => action.key === actionKey),
      `${moduleKey}.${actionKey} must already exist in PERMISSION_CATALOG`,
    );
    // The reserved `finance` module must stay unused: granting it would need a
    // production role seed, which Phase 1 explicitly must not require.
    assert.notEqual(moduleKey, "finance", `${family} must not depend on the reserved finance module`);
  }
});

test("shared family permissions are reported once in access-denied guidance", async () => {
  const { financeRequiredPermissions } = await loadAccess();
  const required = financeRequiredPermissions();
  const keys = required.map(({ module, action }) => `${module}.${action}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.filter((key) => key === "packageOrders.view").length, 1);
});

// ─── Cross-source leakage ─────────────────────────────────────────────────────

test("Bookings-only admin receives no Ballet payment or refund event types", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({ bookings: { view: true } }));
  const scope = resolveRequestScope(EMPTY_QUERY, visible);

  assert.deepEqual(scope.families, ["class_payments"]);
  assert.deepEqual(scope.eventTypes, ["single_class_payment"]);
  assert.ok(!scope.eventTypes.includes("ballet_payment"));
  assert.ok(!scope.eventTypes.includes("ballet_refund"));
});

test("Ballet-payments-only admin receives no package purchase or credit event types", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({ "ballet.payments": { view: true } }));
  const scope = resolveRequestScope(EMPTY_QUERY, visible);

  assert.deepEqual(scope.families, ["ballet_payments", "ballet_refunds"]);
  assert.ok(!scope.eventTypes.includes("package_purchase"));
  assert.ok(!scope.eventTypes.includes("package_credit_issuance"));
  assert.ok(!scope.eventTypes.includes("package_credit_consumption"));
});

test("an explicit filter cannot widen scope beyond the caller's permissions", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({ bookings: { view: true } }));

  // Asking for Ballet payments without the permission yields nothing, not a
  // leak and not an error that reveals row counts.
  const scope = resolveRequestScope(
    { ...EMPTY_QUERY, eventType: ["ballet_payment"] as never },
    visible,
  );
  assert.deepEqual(scope.families, []);
  assert.deepEqual(scope.eventTypes, []);
});

test("requesting an unauthorized source table yields an empty scope", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({ packageOrders: { view: true } }));

  const scope = resolveRequestScope(
    { ...EMPTY_QUERY, source: ["ballet_refunds"] as never },
    visible,
  );
  assert.deepEqual(scope.families, []);
});

test("legacy permission aliases still grant Finance visibility", async () => {
  const { resolveVisibleFamilies } = await loadAccess();
  // packageOrders declares the legacy alias `package_orders`; roles that were
  // never migrated must not silently lose Finance access.
  const visible = resolveVisibleFamilies(admin({ package_orders: { view: true } }));
  assert.deepEqual(visible, ["package_purchases", "package_refunds"]);
});

// ─── Filter scope resolution ──────────────────────────────────────────────────

test("event nature filter resolves to exactly the matching event types", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({}, true));

  const estimates = resolveRequestScope(
    { ...EMPTY_QUERY, eventNature: ["operational_estimate"] as never },
    visible,
  );
  assert.deepEqual(estimates.eventTypes.sort(), [
    "package_purchase", "single_class_payment", "studio_walkin_payment",
  ]);

  const credits = resolveRequestScope(
    { ...EMPTY_QUERY, eventNature: ["service_credit"] as never },
    visible,
  );
  assert.deepEqual(credits.families, ["package_credits"]);

  const outflow = resolveRequestScope(
    { ...EMPTY_QUERY, eventNature: ["cash_outflow"] as never },
    visible,
  );
  assert.deepEqual(outflow.eventTypes, ["ballet_refund", "package_refund"]);
});

test("monetary default preserves Transactions while the refunds view opts into package refunds", async () => {
  const { resolveMonetaryRequestScope, resolveVisibleFamilies } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({}, true));

  const transactions = resolveMonetaryRequestScope(EMPTY_QUERY, visible);
  assert.ok(!transactions.families.includes("package_refunds"));
  assert.ok(!transactions.eventTypes.includes("package_refund"));

  const refunds = resolveMonetaryRequestScope(
    {
      ...EMPTY_QUERY,
      family: ["ballet_refunds", "package_refunds"] as never,
      eventType: ["ballet_refund", "package_refund"] as never,
    },
    visible,
  );
  assert.deepEqual(refunds.families, ["ballet_refunds", "package_refunds"]);
  assert.deepEqual(refunds.eventTypes, ["ballet_refund", "package_refund"]);
});

test("source table filter maps bookings to both booking families", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({}, true));

  const scope = resolveRequestScope({ ...EMPTY_QUERY, source: ["bookings"] as never }, visible);
  assert.deepEqual(scope.families, ["class_payments", "walkin_payments"]);
  assert.deepEqual(scope.eventTypes.sort(), ["single_class_payment", "studio_walkin_payment"]);
});

test("intersecting filters narrow rather than union", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const visible = resolveVisibleFamilies(admin({}, true));

  // A nature and a type that do not overlap must produce nothing.
  const contradictory = resolveRequestScope(
    { ...EMPTY_QUERY, eventNature: ["cash_inflow"] as never, eventType: ["promotion_discount"] as never },
    visible,
  );
  assert.deepEqual(contradictory.eventTypes, []);

  // A consistent combination survives.
  const consistent = resolveRequestScope(
    { ...EMPTY_QUERY, eventNature: ["cash_inflow"] as never, eventType: ["ballet_payment"] as never },
    visible,
  );
  assert.deepEqual(consistent.eventTypes, ["ballet_payment"]);
});

test("families are returned in the canonical order regardless of filter order", async () => {
  const { resolveVisibleFamilies, resolveRequestScope } = await loadAccess();
  const { FINANCE_SOURCE_FAMILIES } = await loadPermissions();
  const visible = resolveVisibleFamilies(admin({}, true));

  const scope = resolveRequestScope(
    { ...EMPTY_QUERY, family: ["discounts", "package_purchases", "ballet_refunds"] as never },
    visible,
  );
  const canonicalOrder = FINANCE_SOURCE_FAMILIES.filter((family) => scope.families.includes(family));
  assert.deepEqual(scope.families, [...canonicalOrder]);
});
