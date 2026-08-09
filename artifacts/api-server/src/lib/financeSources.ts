/**
 * financeSources — the query layer behind the Finance Phase 1 read model.
 *
 * One descriptor per permission family. Each descriptor knows how to
 *   (a) express every supported filter as SQL against its own table, and
 *   (b) fetch a bounded window of rows and hand them to financeReadModel.ts.
 *
 * Design notes
 * ────────────
 * • READ-ONLY. Nothing here writes, and no caller may pass raw user text into
 *   an SQL fragment: every filter value is validated against an allowlist in
 *   routes/finance.ts and every dynamic value is a bound parameter.
 *
 * • Exact totals. Filters are pushed down to SQL — including the *derived*
 *   filters (amount availability, reliability badge), each of which is a simple
 *   per-family condition — so `total` is computed over exactly the rows that
 *   will be returned. Nothing is filtered after counting.
 *
 * • Bounded merge, exact paging. Sorting by occurredAt across six tables with
 *   independent id sequences cannot be done by the database in one index scan
 *   without a migration. Instead each authorized family returns its own top
 *   K = page × limit rows; the global top K is necessarily a subset of that
 *   union, so merging and slicing in memory yields the same page a single
 *   ORDER BY would, with K hard-capped by MAX_PAGE × MAX_LIMIT.
 *
 * • No N+1. Every family is exactly two statements (count + page window), all
 *   families run concurrently, and per-row lookups (walk-in evidence, actor)
 *   are correlated sub-selects inside those statements.
 */
import { and, count, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  balletApplicationsTable,
  balletPaymentsTable,
  balletRefundsTable,
  bookingsTable,
  childrenTable,
  classesTable,
  classPricingSettingsTable,
  creditTransactionsTable,
  packageOrdersTable,
  paymentRefundsTable,
  paymentRecordsTable,
  pricePackagesTable,
  promotionRedemptionsTable,
  promotionsTable,
  schedulesTable,
  studentsTable,
  systemUsersTable,
} from "@workspace/db";
import { alias } from "drizzle-orm/pg-core";
import type {
  FinanceAmountAvailability,
  FinanceEventType,
  FinanceNormalizedPaymentMethod,
  FinancePaymentStatus,
  FinanceRefundStatus,
  FinanceReliabilityBadge,
  FinanceSourceFamily,
  UnifiedFinanceTransaction,
} from "@workspace/api-zod";
import {
  CREDIT_ADJUSTMENT_TYPES,
  CREDIT_CONSUMPTION_TYPES,
  CREDIT_ISSUANCE_TYPES,
  mapBalletAssessmentFee,
  mapBalletPayment,
  mapBalletRefund,
  mapBookingPayment,
  mapCreditTransaction,
  mapPackagePurchase,
  mapPackageRefund,
  mapPromotionDiscount,
} from "./financeReadModel";

// ─── Filter contract ──────────────────────────────────────────────────────────

/**
 * All values are already validated against allowlists by the route. Empty
 * arrays mean "no constraint on this dimension".
 */
export interface FinanceTransactionFilters {
  /** Inclusive UTC day bounds, pre-expanded to ISO instants by the route. */
  fromIso?: string;
  toIso?: string;
  eventTypes: FinanceEventType[];
  families: FinanceSourceFamily[];
  paymentMethods: FinanceNormalizedPaymentMethod[];
  paymentStatuses: FinancePaymentStatus[];
  refundStatuses: FinanceRefundStatus[];
  reliabilityBadges: FinanceReliabilityBadge[];
  amountAvailabilities: FinanceAmountAvailability[];
  /** Free text: customer name/email/phone, synthetic event id, or source id. */
  search?: string;
}

/** Parsed free-text search — see parseSearch. */
interface ParsedSearch {
  raw: string;
  /** Numeric part, when the search looks like an id ("41" or "bp:41"). */
  numericId: number | null;
  /** Prefix part of a synthetic id ("bp" in "bp:41"). */
  idPrefix: string | null;
}

/**
 * A search term can be a customer identifier or an event id. `bp:41` pins both
 * the source and the id; a bare number matches any family's source id; anything
 * else is a text match. Parsing here (not in SQL) keeps the SQL parameterized.
 */
export function parseSearch(search: string | undefined): ParsedSearch | null {
  const raw = search?.trim();
  if (!raw) return null;
  const prefixed = /^([a-z]{2})\s*:\s*(\d+)$/i.exec(raw);
  if (prefixed) {
    return { raw, idPrefix: prefixed[1]!.toLowerCase(), numericId: Number(prefixed[2]) };
  }
  if (/^\d+$/.test(raw)) return { raw, idPrefix: null, numericId: Number(raw) };
  return { raw, idPrefix: null, numericId: null };
}

// ─── Descriptor ───────────────────────────────────────────────────────────────

interface FamilyQueryPlan {
  /** SQL predicate for this family, or null when filters exclude it entirely. */
  where: SQL | undefined | null;
}

interface FinanceFamilyDescriptor {
  family: FinanceSourceFamily;
  /** Event types this family can emit — used to short-circuit type filters. */
  eventTypes: readonly FinanceEventType[];
  plan(filters: FinanceTransactionFilters): FamilyQueryPlan;
  count(where: SQL | undefined): Promise<number>;
  fetch(where: SQL | undefined, take: number): Promise<UnifiedFinanceTransaction[]>;
}

/** Combine conditions, dropping undefined. `and()` of nothing is undefined. */
function all(...conditions: Array<SQL | undefined>): SQL | undefined {
  const present = conditions.filter((condition): condition is SQL => condition != null);
  return present.length > 0 ? and(...present) : undefined;
}

/**
 * True when the filter constrains this dimension and none of the family's own
 * values satisfy it — i.e. the whole family drops out (and contributes 0 to
 * the total).
 */
function excludedBy<T>(selected: readonly T[], supported: readonly T[]): boolean {
  return selected.length > 0 && !selected.some((value) => supported.includes(value));
}

/** ILIKE pattern with wildcards escaped so `%` in a name is a literal. */
function likePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// ─── Shared SQL fragments ─────────────────────────────────────────────────────

/**
 * The canonical, tamper-evident walk-in marker. studioWalkIn.ts records this
 * through logActivityWithActorStrict inside the walk-in transaction, so its
 * presence is proof written by the server — unlike bookings.notes, which is
 * settable by any booking client through CreateBookingBody.
 */
const WALK_IN_LOG_MATCH = sql`
  from admin_activity_logs l
  where l.module = 'attendance'
    and l.action = 'checkIn'
    and l.after ->> 'source' = 'unified_gateway_walk_in'
    and l.after ->> 'bookingId' = ${bookingsTable.id}::text
`;

const IS_WALK_IN = sql<boolean>`exists (select 1 ${WALK_IN_LOG_MATCH})`;

/** Earliest matching log row wins — the walk-in is logged exactly once. */
const WALK_IN_ACTOR_ID = sql<number | null>`(select l.actor_id ${WALK_IN_LOG_MATCH} order by l.id asc limit 1)`;
const WALK_IN_ACTOR_EMAIL = sql<string | null>`(select l.actor_email ${WALK_IN_LOG_MATCH} order by l.id asc limit 1)`;

