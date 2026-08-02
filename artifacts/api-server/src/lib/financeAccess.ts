/**
 * financeAccess — pure authorization and request-scope resolution for Finance.
 *
 * Deliberately free of Express and of @workspace/db so the security boundary is
 * unit-testable without a database. routes/finance.ts is a thin adapter over
 * these functions and adds no access logic of its own.
 *
 * The core guarantee: the caller's permitted event-source FAMILIES are resolved
 * first, and every requested filter can only NARROW that set. Nothing a client
 * sends can widen it, so counting and pagination downstream necessarily run
 * over authorized rows only.
 */
import {
  FINANCE_FAMILY_EVENT_TYPES,
  FINANCE_FAMILY_PERMISSIONS,
  FINANCE_SOURCE_FAMILIES,
  hasRolePermission,
  type FinanceEventNature,
  type FinanceEventType,
  type FinanceSourceFamily,
  type FinanceSourceTable,
  type PermissionMap,
} from "@workspace/api-zod";
import { familyForEventType } from "./financeReadModel";

/**
 * The permission-relevant slice of an authenticated admin. Structural, so both
 * the real AdminIdentity and a test fixture satisfy it.
 */
export interface FinanceAccessSubject {
  isSuperAdmin: boolean;
  permissions: PermissionMap;
}

export function financeAdminCan(
  subject: FinanceAccessSubject,
  moduleKey: string,
  actionKey: string,
): boolean {
  // hasRolePermission already honours the catalog's legacyAliases, so a role
  // that only holds e.g. `package_orders.view` keeps Finance access.
  return subject.isSuperAdmin || hasRolePermission(subject.permissions, moduleKey, actionKey);
}

/**
 * Event-source families this admin may read, in canonical order.
 *
 * Phase 1 adds no permission codes: each family maps to a read permission that
 * already gates the corresponding operational page, so no migration and no
 * production role seed is required.
 */
export function resolveVisibleFamilies(subject: FinanceAccessSubject): FinanceSourceFamily[] {
  return FINANCE_SOURCE_FAMILIES.filter((family) => {
    const [moduleKey, actionKey] = FINANCE_FAMILY_PERMISSIONS[family];
    return financeAdminCan(subject, moduleKey, actionKey);
  });
}

/** Every (module, action) pair that would grant at least some Finance access. */
export function financeRequiredPermissions(): Array<{ module: string; action: string }> {
  const seen = new Set<string>();
  return FINANCE_SOURCE_FAMILIES.flatMap((family) => {
    const [module, action] = FINANCE_FAMILY_PERMISSIONS[family];
    const key = `${module}.${action}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ module, action }];
  });
}

/** Event nature is a pure function of event type — mirrors financeReadModel. */
export const FINANCE_NATURE_BY_EVENT_TYPE: Readonly<Record<FinanceEventType, FinanceEventNature>> = {
  package_purchase: "operational_estimate",
  single_class_payment: "operational_estimate",
  studio_walkin_payment: "operational_estimate",
  ballet_payment: "cash_inflow",
  ballet_refund: "cash_outflow",
  package_refund: "cash_outflow",
  promotion_discount: "discount",
  package_credit_issuance: "service_credit",
  package_credit_consumption: "service_credit",
  future_manual_adjustment: "service_credit",
};

/** Which families can produce rows from a given source table. */
export const FINANCE_FAMILIES_BY_SOURCE_TABLE: Readonly<
  Record<FinanceSourceTable, readonly FinanceSourceFamily[]>
> = {
  package_orders: ["package_purchases"],
  // One table, two families — a walk-in is a booking with audit-log evidence.
  bookings: ["class_payments", "walkin_payments"],
  ballet_payments: ["ballet_payments"],
  ballet_refunds: ["ballet_refunds"],
  payment_refunds: ["package_refunds"],
  promotion_redemptions: ["discounts"],
  credit_transactions: ["package_credits"],
};

export interface FinanceScopeRequest {
  eventType: FinanceEventType[];
  eventNature: FinanceEventNature[];
  source: FinanceSourceTable[];
  family: FinanceSourceFamily[];
}

export interface FinanceScope {
  families: FinanceSourceFamily[];
  eventTypes: FinanceEventType[];
}

/**
 * Monetary Finance pages must never query the service-unit ledger. The generic
 * scope resolver remains available to operational diagnostics, while this
 * wrapper is the explicit contract for Finance Transactions and exports.
 */
export const MONETARY_FINANCE_FAMILIES = FINANCE_SOURCE_FAMILIES.filter(
  (
    family,
  ): family is Exclude<FinanceSourceFamily, "package_credits" | "package_refunds"> =>
    family !== "package_credits" && family !== "package_refunds",
);

export const MONETARY_FINANCE_EVENT_TYPES = MONETARY_FINANCE_FAMILIES.flatMap(
  (family) => [...FINANCE_FAMILY_EVENT_TYPES[family]],
);

export function resolveMonetaryRequestScope(
  request: FinanceScopeRequest,
  visibleFamilies: readonly FinanceSourceFamily[],
): FinanceScope {
  // Package refunds are an opt-in read source for Refunds & Cancellations.
  // The general Transactions feed already represents the refunded package
  // payment through payment_records, so including this lifecycle row in the
  // default scope would duplicate it there. Explicit family/event/source
  // filters still make the row available to the dedicated refunds view.
  const packageRefundsRequested =
    request.family.includes("package_refunds") ||
    request.eventType.includes("package_refund") ||
    request.source.includes("payment_refunds");
  return resolveRequestScope(
    request,
    visibleFamilies.filter(
      (family) =>
        family !== "package_credits" &&
        (family !== "package_refunds" || packageRefundsRequested),
    ),
  );
}

/**
 * Collapse the request's four overlapping "which rows" dimensions into one
 * concrete event-type set, intersected with what the caller may see.
 *
 * Starting from the permitted set and only ever filtering it is what makes
 * widening impossible: a request for a family the admin cannot view resolves to
 * an empty scope, which downstream turns into zero rows AND a zero total —
 * never a 403 that would itself reveal that matching rows exist.
 */
export function resolveRequestScope(
  request: FinanceScopeRequest,
  visibleFamilies: readonly FinanceSourceFamily[],
): FinanceScope {
  let eventTypes: FinanceEventType[] = visibleFamilies.flatMap(
    (family) => [...FINANCE_FAMILY_EVENT_TYPES[family]],
  );

  if (request.eventType.length > 0) {
    eventTypes = eventTypes.filter((type) => request.eventType.includes(type));
  }
  if (request.eventNature.length > 0) {
    eventTypes = eventTypes.filter((type) =>
      request.eventNature.includes(FINANCE_NATURE_BY_EVENT_TYPE[type]),
    );
  }
  if (request.family.length > 0) {
    eventTypes = eventTypes.filter((type) => request.family.includes(familyForEventType(type)));
  }
  if (request.source.length > 0) {
    const sourceFamilies = new Set(
      request.source.flatMap((table) => [...FINANCE_FAMILIES_BY_SOURCE_TABLE[table]]),
    );
    eventTypes = eventTypes.filter((type) => sourceFamilies.has(familyForEventType(type)));
  }

  const selected = new Set(eventTypes.map(familyForEventType));
  return {
    // Canonical order so the response is stable regardless of filter order.
    families: FINANCE_SOURCE_FAMILIES.filter((family) => selected.has(family)),
    eventTypes: Array.from(new Set(eventTypes)),
  };
}
