import { eq } from "drizzle-orm";
import { db, schedulesTable, classPricingSettingsTable } from "@workspace/db";

export type SingleClassPriceClient = Pick<typeof db, "select">;

export const DEFAULT_SINGLE_CLASS_PRICE_EGP = 300;

// Finance Phase 2B-2/2B-4: the single, shared server-side price authority
// for an ordinary single class — used identically by Single-Class Booking
// Creation Capture (bookings.ts), the Finance Phase 1 read model
// (financeSources.ts's BOOKING_RESOLVED_PRICE / financialAggregates.ts), and
// Studio Walk-in Atomic Monetary Capture (checkInService.ts) — so the price
// a caller displays and the price Finance captures can never disagree; they
// are the exact same function call.
//
// coalesce(schedules.price_egp, class_pricing_settings.single_class_price_egp).
// A schedule-level override wins when set; otherwise the Studio-wide default
// always resolves (class_pricing_settings is a singleton row, lazily seeded
// on first read exactly like classPricing.ts's own
// getOrCreateClassPricingSettings — never a hard-coded/zero fallback here).
export async function resolveSingleClassPriceEgp(
  client: SingleClassPriceClient,
  scheduleId: number | null,
): Promise<number> {
  if (scheduleId != null) {
    const [schedule] = await client
      .select({ priceEgp: schedulesTable.priceEgp })
      .from(schedulesTable)
      .where(eq(schedulesTable.id, scheduleId))
      .limit(1);
    if (schedule?.priceEgp != null) return schedule.priceEgp;
  }

  const [settings] = await client
    .select({ singleClassPriceEgp: classPricingSettingsTable.singleClassPriceEgp })
    .from(classPricingSettingsTable)
    .where(eq(classPricingSettingsTable.id, 1))
    .limit(1);
  if (settings) return settings.singleClassPriceEgp;

  return DEFAULT_SINGLE_CLASS_PRICE_EGP;
}
