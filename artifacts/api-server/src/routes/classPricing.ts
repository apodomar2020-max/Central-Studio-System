import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, classPricingSettingsTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();

const DEFAULT_SINGLE_CLASS_PRICE_EGP = 300;

// Category prices are optional on write: omitting a category leaves its
// current configured value untouched (or unconfigured, if it never was) —
// only singleClassPriceEgp is mandatory, preserving the legacy
// always-required contract this endpoint had before category pricing.
const UpdateClassPricingBody = z.object({
  singleClassPriceEgp: z.coerce.number().int().min(0),
  adultsWalkinPriceEgp: z.coerce.number().int().min(0).nullish(),
  teensWalkinPriceEgp: z.coerce.number().int().min(0).nullish(),
  kidsWalkinPriceEgp: z.coerce.number().int().min(0).nullish(),
});

const CLASS_PRICING_ACTIVITY_FIELDS = [
  "singleClassPriceEgp",
  "adultsWalkinPriceEgp",
  "teensWalkinPriceEgp",
  "kidsWalkinPriceEgp",
] as const;

async function getOrCreateClassPricingSettings() {
  const [existing] = await db
    .select()
    .from(classPricingSettingsTable)
    .where(eq(classPricingSettingsTable.id, 1));

  if (existing) return existing;

  // Freshly seeded singleton: category prices start equal to the legacy
  // default so a brand-new deployment behaves identically whether or not any
  // class has a pricing category assigned yet.
  const [created] = await db
    .insert(classPricingSettingsTable)
    .values({
      id: 1,
      singleClassPriceEgp: DEFAULT_SINGLE_CLASS_PRICE_EGP,
      adultsWalkinPriceEgp: DEFAULT_SINGLE_CLASS_PRICE_EGP,
      teensWalkinPriceEgp: DEFAULT_SINGLE_CLASS_PRICE_EGP,
      kidsWalkinPriceEgp: DEFAULT_SINGLE_CLASS_PRICE_EGP,
    })
    .returning();

  return created;
}

router.get("/settings/class-pricing", async (_req, res): Promise<void> => {
  const settings = await getOrCreateClassPricingSettings();
  res.json(settings);
});

router.get("/admin/settings/class-pricing", requireAdminAuth, requireAdminPermission("settings", "view"), async (_req, res): Promise<void> => {
  const settings = await getOrCreateClassPricingSettings();
  res.json(settings);
});

router.patch("/admin/settings/class-pricing", requireAdminAuth, requireAdminPermission("settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = UpdateClassPricingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid class pricing" });
    return;
  }

  const beforeSettings = await getOrCreateClassPricingSettings();
  const [settings] = await db
    .insert(classPricingSettingsTable)
    .values({
      id: 1,
      singleClassPriceEgp: parsed.data.singleClassPriceEgp,
      // Only overwrite a category price when it was actually included in the
      // request body — omitted (undefined) means "leave as configured",
      // while an explicit null clears it back to "unconfigured" (falls
      // through to the legacy single price).
      ...(parsed.data.adultsWalkinPriceEgp !== undefined ? { adultsWalkinPriceEgp: parsed.data.adultsWalkinPriceEgp } : {}),
      ...(parsed.data.teensWalkinPriceEgp !== undefined ? { teensWalkinPriceEgp: parsed.data.teensWalkinPriceEgp } : {}),
      ...(parsed.data.kidsWalkinPriceEgp !== undefined ? { kidsWalkinPriceEgp: parsed.data.kidsWalkinPriceEgp } : {}),
    })
    .onConflictDoUpdate({
      target: classPricingSettingsTable.id,
      set: {
        singleClassPriceEgp: parsed.data.singleClassPriceEgp,
        ...(parsed.data.adultsWalkinPriceEgp !== undefined ? { adultsWalkinPriceEgp: parsed.data.adultsWalkinPriceEgp } : {}),
        ...(parsed.data.teensWalkinPriceEgp !== undefined ? { teensWalkinPriceEgp: parsed.data.teensWalkinPriceEgp } : {}),
        ...(parsed.data.kidsWalkinPriceEgp !== undefined ? { kidsWalkinPriceEgp: parsed.data.kidsWalkinPriceEgp } : {}),
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();

  const { before, after } = diffFields(
    Object.fromEntries(CLASS_PRICING_ACTIVITY_FIELDS.map((key) => [key, beforeSettings[key]])),
    Object.fromEntries(CLASS_PRICING_ACTIVITY_FIELDS.map((key) => [key, settings[key]])),
    CLASS_PRICING_ACTIVITY_FIELDS,
  );
  if (Object.keys(after).length > 0) {
    await logActivity(req, {
      action: "update",
      module: "settings",
      entityType: "class_pricing_settings",
      entityId: settings.id,
      entityLabel: "Class pricing",
      before,
      after,
      summary: "Updated class pricing settings",
    });
  }

  res.json(settings);
});

export default router;
