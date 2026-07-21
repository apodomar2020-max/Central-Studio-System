import { Router, type IRouter } from "express";
import { z } from "zod";
import { classReminderSettingsTable, db } from "@workspace/db";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  getOrCreateClassReminderSettings,
  shapeClassReminderSettingsClient,
} from "../lib/classReminderSettings";
import { getPushStatus } from "../lib/pushNotifications";
import { classifyWorkerHealth, getReminderWorkerHeartbeat } from "../lib/reminderWorkerHeartbeat";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

const REMINDER_SETTINGS_FIELDS = [
  "automaticRemindersEnabled",
  "classReminder24hEnabled",
  "classReminder1hEnabled",
  "postClassRating3hEnabled",
] as const;

const UpdateClassReminderSettingsBody = z.object({
  automaticRemindersEnabled: z.boolean().optional(),
  classReminder24hEnabled: z.boolean().optional(),
  classReminder1hEnabled: z.boolean().optional(),
  postClassRating3hEnabled: z.boolean().optional(),
}).strict();

router.get(
  "/admin/settings/class-reminders",
  requireAdminAuth,
  requireAdminPermission("settings", "view"),
  async (_req, res): Promise<void> => {
    const settings = await getOrCreateClassReminderSettings();
    res.json(shapeClassReminderSettingsClient(settings));
  },
);

router.patch(
  "/admin/settings/class-reminders",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = UpdateClassReminderSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid class reminder settings" });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "At least one setting must be provided" });
      return;
    }

    const beforeSettings = await getOrCreateClassReminderSettings();
    const nextValues = {
      automaticRemindersEnabled: parsed.data.automaticRemindersEnabled ?? beforeSettings.automaticRemindersEnabled,
      classReminder24hEnabled: parsed.data.classReminder24hEnabled ?? beforeSettings.classReminder24hEnabled,
      classReminder1hEnabled: parsed.data.classReminder1hEnabled ?? beforeSettings.classReminder1hEnabled,
      postClassRating3hEnabled: parsed.data.postClassRating3hEnabled ?? beforeSettings.postClassRating3hEnabled,
    };

    const [settings] = await db
      .insert(classReminderSettingsTable)
      .values({ id: 1, ...nextValues, updatedByAdminId: req.adminUser?.id ?? null })
      .onConflictDoUpdate({
        target: classReminderSettingsTable.id,
        set: { ...nextValues, updatedByAdminId: req.adminUser?.id ?? null, updatedAt: new Date().toISOString() },
      })
      .returning();

    const { before, after } = diffFields(
      Object.fromEntries(REMINDER_SETTINGS_FIELDS.map((key) => [key, beforeSettings[key]])),
      Object.fromEntries(REMINDER_SETTINGS_FIELDS.map((key) => [key, settings[key]])),
      REMINDER_SETTINGS_FIELDS,
    );
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: "update",
        module: "settings",
        entityType: "class_reminder_settings",
        entityId: settings.id,
        entityLabel: "Class reminder settings",
        before,
        after,
        summary: `Updated class reminder settings: ${Object.keys(after).join(", ")}`,
      });
    }

    res.json(shapeClassReminderSettingsClient(settings));
  },
);

router.get(
  "/admin/settings/class-reminders/status",
  requireAdminAuth,
  requireAdminPermission("settings", "view"),
  async (_req, res): Promise<void> => {
    const [settings, heartbeat] = await Promise.all([
      getOrCreateClassReminderSettings(),
      getReminderWorkerHeartbeat(),
    ]);
    const apiPush = getPushStatus();
    const workerPushEnabled = heartbeat?.pushNotificationsEnabled ?? null;
    const pushConfigMismatch = workerPushEnabled != null && workerPushEnabled !== apiPush.enabled;

    res.json({
      settings: shapeClassReminderSettingsClient(settings),
      worker: {
        status: classifyWorkerHealth(heartbeat),
        queueWorkerEnabled: heartbeat?.queueWorkerEnabled ?? null,
        pushNotificationsEnabled: workerPushEnabled,
        lastHeartbeatAt: heartbeat?.lastHeartbeatAt ?? null,
        lastReminderRunAt: heartbeat?.lastReminderRunAt ?? null,
        lastReminderRunStatus: heartbeat?.lastReminderRunStatus ?? null,
        lastReminderRunSummary: heartbeat?.lastReminderRunSummary ?? null,
        deployedVersion: heartbeat?.deployedVersion ?? null,
      },
      api: {
        pushNotificationsEnabled: apiPush.enabled,
      },
      pushConfigMismatch,
    });
  },
);

export default router;