/**
 * Latest attendance row satisfying this booking. Read-only cross-reference for
 * the detail drawer; never used to infer a payment time.
 */
const BOOKING_ATTENDANCE_ID = sql<number | null>`(
  select a.id from attendance a
  where a.booking_id = ${bookingsTable.id}
  order by a.id desc limit 1
)`;

/**
 * Same double-count guard the Dashboard aggregate uses: a package_order
 * referenced by ballet_payments.package_order_id is a Ballet operational
 * mirror, not an independent generic package sale.
 */
const NOT_BALLET_LINKED_PACKAGE_ORDER = sql`not exists (
  select 1 from ballet_payments bp where bp.package_order_id = ${packageOrdersTable.id}
)`;

/** Generic booking price fallback — identical order to financialAggregates.ts. */
const BOOKING_RESOLVED_PRICE = sql<number | null>`coalesce(${schedulesTable.priceEgp}, ${classPricingSettingsTable.singleClassPriceEgp})`;

/** ballet_refunds completion condition — identical to financialAggregates.ts. */
const REFUND_COMPLETED = sql`(
  ${balletRefundsTable.status} = 'refunded'
  and ${balletRefundsTable.processedAt} is not null
  and ${balletRefundsTable.refundedAmountEgp} > 0
)`;

// occurredAt expressions, one per family — mirrors financeReadModel.ts exactly.
const OCCURRED_PACKAGE_ORDER = sql`coalesce(${packageOrdersTable.activatedAt}, ${packageOrdersTable.createdAt})`;
const OCCURRED_BALLET_PAYMENT = sql`coalesce(${balletPaymentsTable.paidAt}, ${balletPaymentsTable.createdAt})`;
const OCCURRED_BALLET_REFUND = sql`coalesce(${balletRefundsTable.processedAt}, ${balletRefundsTable.reviewedAt}, ${balletRefundsTable.createdAt})`;
const OCCURRED_PACKAGE_REFUND = sql`coalesce(${paymentRefundsTable.processedAt}, ${paymentRefundsTable.reviewedAt}, ${paymentRefundsTable.createdAt})`;

function dateRange(expression: SQL, filters: FinanceTransactionFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.fromIso) conditions.push(sql`${expression} >= ${filters.fromIso}`);
  if (filters.toIso) conditions.push(sql`${expression} <= ${filters.toIso}`);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ─── Family: package purchases (package_orders) ───────────────────────────────

/**
 * Every non-Ballet-linked package order is surfaced, at any status, because
 * Finance is a visibility layer and `rawSourceStatus` keeps the truth. Note
 * this is intentionally BROADER than the Dashboard/Overview estimate, which
 * (via getFinancialAggregates) counts only active/fullyUsed/expired orders —
 * the Overview reuses that existing math rather than recomputing it here.
 */
const packagePurchases: FinanceFamilyDescriptor = {
  family: "package_purchases",
  eventTypes: ["package_purchase"],
  plan(filters) {
    // Package purchases have no payment status, no refund status and no
    // payment method, so any constraint on those dimensions excludes them.
    if (
      excludedBy(filters.eventTypes, this.eventTypes) ||
      filters.paymentStatuses.length > 0 ||
      filters.refundStatuses.length > 0 ||
      filters.paymentMethods.length > 0 ||
      excludedBy(filters.amountAvailabilities, ["estimated", "unknown"]) ||
      excludedBy(filters.reliabilityBadges, ["estimated_operational", "unknown_amount"])
    ) {
      return { where: null };
    }

    const priceResolves = sql`${pricePackagesTable.priceEgp} is not null`;
    const priceMissing = sql`${pricePackagesTable.priceEgp} is null`;

    // amountAvailability and reliability are two views of the same fact here
    // (did the current catalog price resolve?), so both filters reduce to it.
    const wantsEstimated =
      filters.amountAvailabilities.includes("estimated") ||
      filters.reliabilityBadges.includes("estimated_operational");
    const wantsUnknown =
      filters.amountAvailabilities.includes("unknown") ||
      filters.reliabilityBadges.includes("unknown_amount");
    const qualityCondition =
      wantsEstimated && !wantsUnknown ? priceResolves
        : wantsUnknown && !wantsEstimated ? priceMissing
          : undefined;

    const search = parseSearch(filters.search);
    let searchCondition: SQL | undefined;
    if (search) {
      if (search.idPrefix != null) {
        searchCondition = search.idPrefix === "po"
          ? eq(packageOrdersTable.id, search.numericId!)
          : sql`false`;
      } else if (search.numericId != null) {
        searchCondition = eq(packageOrdersTable.id, search.numericId);
      } else {
        const pattern = likePattern(search.raw);
        searchCondition = or(
          sql`${packageOrdersTable.studentName} ilike ${pattern}`,
          sql`${packageOrdersTable.studentEmail} ilike ${pattern}`,
          sql`${packageOrdersTable.studentPhone} ilike ${pattern}`,
          sql`${packageOrdersTable.packageName} ilike ${pattern}`,
        );
      }
    }

    return {
      where: all(
        NOT_BALLET_LINKED_PACKAGE_ORDER,
        dateRange(OCCURRED_PACKAGE_ORDER, filters),
        qualityCondition,
        searchCondition,
      ),
    };
  },
  async count(where) {
    const [row] = await db
      .select({ total: count() })
      .from(packageOrdersTable)
      .leftJoin(pricePackagesTable, eq(packageOrdersTable.packageId, pricePackagesTable.id))
      .where(where);
    return Number(row?.total ?? 0);
  },
  async fetch(where, take) {
    const rows = await db
      .select({
        id: packageOrdersTable.id,
        status: packageOrdersTable.status,
        packageId: packageOrdersTable.packageId,
        packageName: packageOrdersTable.packageName,
        studentId: packageOrdersTable.studentId,
        studentName: packageOrdersTable.studentName,
        studentEmail: packageOrdersTable.studentEmail,
        studentPhone: packageOrdersTable.studentPhone,
        currentCatalogPriceEgp: pricePackagesTable.priceEgp,
        activatedAt: packageOrdersTable.activatedAt,
        createdAt: packageOrdersTable.createdAt,
        // Finance Batch 1: canonical Phase 2B-1/2C payment record, when one
        // exists — the payment_records/package_orders relationship is
        // one-to-one per the flow_package_order_unique constraint, so this
        // left join cannot fan out rows.
        paymentRecordStatus: paymentRecordsTable.status,
        paymentRecordConfirmedMethod: paymentRecordsTable.confirmedPaymentMethod,
        paymentRecordFinalPayableAmountMinor: paymentRecordsTable.finalPayableAmountMinor,
        paymentRecordPaidAmountMinor: paymentRecordsTable.paidAmountMinor,
        paymentRecordRefundedAmountMinor: paymentRecordsTable.refundedAmountMinor,
        paymentRecordDiscountAmountMinor: paymentRecordsTable.discountAmountMinor,
        paymentRecordPaidAt: paymentRecordsTable.paidAt,
      })
      .from(packageOrdersTable)
      .leftJoin(pricePackagesTable, eq(packageOrdersTable.packageId, pricePackagesTable.id))
      .leftJoin(
        paymentRecordsTable,
        and(
          eq(paymentRecordsTable.packageOrderId, packageOrdersTable.id),
          eq(paymentRecordsTable.flowType, "package_purchase"),
        ),
      )
      .where(where)
      .orderBy(sql`${OCCURRED_PACKAGE_ORDER} desc`, sql`${packageOrdersTable.id} desc`)
      .limit(take);
    return rows.map(mapPackagePurchase);
  },
};

