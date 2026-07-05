import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, classPricingSettingsTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();

const DEFAULT_SINGLE_CLASS_PRICE_EGP = 300;

const UpdateClassPricingBody = z.object({
  singleClassPriceEgp: z.coerce.number().int().min(0),
});

async function getOrCreateClassPricingSettings() {
  const [existing] = await db
    .select()
    .from(classPricingSettingsTable)
    .where(eq(classPricingSettingsTable.id, 1));

  if (existing) return existing;

  const [created] = await db
    .insert(classPricingSettingsTable)
    .values({ id: 1, singleClassPriceEgp: DEFAULT_SINGLE_CLASS_PRICE_EGP })
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
    .values({ id: 1, singleClassPriceEgp: parsed.data.singleClassPriceEgp })
    .onConflictDoUpdate({
      target: classPricingSettingsTable.id,
      set: {
        singleClassPriceEgp: parsed.data.singleClassPriceEgp,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();

  const { before, after } = diffFields(
    { singleClassPriceEgp: beforeSettings.singleClassPriceEgp },
    { singleClassPriceEgp: settings.singleClassPriceEgp },
    ["singleClassPriceEgp"],
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
