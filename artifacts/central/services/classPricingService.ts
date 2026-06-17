import { customFetch } from "@workspace/api-client-react";

export interface ClassPricingSettings {
  id: number;
  singleClassPriceEgp: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SINGLE_CLASS_PRICE_EGP = 300;

export async function fetchClassPricing(): Promise<ClassPricingSettings> {
  return customFetch<ClassPricingSettings>("/api/settings/class-pricing");
}