// ─── Families: generic class payments & studio walk-ins (bookings) ────────────

/**
 * Both booking families share every join and every filter; they differ only in
 * the walk-in evidence predicate, so the descriptor is generated twice.
 *
 * `free` and `package_credit` bookings are excluded outright: they are not
 * payments. A package_credit booking's economics appear once, in the credit
 * ledger, so surfacing it here too would double-count one class.
 */
function bookingFamily(
  family: Extract<FinanceSourceFamily, "class_payments" | "walkin_payments">,
): FinanceFamilyDescriptor {
  const isWalkInFamily = family === "walkin_payments";
  const eventTypes: readonly FinanceEventType[] = isWalkInFamily
    ? ["studio_walkin_payment"]
    : ["single_class_payment"];
  const owner = alias(studentsTable, `finance_${family}_owner`);
  const BOOKING_PAYMENT_RECORD = alias(paymentRecordsTable, `finance_${family}_payment_record`);

  const baseQuery = () =>
    db
      .select({
        id: bookingsTable.id,
        paymentStatus: bookingsTable.paymentStatus,
        paymentMode: bookingsTable.paymentMode,
        bookingStatus: bookingsTable.bookingStatus,
        bookedAt: bookingsTable.bookedAt,
        occurrenceDate: bookingsTable.occurrenceDate,
        classId: bookingsTable.classId,
        classTitle: classesTable.title,
        scheduleId: bookingsTable.scheduleId,
        schedulePriceEgp: schedulesTable.priceEgp,
        singleClassSettingEgp: classPricingSettingsTable.singleClassPriceEgp,
        accountOwnerStudentId: bookingsTable.accountOwnerStudentId,
        studentName: bookingsTable.studentName,
        studentEmail: bookingsTable.studentEmail,
        studentPhone: bookingsTable.studentPhone,
        bookingScope: bookingsTable.bookingScope,
        participantChildId: bookingsTable.participantChildId,
        childName: childrenTable.fullName,
        ownerName: owner.name,
        ownerEmail: owner.email,
        ownerPhone: owner.phone,
        attendanceId: BOOKING_ATTENDANCE_ID,
        walkInActorAdminId: WALK_IN_ACTOR_ID,
        walkInActorEmail: WALK_IN_ACTOR_EMAIL,
        isWalkIn: IS_WALK_IN,
        // Finance Batch 1: canonical Phase 2B-2/2B-4/2C payment record, when
        // one exists — payment_records/bookings is one-to-one per the
        // flow_booking_unique constraint, so this left join cannot fan out.
        paymentRecordStatus: BOOKING_PAYMENT_RECORD.status,
        paymentRecordConfirmedMethod: BOOKING_PAYMENT_RECORD.confirmedPaymentMethod,
        paymentRecordGrossAmountMinor: BOOKING_PAYMENT_RECORD.grossAmountMinor,
        paymentRecordDiscountAmountMinor: BOOKING_PAYMENT_RECORD.discountAmountMinor,
        paymentRecordFinalPayableAmountMinor: BOOKING_PAYMENT_RECORD.finalPayableAmountMinor,
        paymentRecordPaidAmountMinor: BOOKING_PAYMENT_RECORD.paidAmountMinor,
        paymentRecordRefundedAmountMinor: BOOKING_PAYMENT_RECORD.refundedAmountMinor,
        paymentRecordPaidAt: BOOKING_PAYMENT_RECORD.paidAt,
      })
      .from(bookingsTable)
      .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
      .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
      .leftJoin(classPricingSettingsTable, eq(classPricingSettingsTable.id, sql`1`))
      .leftJoin(owner, eq(bookingsTable.accountOwnerStudentId, owner.id))
      .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
      .leftJoin(
        BOOKING_PAYMENT_RECORD,
        and(
          eq(BOOKING_PAYMENT_RECORD.bookingId, bookingsTable.id),
          inArray(BOOKING_PAYMENT_RECORD.flowType, ["single_class_booking", "studio_walkin"]),
        ),
      );

  return {
    family,
    eventTypes,
    plan(filters) {
      if (
        excludedBy(filters.eventTypes, eventTypes) ||
        filters.refundStatuses.length > 0 ||
        excludedBy(filters.paymentMethods, ["pay_at_studio", "online_payment"]) ||
        excludedBy(filters.amountAvailabilities, ["estimated", "unknown"]) ||
        excludedBy(filters.reliabilityBadges, ["estimated_operational", "unknown_amount"])
      ) {
        return { where: null };
      }

      const conditions: Array<SQL | undefined> = [
        inArray(bookingsTable.paymentMode, ["pay_at_studio", "online_payment"]),
        isWalkInFamily ? IS_WALK_IN : sql`not ${IS_WALK_IN}`,
        dateRange(sql`${bookingsTable.bookedAt}`, filters),
      ];

      if (filters.paymentMethods.length > 0) {
        // Normalized method → the raw booking payment_mode values it covers.
        const modes = filters.paymentMethods.filter(
          (method): method is "pay_at_studio" | "online_payment" =>
            method === "pay_at_studio" || method === "online_payment",
        );
        conditions.push(inArray(bookingsTable.paymentMode, modes));
      }

      if (filters.paymentStatuses.length > 0) {
        // "pending" is stored as "pending_payment" on bookings; keep both so a
        // legacy row written as plain "pending" is not silently dropped.
        const raw = filters.paymentStatuses.flatMap((status) =>
          status === "pending" ? ["pending_payment", "pending"] : [status],
        );
        conditions.push(inArray(bookingsTable.paymentStatus, raw));
      }

      const priceResolves = sql`${BOOKING_RESOLVED_PRICE} is not null`;
      const priceMissing = sql`${BOOKING_RESOLVED_PRICE} is null`;
      const wantsEstimated =
        filters.amountAvailabilities.includes("estimated") ||
        filters.reliabilityBadges.includes("estimated_operational");
      const wantsUnknown =
        filters.amountAvailabilities.includes("unknown") ||
        filters.reliabilityBadges.includes("unknown_amount");
      if (wantsEstimated && !wantsUnknown) conditions.push(priceResolves);
      else if (wantsUnknown && !wantsEstimated) conditions.push(priceMissing);

      const search = parseSearch(filters.search);
      if (search) {
        if (search.idPrefix != null) {
          const expected = isWalkInFamily ? "wi" : "bk";
          conditions.push(
            search.idPrefix === expected ? eq(bookingsTable.id, search.numericId!) : sql`false`,
          );
        } else if (search.numericId != null) {
          conditions.push(eq(bookingsTable.id, search.numericId));
        } else {
          const pattern = likePattern(search.raw);
          conditions.push(
            or(
              sql`${bookingsTable.studentName} ilike ${pattern}`,
              sql`${bookingsTable.studentEmail} ilike ${pattern}`,
              sql`${bookingsTable.studentPhone} ilike ${pattern}`,
              sql`${owner.name} ilike ${pattern}`,
              sql`${owner.email} ilike ${pattern}`,
              sql`${childrenTable.fullName} ilike ${pattern}`,
              sql`${classesTable.title} ilike ${pattern}`,
            ),
          );
        }
      }

      return { where: all(...conditions) };
    },
    async count(where) {
      const [row] = await db
        .select({ total: count() })
        .from(bookingsTable)
        .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
        .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
        .leftJoin(classPricingSettingsTable, eq(classPricingSettingsTable.id, sql`1`))
        .leftJoin(owner, eq(bookingsTable.accountOwnerStudentId, owner.id))
        .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
        .where(where);
      return Number(row?.total ?? 0);
    },
    async fetch(where, take) {
      const rows = await baseQuery()
        .where(where)
        .orderBy(sql`${bookingsTable.bookedAt} desc`, sql`${bookingsTable.id} desc`)
        .limit(take);
      return rows.map((row) => mapBookingPayment({ ...row, isWalkIn: Boolean(row.isWalkIn) }));
    },
  };
}

