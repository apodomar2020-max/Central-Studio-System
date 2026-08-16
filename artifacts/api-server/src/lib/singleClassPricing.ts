import { eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  schedulesTable,
  classesTable,
  classPricingSettingsTable,
  PRICING_CATEGORIES,
  type PricingCategory,
} from "@workspace/db";

export type SingleClassPriceClient = Pick<typeof db, "select">;

export const DEFAULT_SINGLE_CLASS_PRICE_EGP = 300;

export { PRICING_CATEGORIES, type PricingCategory };

export function isPricingCategory(value: unknown): value is PricingCategory {
  return typeof value === "string" && (PRICING_CATEGORIES as readonly string[]).includes(value);
}

/**
 * SQL CASE expression mapping a `classes.pricing_category` column reference
 * (or an alias of it) to the matching configured category price on
 * `class_pricing_settings` (or an alias of it). `null` when the category is
 * unset/unrecognized — the caller's coalesce chain then falls through to
 * `single_class_price_egp`.
 *
 * Shared by every SQL-level price estimate (Finance's legacy-estimate
 * coalesce in financeSources.ts / financialAggregates.ts) so the
 * category → price mapping is defined in exactly one place and can never
 * drift from resolveSingleClassPriceEgp below.
 */
export function categoryWalkinPriceSql(
  pricingCategoryColumn: PgColumn,
  settings: typeof classPricingSettingsTable,
): SQL<number | null> {
  return sql<number | null>`case ${pricingCategoryColumn}
    when 'adults' then ${settings.adultsWalkinPriceEgp}
    when 'teens' then ${settings.teensWalkinPriceEgp}
    when 'kids' then ${settings.kidsWalkinPriceEgp}
    else null
  end`;
}

export interface ResolveSingleClassPriceParams {
  /** The occurrence's schedule, when known. A non-null schedule.priceEgp always wins. */
  scheduleId?: number | null;
  /**
   * The class, when known independently of a schedule (e.g. a schedule-less
   * booking, or as a fallback when the schedule itself has no priceEgp
   * override). Used to resolve the class's pricing category. If omitted but
   * scheduleId is given, the class is derived from schedules.class_id.
   */
  classId?: number | null;
}

// Finance Phase 2B-2/2B-4, extended for category pricing: the single,
// shared server-side price authority for an ordinary single class — used
// identically by Single-Class Booking Creation Capture (bookings.ts), the
// Finance Phase 1 read model (financeSources.ts's BOOKING_RESOLVED_PRICE /
// financialAggregates.ts, via categoryWalkinPriceSql above), the Attendance
// Gateway walk-in preview (adminAttendanceGateway.ts), and Studio Walk-in
// Atomic Monetary Capture (checkInService.ts) — so the price a caller
// displays and the price Finance captures can never disagree; they are the
// exact same function call.
//
// Resolution order:
//   1. schedules.price_egp                              (schedule override)
//   2. class_pricing_settings.<category>_walkin_price_egp (category price)
//   3. class_pricing_settings.single_class_price_egp      (legacy fallback)
//   4. DEFAULT_SINGLE_CLASS_PRICE_EGP                     (hard-coded floor)
//
// Step 2 only applies when the class has an assigned pricing_category AND
// that category's price is configured (not null) — an unassigned class (the
// default for every class that existed before this feature) or an
// unconfigured category price transparently falls through to step 3, which
// is exactly today's pre-category behavior. class_pricing_settings is a
// singleton row, lazily seeded on first read exactly like classPricing.ts's
// own getOrCreateClassPricingSettings — never a hard-coded/zero fallback
// until every table lookup has genuinely come back empty.
export async function resolveSingleClassPriceEgp(
  client: SingleClassPriceClient,
  params: ResolveSingleClassPriceParams,
): Promise<number> {
  let resolvedClassId = params.classId ?? null;

  if (params.scheduleId != null) {
    const [schedule] = await client
      .select({ priceEgp: schedulesTable.priceEgp, classId: schedulesTable.classId })
      .from(schedulesTable)
      .where(eq(schedulesTable.id, params.scheduleId))
      .limit(1);
    if (schedule?.priceEgp != null) return schedule.priceEgp;
    if (resolvedClassId == null) resolvedClassId = schedule?.classId ?? null;
  }

  let pricingCategory: PricingCategory | null = null;
  if (resolvedClassId != null) {
    const [klass] = await client
      .select({ pricingCategory: classesTable.pricingCategory })
      .from(classesTable)
      .where(eq(classesTable.id, resolvedClassId))
      .limit(1);
    if (isPricingCategory(klass?.pricingCategory)) pricingCategory = klass.pricingCategory;
  }

  const [settings] = await client
    .select({
      singleClassPriceEgp: classPricingSettingsTable.singleClassPriceEgp,
      adultsWalkinPriceEgp: classPricingSettingsTable.adultsWalkinPriceEgp,
      teensWalkinPriceEgp: classPricingSettingsTable.teensWalkinPriceEgp,
      kidsWalkinPriceEgp: classPricingSettingsTable.kidsWalkinPriceEgp,
    })
    .from(classPricingSettingsTable)
    .where(eq(classPricingSettingsTable.id, 1))
    .limit(1);

  if (settings) {
    const categoryPrice =
      pricingCategory === "adults" ? settings.adultsWalkinPriceEgp
      : pricingCategory === "teens" ? settings.teensWalkinPriceEgp
      : pricingCategory === "kids" ? settings.kidsWalkinPriceEgp
      : null;
    if (categoryPrice != null) return categoryPrice;
    return settings.singleClassPriceEgp;
  }

  return DEFAULT_SINGLE_CLASS_PRICE_EGP;
}
