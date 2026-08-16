import { customFetch } from "@workspace/api-client-react";

export interface ClassPricingSettings {
  id: number;
  singleClassPriceEgp: number;
  adultsWalkinPriceEgp: number | null;
  teensWalkinPriceEgp: number | null;
  kidsWalkinPriceEgp: number | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SINGLE_CLASS_PRICE_EGP = 300;

export async function fetchClassPricing(): Promise<ClassPricingSettings> {
  return customFetch<ClassPricingSettings>("/api/settings/class-pricing");
}

/**
 * Single source of walk-in price resolution on the mobile client — mirrors
 * the backend's resolveSingleClassPriceEgp order (singleClassPricing.ts) for
 * everything short of a live schedule-specific override (the backend always
 * re-resolves and is authoritative for anything actually charged; this is
 * display-only): class's assigned pricing category -> that category's
 * configured price -> legacy Studio-wide single price -> hard-coded floor.
 *
 * Never invents a number the backend doesn't also know about — every value
 * consulted here comes straight from the /api/settings/class-pricing
 * response and the class's own `pricingCategory` field.
 */
export function resolveWalkinPriceEgp(
  pricingCategory: string | null | undefined,
  settings: ClassPricingSettings | undefined,
): number {
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