// ─── Family: ballet payments (ballet_payments) ────────────────────────────────

const balletPayments: FinanceFamilyDescriptor = {
  family: "ballet_payments",
  eventTypes: ["ballet_payment"],
  plan(filters) {
    if (
      excludedBy(filters.eventTypes, this.eventTypes) ||
      filters.refundStatuses.length > 0 ||
      excludedBy(filters.paymentMethods, ["in_person", "kashier", "bank_transfer", "unknown"]) ||
      excludedBy(filters.amountAvailabilities, ["exact", "unknown"]) ||
      excludedBy(filters.reliabilityBadges, [
        "recorded_collection",
        "unverified_admin_tag",
        "legacy_display_only",
        "unknown_amount",
      ])
    ) {
      return { where: null };
    }

    const conditions: Array<SQL | undefined> = [dateRange(OCCURRED_BALLET_PAYMENT, filters)];

    if (filters.paymentStatuses.length > 0) {
      conditions.push(inArray(balletPaymentsTable.status, filters.paymentStatuses));
    }

    if (filters.paymentMethods.length > 0) {
      const rawMethods: string[] = [];
      let includeUnrecognized = false;
      for (const method of filters.paymentMethods) {
        if (method === "in_person") rawMethods.push("inPerson");
        else if (method === "kashier") rawMethods.push("kashier");
        else if (method === "bank_transfer") rawMethods.push("bankTransfer");
        else if (method === "unknown") includeUnrecognized = true;
      }
      // "unknown" covers both a null method and any value outside the
      // known three — the same set normalizePaymentMethod maps to "unknown".
      const branches: SQL[] = [];
      if (rawMethods.length > 0) branches.push(inArray(balletPaymentsTable.paymentMethod, rawMethods));
      if (includeUnrecognized) {
        branches.push(sql`(${balletPaymentsTable.paymentMethod} is null or ${balletPaymentsTable.paymentMethod} not in ('inPerson','kashier','bankTransfer'))`);
      }
      const combined = branches.length === 1 ? branches[0] : or(...branches);
      if (combined) conditions.push(combined);
    }

    // A null method is reported as unverified_admin_tag (there is nothing
    // proving how the money arrived), so that badge covers two raw shapes.
    if (filters.reliabilityBadges.length > 0) {
      const branches: SQL[] = [];
      if (filters.reliabilityBadges.includes("recorded_collection")) {
        branches.push(sql`${balletPaymentsTable.paymentMethod} = 'inPerson'`);
      }
      if (filters.reliabilityBadges.includes("unverified_admin_tag")) {
        branches.push(sql`(${balletPaymentsTable.paymentMethod} = 'kashier' or ${balletPaymentsTable.paymentMethod} is null or ${balletPaymentsTable.paymentMethod} not in ('inPerson','kashier','bankTransfer'))`);
      }
      if (filters.reliabilityBadges.includes("legacy_display_only")) {
        branches.push(sql`${balletPaymentsTable.paymentMethod} = 'bankTransfer'`);
      }
      if (filters.reliabilityBadges.includes("unknown_amount")) {
        branches.push(sql`${balletPaymentsTable.amountEgp} is null`);
      }
      const combined = branches.length === 1 ? branches[0] : or(...branches);
      if (combined) conditions.push(combined);
    }

    if (filters.amountAvailabilities.length > 0) {
      const wantsExact = filters.amountAvailabilities.includes("exact");
      const wantsUnknown = filters.amountAvailabilities.includes("unknown");
      if (wantsExact && !wantsUnknown) conditions.push(sql`${balletPaymentsTable.amountEgp} is not null`);
      else if (wantsUnknown && !wantsExact) conditions.push(sql`${balletPaymentsTable.amountEgp} is null`);
    }

    const search = parseSearch(filters.search);
    if (search) {
      if (search.idPrefix != null) {
        conditions.push(
          search.idPrefix === "bp" ? eq(balletPaymentsTable.id, search.numericId!) : sql`false`,
        );
      } else if (search.numericId != null) {
        conditions.push(eq(balletPaymentsTable.id, search.numericId));
      } else {
        const pattern = likePattern(search.raw);
        conditions.push(
          or(
            sql`${balletApplicationsTable.parentName} ilike ${pattern}`,
            sql`${balletApplicationsTable.parentEmail} ilike ${pattern}`,
            sql`${balletApplicationsTable.parentPhone} ilike ${pattern}`,
            sql`${balletApplicationsTable.childName} ilike ${pattern}`,
          ),
        );
      }
    }

    return { where: all(...conditions) };
  },
  async count(where) {
    const [row] = await db
      .select({ total: count() })
      .from(balletPaymentsTable)
      .innerJoin(balletApplicationsTable, eq(balletPaymentsTable.applicationId, balletApplicationsTable.id))
      .where(where);
    return Number(row?.total ?? 0);
  },
  async fetch(where, take) {
    const rows = await db
      .select({
        id: balletPaymentsTable.id,
        applicationId: balletPaymentsTable.applicationId,
        packageOrderId: balletPaymentsTable.packageOrderId,
        amountEgp: balletPaymentsTable.amountEgp,
        status: balletPaymentsTable.status,
        paymentMethod: balletPaymentsTable.paymentMethod,
        paidAt: balletPaymentsTable.paidAt,
        refundedAt: balletPaymentsTable.refundedAt,
        createdAt: balletPaymentsTable.createdAt,
        parentStudentId: balletApplicationsTable.parentStudentId,
        parentName: balletApplicationsTable.parentName,
        parentEmail: balletApplicationsTable.parentEmail,
        parentPhone: balletApplicationsTable.parentPhone,
        childId: balletApplicationsTable.childId,
        childName: balletApplicationsTable.childName,
      })
      .from(balletPaymentsTable)
      .innerJoin(balletApplicationsTable, eq(balletPaymentsTable.applicationId, balletApplicationsTable.id))
      .where(where)
      .orderBy(sql`${OCCURRED_BALLET_PAYMENT} desc`, sql`${balletPaymentsTable.id} desc`)
      .limit(take);
    return rows.map(mapBalletPayment);
  },
};

