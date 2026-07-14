import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, classCapacitySettingsTable } from "@workspace/db";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  getOrCreateClassCapacitySettings,
  getOverCapacityOccurrences,
  shapeClassCapacitySettingsClient,
} from "../lib/classCapacitySettings";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

const UpdateClassCapacityBody = z.object({
  classCapacityEnabled: z.boolean(),
  confirmOverCapacity: z.boolean().optional(),
});

router.get("/settings/class-capacity", async (_req, res): Promise<void> => {
  const settings = await getOrCreateClassCapacitySettings();
  res.json(shapeClassCapacitySettingsClient(settings));
});

router.get(
  "/admin/settings/class-capacity",
  requireAdminAuth,
  requireAdminPermission("settings", "view"),
  async (_req, res): Promise<void> => {
    const settings = await getOrCreateClassCapacitySettings();
    const overCapacityOccurrences = await getOverCapacityOccurrences();
    res.json(shapeClassCapacitySettingsClient(settings, overCapacityOccurrences));
  },
);

router.patch(
  "/admin/settings/class-capacity",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = UpdateClassCapacityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid class capacity settings" });
      return;
    }

    const beforeSettings = await getOrCreateClassCapacitySettings();
    const overCapacityOccurrences = parsed.data.classCapacityEnabled
      ? await getOverCapacityOccurrences()
      : [];

    if (
      !beforeSettings.classCapacityEnabled &&
      parsed.data.classCapacityEnabled &&
      overCapacityOccurrences.length > 0 &&
      parsed.data.confirmOverCapacity !== true
    ) {
      res.status(409).json({
        error: "over_capacity_warning",
        message: "Some active class occurrences already exceed their stored capacity. Confirm before re-enabling capacity enforcement.",
        overCapacityOccurrences,
      });
      return;
    }

    const [settings] = await db
      .insert(classCapacitySettingsTable)
      .values({
        id: 1,
        classCapacityEnabled: parsed.data.classCapacityEnabled,
        updatedByAdminId: req.adminUser?.id ?? null,
      })
      .onConflictDoUpdate({
        target: classCapacitySettingsTable.id,
        set: {
          classCapacityEnabled: parsed.data.classCapacityEnabled,
          updatedByAdminId: req.adminUser?.id ?? null,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();

    const { before, after } = diffFields(
      { classCapacityEnabled: beforeSettings.classCapacityEnabled },
      { classCapacityEnabled: settings.classCapacityEnabled },
      ["classCapacityEnabled"],
    );
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: settings.classCapacityEnabled ? "activate" : "deactivate",
        module: "settings",
        entityType: "class_capacity_settings",
        entityId: settings.id,
        entityLabel: "Class capacity",
        before,
        after,
        summary: settings.classCapacityEnabled
          ? "Enabled class capacity enforcement"
          : "Disabled class capacity enforcement",
      });
    }

    res.json(shapeClassCapacitySettingsClient(settings, overCapacityOccurrences));
  },
);

export default router;