const balletAssessmentFees: FinanceFamilyDescriptor = {
  family: "ballet_payments",
  eventTypes: ["ballet_assessment_fee"],
  plan(filters) {
    if (
      excludedBy(filters.eventTypes, this.eventTypes) ||
      filters.refundStatuses.length > 0 ||
      excludedBy(filters.paymentMethods, ["in_person", "unknown"]) ||
      excludedBy(filters.amountAvailabilities, ["exact", "unknown"]) ||
      excludedBy(filters.reliabilityBadges, ["recorded_collection", "unknown_amount", "unverified_admin_tag"])
    ) {
      return { where: null };
    }

    const conditions: Array<SQL | undefined> = [
      eq(balletApplicationsTable.assessmentFeeStatus, "paid"),
      dateRange(sql`coalesce(${balletApplicationsTable.assessmentFeePaidAt}, ${balletApplicationsTable.createdAt})`, filters),
    ];

    if (filters.paymentStatuses.length > 0 && !filters.paymentStatuses.includes("paid")) {
      return { where: null };
    }

    const combined = conditions.length === 1 ? conditions[0] : and(...conditions);
    return { where: combined ?? null };
  },
  async count(where) {
    const query = db
      .select({ count: sql<number>`count(*)::int` })
      .from(balletApplicationsTable);
    if (where) query.where(where);
    const [row] = await query;
    return row?.count ?? 0;
  },
  async fetch(where, limit) {
    const query = db
      .select({
        id: balletApplicationsTable.id,
        parentStudentId: balletApplicationsTable.parentStudentId,
        parentName: balletApplicationsTable.parentName,
        parentEmail: balletApplicationsTable.parentEmail,
        parentPhone: balletApplicationsTable.parentPhone,
        childId: balletApplicationsTable.childId,
        childName: balletApplicationsTable.childName,
        assessmentFeeAmountEgp: balletApplicationsTable.assessmentFeeAmountEgp,
        assessmentFeeStatus: balletApplicationsTable.assessmentFeeStatus,
        assessmentFeePaidAt: balletApplicationsTable.assessmentFeePaidAt,
        assessmentFeePaymentMethod: balletApplicationsTable.assessmentFeePaymentMethod,
        createdAt: balletApplicationsTable.createdAt,
      })
      .from(balletApplicationsTable);
    if (where) query.where(where);
    query.orderBy(sql`coalesce(${balletApplicationsTable.assessmentFeePaidAt}, ${balletApplicationsTable.createdAt}) desc`, sql`${balletApplicationsTable.id} desc`);
    query.limit(limit);
    const rows = await query;
    return rows.map(mapBalletAssessmentFee);
  },
};

// ─── Family: ballet refunds (ballet_refunds) ──────────────────────────────────

const reviewer = alias(systemUsersTable, "finance_refund_reviewer");
const processor = alias(systemUsersTable, "finance_refund_processor");

const balletRefunds: FinanceFamilyDescriptor = {
  family: "ballet_refunds",
  eventTypes: ["ballet_refund"],
  plan(filters) {
    if (
      excludedBy(filters.eventTypes, this.eventTypes) ||
      // A refund has no payment status of its own.
      filters.paymentStatuses.length > 0 ||
      // A refund inherits the ORIGINAL payment's method classification, so it
      // can only ever match the Ballet method vocabulary. Without this guard a
      // "pay_at_studio" filter would both keep this family and then apply no
      // method condition to it at all.
      excludedBy(filters.paymentMethods, ["in_person", "kashier", "bank_transfer", "unknown"]) ||
      excludedBy(filters.amountAvailabilities, ["exact", "unknown"]) ||
      // mapBalletRefund only ever emits these two badges.
      excludedBy(filters.reliabilityBadges, ["recorded_refund", "unknown_amount"])
    ) {
      return { where: null };
    }

    const conditions: Array<SQL | undefined> = [dateRange(OCCURRED_BALLET_REFUND, filters)];

    if (filters.refundStatuses.length > 0) {
      conditions.push(inArray(balletRefundsTable.status, filters.refundStatuses));
    }

    if (filters.paymentMethods.length > 0) {
      // The refund inherits the original payment's method classification.
      const rawMethods: string[] = [];
      let includeUnrecognized = false;
      for (const method of filters.paymentMethods) {
        if (method === "in_person") rawMethods.push("inPerson");
        else if (method === "kashier") rawMethods.push("kashier");
        else if (method === "bank_transfer") rawMethods.push("bankTransfer");
        else if (method === "unknown") includeUnrecognized = true;
      }
      const branches: SQL[] = [];
      if (rawMethods.length > 0) branches.push(inArray(balletPaymentsTable.paymentMethod, rawMethods));
      if (includeUnrecognized) {
        branches.push(sql`(${balletPaymentsTable.paymentMethod} is null or ${balletPaymentsTable.paymentMethod} not in ('inPerson','kashier','bankTransfer'))`);
      }
      const combined = branches.length === 1 ? branches[0] : or(...branches);
      if (combined) conditions.push(combined);
    }

    // "Any stored amount" — mirrors mapBalletRefund's anyStoredAmount exactly,
    // including that a refunded amount only counts once the refund completed.
    const anyStoredAmount = sql`(
      ${balletRefundsTable.requestedAmountEgp} is not null
      or ${balletRefundsTable.approvedAmountEgp} is not null
      or ${REFUND_COMPLETED}
    )`;
    const wantsExact =
      filters.amountAvailabilities.includes("exact") ||
      filters.reliabilityBadges.includes("recorded_refund");
    const wantsUnknown =
      filters.amountAvailabilities.includes("unknown") ||
      filters.reliabilityBadges.includes("unknown_amount");
    if (wantsExact && !wantsUnknown) conditions.push(anyStoredAmount);
    else if (wantsUnknown && !wantsExact) conditions.push(sql`not ${anyStoredAmount}`);

    const search = parseSearch(filters.search);
    if (search) {
      if (search.idPrefix != null) {
        conditions.push(
          search.idPrefix === "br" ? eq(balletRefundsTable.id, search.numericId!) : sql`false`,
        );
      } else if (search.numericId != null) {
        conditions.push(eq(balletRefundsTable.id, search.numericId));
      } else {
        const pattern = likePattern(search.raw);
        conditions.push(
          or(
            sql`${balletApplicationsTable.parentName} ilike ${pattern}`,
            sql`${balletApplicationsTable.parentEmail} ilike ${pattern}`,
            sql`${balletApplicationsTable.parentPhone} ilike ${pattern}`,
            sql`${balletApplicationsTable.childName} ilike ${pattern}`,
            sql`${balletRefundsTable.transactionReference} ilike ${pattern}`,
          ),
        );
      }
    }

    return { where: all(...conditions) };
  },
  async count(where) {
    const [row] = await db
      .select({ total: count() })
      .from(balletRefundsTable)
      .innerJoin(balletApplicationsTable, eq(balletRefundsTable.applicationId, balletApplicationsTable.id))
      .innerJoin(balletPaymentsTable, eq(balletRefundsTable.paymentId, balletPaymentsTable.id))
      .where(where);
    return Number(row?.total ?? 0);
  },
  async fetch(where, take) {
    const rows = await db
      .select({
        id: balletRefundsTable.id,
        applicationId: balletRefundsTable.applicationId,
        paymentId: balletRefundsTable.paymentId,
        status: balletRefundsTable.status,
        requestedAmountEgp: balletRefundsTable.requestedAmountEgp,
        approvedAmountEgp: balletRefundsTable.approvedAmountEgp,
        refundedAmountEgp: balletRefundsTable.refundedAmountEgp,
        transactionReference: balletRefundsTable.transactionReference,
        processedAt: balletRefundsTable.processedAt,
        reviewedAt: balletRefundsTable.reviewedAt,
        createdAt: balletRefundsTable.createdAt,
        processedByAdminId: balletRefundsTable.processedByAdminId,
        reviewedByAdminId: balletRefundsTable.reviewedByAdminId,
        processedByAdminEmail: processor.email,
        reviewedByAdminEmail: reviewer.email,
        parentStudentId: balletApplicationsTable.parentStudentId,
        parentName: balletApplicationsTable.parentName,
        parentEmail: balletApplicationsTable.parentEmail,
        parentPhone: balletApplicationsTable.parentPhone,
        childId: balletApplicationsTable.childId,
        childName: balletApplicationsTable.childName,
        originalPaymentMethod: balletPaymentsTable.paymentMethod,
        originalPaymentAmountEgp: balletPaymentsTable.amountEgp,
      })
      .from(balletRefundsTable)
      .innerJoin(balletApplicationsTable, eq(balletRefundsTable.applicationId, balletApplicationsTable.id))
      .innerJoin(balletPaymentsTable, eq(balletRefundsTable.paymentId, balletPaymentsTable.id))
      .leftJoin(processor, eq(balletRefundsTable.processedByAdminId, processor.id))
      .leftJoin(reviewer, eq(balletRefundsTable.reviewedByAdminId, reviewer.id))
      .where(where)
      .orderBy(sql`${OCCURRED_BALLET_REFUND} desc`, sql`${balletRefundsTable.id} desc`)
      .limit(take);
    return rows.map(mapBalletRefund);
  },
};

// ─── Family: package refunds (payment_refunds) ────────────────────────────────

const packageRefundRequester = alias(systemUsersTable, "finance_package_refund_requester");
const packageRefundReviewer = alias(systemUsersTable, "finance_package_refund_reviewer");
const packageRefundProcessor = alias(systemUsersTable, "finance_package_refund_processor");

const packageRefunds: FinanceFamilyDescriptor = {
  family: "package_refunds",
  eventTypes: ["package_refund"],
  plan(filters) {
    if (
      excludedBy(filters.eventTypes, this.eventTypes) ||
      filters.paymentStatuses.length > 0 ||
      excludedBy(filters.paymentMethods, ["cash", "card", "kashier", "bank_transfer", "unknown"]) ||
      excludedBy(filters.amountAvailabilities, ["exact"]) ||
      excludedBy(filters.reliabilityBadges, ["recorded_refund"])
    ) {
      return { where: null };
    }

    const conditions: Array<SQL | undefined> = [
      eq(paymentRecordsTable.flowType, "package_purchase"),
      dateRange(OCCURRED_PACKAGE_REFUND, filters),
    ];

    if (filters.refundStatuses.length > 0) {
      conditions.push(inArray(paymentRefundsTable.status, filters.refundStatuses));
    }

    if (filters.paymentMethods.length > 0) {
      const branches: SQL[] = [];
      for (const method of filters.paymentMethods) {
        if (method === "cash") {
          branches.push(or(
            eq(paymentRefundsTable.refundMethod, "cash"),
            and(
              eq(paymentRefundsTable.refundMethod, "original_payment_method"),
              eq(paymentRecordsTable.confirmedPaymentMethod, "cash"),
            ),
          )!);
        } else if (method === "card" || method === "kashier" || method === "bank_transfer") {
          branches.push(and(
            eq(paymentRefundsTable.refundMethod, "original_payment_method"),
            eq(paymentRecordsTable.confirmedPaymentMethod, method),
          )!);
        } else if (method === "unknown") {
          branches.push(and(
            eq(paymentRefundsTable.refundMethod, "original_payment_method"),
            or(
              sql`${paymentRecordsTable.confirmedPaymentMethod} is null`,
              eq(paymentRecordsTable.confirmedPaymentMethod, "unknown"),
            ),
          )!);
        }
      }
      const combined = branches.length === 1 ? branches[0] : or(...branches);
      if (combined) conditions.push(combined);
    }

    const search = parseSearch(filters.search);
    if (search) {
      if (search.idPrefix != null) {
        conditions.push(
          search.idPrefix === "pf" ? eq(paymentRefundsTable.id, search.numericId!) : sql`false`,
        );
      } else if (search.numericId != null) {
        conditions.push(eq(paymentRefundsTable.id, search.numericId));
      } else {
        const pattern = likePattern(search.raw);
        conditions.push(or(
          sql`${packageOrdersTable.studentName} ilike ${pattern}`,
          sql`${packageOrdersTable.studentEmail} ilike ${pattern}`,
          sql`${packageOrdersTable.studentPhone} ilike ${pattern}`,
          sql`${packageOrdersTable.packageName} ilike ${pattern}`,
          sql`${paymentRefundsTable.transactionReference} ilike ${pattern}`,
        ));
      }
    }

    return { where: all(...conditions) };
  },
  async count(where) {
    const [row] = await db
      .select({ total: count() })
      .from(paymentRefundsTable)
      .innerJoin(paymentRecordsTable, eq(paymentRefundsTable.paymentRecordId, paymentRecordsTable.id))
      .innerJoin(packageOrdersTable, eq(paymentRecordsTable.packageOrderId, packageOrdersTable.id))
      .where(where);
    return Number(row?.total ?? 0);
  },
  async fetch(where, take) {
    const rows = await db
      .select({
        id: paymentRefundsTable.id,
        status: paymentRefundsTable.status,
        requestedAmountMinor: paymentRefundsTable.requestedAmountMinor,
        approvedAmountMinor: paymentRefundsTable.approvedAmountMinor,
        refundedAmountMinor: paymentRefundsTable.refundedAmountMinor,
        refundMethod: paymentRefundsTable.refundMethod,
        requestedReason: paymentRefundsTable.requestedReason,
        transactionReference: paymentRefundsTable.transactionReference,
        createdAt: paymentRefundsTable.createdAt,
        reviewedAt: paymentRefundsTable.reviewedAt,
        processedAt: paymentRefundsTable.processedAt,
        requestedByAdminId: paymentRefundsTable.requestedByAdminId,
        reviewedByAdminId: paymentRefundsTable.reviewedByAdminId,
        processedByAdminId: paymentRefundsTable.processedByAdminId,
        requestedByAdminEmail: packageRefundRequester.email,
        reviewedByAdminEmail: packageRefundReviewer.email,
        processedByAdminEmail: packageRefundProcessor.email,
        originalPaymentMethod: paymentRecordsTable.confirmedPaymentMethod,
        originalPaymentAmountMinor: paymentRecordsTable.paidAmountMinor,
        packageOrderId: packageOrdersTable.id,
        packageId: packageOrdersTable.packageId,
        packageName: packageOrdersTable.packageName,
        studentId: packageOrdersTable.studentId,
        studentName: packageOrdersTable.studentName,
        studentEmail: packageOrdersTable.studentEmail,
        studentPhone: packageOrdersTable.studentPhone,
        participantType: packageOrdersTable.participantType,
        participantChildId: packageOrdersTable.participantChildId,
        participantName: packageOrdersTable.participantNameSnapshot,
      })
      .from(paymentRefundsTable)
      .innerJoin(paymentRecordsTable, eq(paymentRefundsTable.paymentRecordId, paymentRecordsTable.id))
      .innerJoin(packageOrdersTable, eq(paymentRecordsTable.packageOrderId, packageOrdersTable.id))
      .leftJoin(packageRefundRequester, eq(paymentRefundsTable.requestedByAdminId, packageRefundRequester.id))
      .leftJoin(packageRefundReviewer, eq(paymentRefundsTable.reviewedByAdminId, packageRefundReviewer.id))
      .leftJoin(packageRefundProcessor, eq(paymentRefundsTable.processedByAdminId, packageRefundProcessor.id))
      .where(where)
      .orderBy(sql`${OCCURRED_PACKAGE_REFUND} desc`, sql`${paymentRefundsTable.id} desc`)
      .limit(take);
    return rows.map(mapPackageRefund);
  },
};

// ─── Family: promotion discounts (promotion_redemptions) ──────────────────────

const discounts: FinanceFamilyDescriptor = {
  family: "discounts",
  eventTypes: ["promotion_discount"],
  plan(filters) {
    if (
      excludedBy(filters.eventTypes, this.eventTypes) ||
      filters.paymentStatuses.length > 0 ||
      filters.refundStatuses.length > 0 ||
      filters.paymentMethods.length > 0 ||
      excludedBy(filters.amountAvailabilities, ["exact", "unknown"]) ||
      excludedBy(filters.reliabilityBadges, ["recorded_discount", "unknown_amount"])
    ) {
      return { where: null };
    }

    const conditions: Array<SQL | undefined> = [
      dateRange(sql`${promotionRedemptionsTable.redeemedAt}`, filters),
    ];

    const wantsExact =
      filters.amountAvailabilities.includes("exact") ||
      filters.reliabilityBadges.includes("recorded_discount");
    const wantsUnknown =
      filters.amountAvailabilities.includes("unknown") ||
      filters.reliabilityBadges.includes("unknown_amount");
    if (wantsExact && !wantsUnknown) conditions.push(sql`${promotionRedemptionsTable.discountAmount} is not null`);
    else if (wantsUnknown && !wantsExact) conditions.push(sql`${promotionRedemptionsTable.discountAmount} is null`);

    const search = parseSearch(filters.search);
    if (search) {
      if (search.idPrefix != null) {
        conditions.push(
          search.idPrefix === "pr" ? eq(promotionRedemptionsTable.id, search.numericId!) : sql`false`,
        );
      } else if (search.numericId != null) {
        conditions.push(eq(promotionRedemptionsTable.id, search.numericId));
      } else {
        const pattern = likePattern(search.raw);
        conditions.push(
          or(
            sql`${studentsTable.name} ilike ${pattern}`,
            sql`${studentsTable.email} ilike ${pattern}`,
            sql`${studentsTable.phone} ilike ${pattern}`,
            sql`${promotionsTable.name} ilike ${pattern}`,
          ),
        );
      }
    }

    return { where: all(...conditions) };
  },
  async count(where) {
    const [row] = await db
      .select({ total: count() })
      .from(promotionRedemptionsTable)
      .leftJoin(studentsTable, eq(promotionRedemptionsTable.studentId, studentsTable.id))
      .leftJoin(promotionsTable, eq(promotionRedemptionsTable.promotionId, promotionsTable.id))
      .where(where);
    return Number(row?.total ?? 0);
  },
  async fetch(where, take) {
    const rows = await db
      .select({
        id: promotionRedemptionsTable.id,
        promotionId: promotionRedemptionsTable.promotionId,
        promotionName: promotionsTable.name,
        studentId: promotionRedemptionsTable.studentId,
        bookingId: promotionRedemptionsTable.bookingId,
        packageOrderId: promotionRedemptionsTable.packageOrderId,
        discountAmount: promotionRedemptionsTable.discountAmount,
        originalSubtotal: promotionRedemptionsTable.originalSubtotal,
        finalSubtotal: promotionRedemptionsTable.finalSubtotal,
        redeemedAt: promotionRedemptionsTable.redeemedAt,
        studentName: studentsTable.name,
        studentEmail: studentsTable.email,
        studentPhone: studentsTable.phone,
      })
      .from(promotionRedemptionsTable)
      .leftJoin(studentsTable, eq(promotionRedemptionsTable.studentId, studentsTable.id))
      .leftJoin(promotionsTable, eq(promotionRedemptionsTable.promotionId, promotionsTable.id))
      .where(where)
      .orderBy(sql`${promotionRedemptionsTable.redeemedAt} desc`, sql`${promotionRedemptionsTable.id} desc`)
      .limit(take);
    return rows.map(mapPromotionDiscount);
  },
};

// ─── Family: package credits (credit_transactions) ────────────────────────────

const packageCredits: FinanceFamilyDescriptor = {
  family: "package_credits",
  eventTypes: ["package_credit_issuance", "package_credit_consumption", "future_manual_adjustment"],
  plan(filters) {
    if (
      excludedBy(filters.eventTypes, this.eventTypes) ||
      filters.paymentStatuses.length > 0 ||
      filters.refundStatuses.length > 0 ||
      excludedBy(filters.paymentMethods, ["package_credit"]) ||
      excludedBy(filters.amountAvailabilities, ["not_applicable"]) ||
      excludedBy(filters.reliabilityBadges, ["service_credit_unit"])
    ) {
      return { where: null };
    }

    const conditions: Array<SQL | undefined> = [
      dateRange(sql`${creditTransactionsTable.createdAt}`, filters),
    ];

    // Translate event-type filters back to the ledger's own `type` values,
    // matching classifyCreditTransaction (including its sign fallback for a
    // type the current code does not know about).
    if (filters.eventTypes.length > 0) {
      const known = [
        ...CREDIT_ISSUANCE_TYPES,
        ...CREDIT_CONSUMPTION_TYPES,
        ...CREDIT_ADJUSTMENT_TYPES,
      ] as readonly string[];
      const branches: SQL[] = [];
      if (filters.eventTypes.includes("package_credit_issuance")) {
        branches.push(sql`(${creditTransactionsTable.type} in ${[...CREDIT_ISSUANCE_TYPES]} or (${creditTransactionsTable.type} not in ${[...known]} and ${creditTransactionsTable.delta} >= 0))`);
      }
      if (filters.eventTypes.includes("package_credit_consumption")) {
        branches.push(sql`(${creditTransactionsTable.type} in ${[...CREDIT_CONSUMPTION_TYPES]} or (${creditTransactionsTable.type} not in ${[...known]} and ${creditTransactionsTable.delta} < 0))`);
      }
      if (filters.eventTypes.includes("future_manual_adjustment")) {
        branches.push(sql`${creditTransactionsTable.type} in ${[...CREDIT_ADJUSTMENT_TYPES]}`);
      }
      const combined = branches.length === 1 ? branches[0] : or(...branches);
      if (combined) conditions.push(combined);
    }

    const search = parseSearch(filters.search);
    if (search) {
      if (search.idPrefix != null) {
        conditions.push(
          search.idPrefix === "ct" ? eq(creditTransactionsTable.id, search.numericId!) : sql`false`,
        );
      } else if (search.numericId != null) {
        conditions.push(eq(creditTransactionsTable.id, search.numericId));
      } else {
        const pattern = likePattern(search.raw);
        conditions.push(
          or(
            sql`${studentsTable.name} ilike ${pattern}`,
            sql`${studentsTable.email} ilike ${pattern}`,
            sql`${studentsTable.phone} ilike ${pattern}`,
            sql`${packageOrdersTable.packageName} ilike ${pattern}`,
          ),
        );
      }
    }

    return { where: all(...conditions) };
  },
  async count(where) {
    const [row] = await db
      .select({ total: count() })
      .from(creditTransactionsTable)
      .leftJoin(packageOrdersTable, eq(creditTransactionsTable.packageOrderId, packageOrdersTable.id))
      .leftJoin(studentsTable, eq(creditTransactionsTable.studentId, studentsTable.id))
      .leftJoin(childrenTable, eq(creditTransactionsTable.participantChildId, childrenTable.id))
      .where(where);
    return Number(row?.total ?? 0);
  },
  async fetch(where, take) {
    const rows = await db
      .select({
        id: creditTransactionsTable.id,
        packageOrderId: creditTransactionsTable.packageOrderId,
        studentId: creditTransactionsTable.studentId,
        participantType: creditTransactionsTable.participantType,
        participantChildId: creditTransactionsTable.participantChildId,
        type: creditTransactionsTable.type,
        delta: creditTransactionsTable.delta,
        balanceBefore: creditTransactionsTable.balanceBefore,
        balanceAfter: creditTransactionsTable.balanceAfter,
        referenceId: creditTransactionsTable.referenceId,
        referenceType: creditTransactionsTable.referenceType,
        createdAt: creditTransactionsTable.createdAt,
        createdBy: creditTransactionsTable.createdBy,
        packageName: packageOrdersTable.packageName,
        packageId: packageOrdersTable.packageId,
        studentName: studentsTable.name,
        studentEmail: studentsTable.email,
        studentPhone: studentsTable.phone,
        participantName: packageOrdersTable.participantNameSnapshot,
        childName: childrenTable.fullName,
      })
      .from(creditTransactionsTable)
      .leftJoin(packageOrdersTable, eq(creditTransactionsTable.packageOrderId, packageOrdersTable.id))
      .leftJoin(studentsTable, eq(creditTransactionsTable.studentId, studentsTable.id))
      .leftJoin(childrenTable, eq(creditTransactionsTable.participantChildId, childrenTable.id))
      .where(where)
      .orderBy(sql`${creditTransactionsTable.createdAt} desc`, sql`${creditTransactionsTable.id} desc`)
      .limit(take);
    return rows.map(mapCreditTransaction);
  },
};

// ─── Registry + merge ─────────────────────────────────────────────────────────

export const FINANCE_FAMILY_DESCRIPTORS: readonly FinanceFamilyDescriptor[] = [
  packagePurchases,
  bookingFamily("class_payments"),
  bookingFamily("walkin_payments"),
  balletPayments,
  balletAssessmentFees,
  balletRefunds,
  packageRefunds,
  discounts,
  packageCredits,
];

/**
 * Newest first, with the synthetic event id as the deterministic tiebreaker so
 * a page boundary can never repeat or skip a row between requests.
 */
export function compareFinanceTransactions(
  a: UnifiedFinanceTransaction,
  b: UnifiedFinanceTransaction,
): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export interface FinancePage {
  data: UnifiedFinanceTransaction[];
  total: number;
}

/**
 * Fetch one page across the given families.
 *
 * `allowedFamilies` has already been intersected with the caller's permissions
 * by the route, so an unauthorized family never reaches a query and never
 * contributes to `total`.
 */
export async function queryFinanceTransactions(
  allowedFamilies: readonly FinanceSourceFamily[],
  filters: FinanceTransactionFilters,
  page: number,
  limit: number,
): Promise<FinancePage> {
  const active = FINANCE_FAMILY_DESCRIPTORS.filter((descriptor) =>
    allowedFamilies.includes(descriptor.family),
  )
    .map((descriptor) => ({ descriptor, plan: descriptor.plan(filters) }))
    // `where: null` means the filters exclude this family outright.
    .filter((entry) => entry.plan.where !== null);

  if (active.length === 0) return { data: [], total: 0 };

  // The global top (page × limit) rows are contained in the union of each
  // family's own top (page × limit) rows, so this window is sufficient — and
  // bounded, because the route caps both page and limit.
  const take = page * limit;

  const results = await Promise.all(
    active.map(async ({ descriptor, plan }) => {
      const where = plan.where as SQL | undefined;
      const [total, rows] = await Promise.all([
        descriptor.count(where),
        descriptor.fetch(where, take),
      ]);
      return { total, rows };
    }),
  );

  const total = results.reduce((sum, result) => sum + result.total, 0);
  const merged = results
    .flatMap((result) => result.rows)
    .sort(compareFinanceTransactions)
    .slice((page - 1) * limit, page * limit);

  return { data: merged, total };
}

/**
 * Fetch up to `cap` rows in one shot for the export, using the same families,
 * filters, mapping and ordering as the paginated endpoint. Kept separate from
 * queryFinanceTransactions so the export cannot silently diverge, and hard
 * capped so an export can never become an unbounded scan.
 */
export async function queryFinanceTransactionsForExport(
  allowedFamilies: readonly FinanceSourceFamily[],
  filters: FinanceTransactionFilters,
  cap: number,
): Promise<{ data: UnifiedFinanceTransaction[]; total: number; truncated: boolean }> {
  const active = FINANCE_FAMILY_DESCRIPTORS.filter((descriptor) =>
    allowedFamilies.includes(descriptor.family),
  )
    .map((descriptor) => ({ descriptor, plan: descriptor.plan(filters) }))
    .filter((entry) => entry.plan.where !== null);

  if (active.length === 0) return { data: [], total: 0, truncated: false };

  const results = await Promise.all(
    active.map(async ({ descriptor, plan }) => {
      const where = plan.where as SQL | undefined;
      const [total, rows] = await Promise.all([
        descriptor.count(where),
        descriptor.fetch(where, cap),
      ]);
      return { total, rows };
    }),
  );

  const total = results.reduce((sum, result) => sum + result.total, 0);
  const data = results
    .flatMap((result) => result.rows)
    .sort(compareFinanceTransactions)
    .slice(0, cap);

  return { data, total, truncated: total > data.length };
}
