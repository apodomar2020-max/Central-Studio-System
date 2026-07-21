import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  notificationDeliveryLogsTable,
  notificationDevicesTable,
  notificationReadReceiptsTable,
  notificationsTable,
} from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { getPushStatus, sendBroadcastPushNotification, sendPushNotification } from "../lib/pushNotifications";
import { logger } from "../lib/logger";
import {
  runClassReminderAutomation,
  runClassReminder24h,
  runNotificationAutomation,
  runPackageReminderAutomation,
  runPostClassReminderAutomation,
  type AutomationRunSummary,
  type AutomationSummary,
  type RunOptions,
} from "../lib/notificationReminders";
import { diffFields, logActivity } from "../lib/activityLog";
import { enqueueJob, QUEUE_NAMES, type NotificationAutomationJob } from "../lib/queue";
import {
  CreateNotificationBody,
  GetNotificationParams,
  GetNotificationResponse,
  UpdateNotificationParams,
  UpdateNotificationBody,
  UpdateNotificationResponse,
  DeleteNotificationParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
const NOTIFICATION_ACTIVITY_FIELDS = ["title", "body", "target", "type", "relatedEntityType", "relatedEntityId", "metadata", "sentAt", "isDraft"] as const;

const MyNotificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const DeviceRegisterBody = z.object({
  pushToken: z.string().min(10),
  provider: z.literal("expo").default("expo"),
  platform: z.enum(["ios", "android", "unknown"]).default("unknown"),
  deviceId: z.string().optional(),
});

const DeviceUnregisterBody = z.object({
  pushToken: z.string().min(10).optional(),
  deviceId: z.string().optional(),
}).refine((value) => Boolean(value.pushToken || value.deviceId), {
  message: "pushToken or deviceId is required",
});

const AutomationType = z.enum(["all", "class_reminders", "post_class_reminders", "package_reminders"]);
const AutomationRunBody = z.object({
  mode: z.enum(["run", "enqueue"]).default("run"),
  type: AutomationType.default("all"),
  // Bypasses reminder-category settings (Phase 6). Gated below on
  // isSuperAdmin — this replaces the previous undocumented behavior where a
  // manual run always ignored settings entirely.
  force: z.boolean().default(false),
});

type AutomationTypeValue = z.infer<typeof AutomationType>;

function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

async function runAutomationByType(type: AutomationTypeValue, options: RunOptions = {}): Promise<AutomationRunSummary | AutomationSummary> {
  switch (type) {
    case "all":
      return runNotificationAutomation(options);
    case "class_reminders":
      return runClassReminderAutomation(options);
    case "post_class_reminders":
      return runPostClassReminderAutomation(options);
    case "package_reminders":
      // Package reminders are not gated by class-reminder settings (out of
      // Phase 6 scope) — force has no effect here.
      return runPackageReminderAutomation();
  }
}

function isAutomationRunSummary(result: AutomationRunSummary | AutomationSummary): result is AutomationRunSummary {
  return "total" in result;
}

function automationAuditSummary(type: string, result: AutomationRunSummary | AutomationSummary): Record<string, unknown> {
  const total = isAutomationRunSummary(result) ? result.total : result;
  return {
    automationType: type,
    selected: total.selected,
    eligible: total.eligible,
    created: total.created,
    duplicateSkipped: total.duplicateSkipped,
    disabledSkipped: total.disabledSkipped,
    inactiveScheduleSkipped: total.inactiveScheduleSkipped,
    missingOccurrence: total.missingOccurrence,
    unresolvedTarget: total.unresolvedTarget,
    pushed: total.pushed,
    pushFailed: total.pushFailed,
    noActiveDevice: total.noActiveDevice,
    pushDisabled: total.pushDisabled,
  };
}

function isNotificationVisibleToStudent(row: { target: string; isDraft: boolean }, studentId: number): boolean {
  return !row.isDraft && (row.target === "all" || row.target === `student:${studentId}`);
}

function dispatchPushForNotification(row: typeof notificationsTable.$inferSelect): void {
  if (row.isDraft) return;
  const data = {
    type: row.type ?? "notification",
    relatedEntityType: row.relatedEntityType,
    relatedEntityId: row.relatedEntityId,
  };
  const studentMatch = /^student:(\d+)$/.exec(row.target);
  if (studentMatch) {
    void sendPushNotification({
      studentId: Number(studentMatch[1]),
      title: row.title,
      body: row.body,
      data,
      notificationId: row.id,
    });
    return;
  }
  if (row.target === "all") {
    void sendBroadcastPushNotification({
      title: row.title,
      body: row.body,
      data,
      notificationId: row.id,
    });
  }
}

const requireSendWhenPublishing = (req: Request, res: Response, next: NextFunction): void => {
  if (req.body?.isDraft !== false) {
    next();
    return;
  }
  requireAdminPermission("notifications", "send")(req, res, next);
};

const requireNotificationUpdatePermission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [existing] = Number.isFinite(id)
      ? await db.select({ isDraft: notificationsTable.isDraft }).from(notificationsTable).where(eq(notificationsTable.id, id)).limit(1)
      : [];
    const action = existing?.isDraft === false || req.body?.isDraft === false ? "send" : "create";
    requireAdminPermission("notifications", action)(req, res, next);
  } catch (error) {
    next(error);
  }
};

router.get("/notifications", requireAdminAuth, requireAdminPermission("notifications", "view"), async (req, res): Promise<void> => {
  const rows = await db
    .select({
      notification: notificationsTable,
      readCount: sql<number>`(
        select count(*)::int
        from ${notificationReadReceiptsTable}
        where ${notificationReadReceiptsTable.notificationId} = ${notificationsTable.id}
      )`,
      pushSentCount: sql<number>`(
        select count(*)::int
        from ${notificationDeliveryLogsTable}
        where ${notificationDeliveryLogsTable.notificationId} = ${notificationsTable.id}
          and ${notificationDeliveryLogsTable.status} = 'sent'
      )`,
      pushFailedCount: sql<number>`(
        select count(*)::int
        from ${notificationDeliveryLogsTable}
        where ${notificationDeliveryLogsTable.notificationId} = ${notificationsTable.id}
          and ${notificationDeliveryLogsTable.status} = 'failed'
      )`,
    })
    .from(notificationsTable)
    .orderBy(desc(notificationsTable.createdAt));
  res.json(rows.map((row) => ({
    ...row.notification,
    readCount: row.readCount,
    pushStatus: row.pushFailedCount > 0
      ? "failed"
      : row.pushSentCount > 0
        ? "sent"
        : "in_app",
    pushSentCount: row.pushSentCount,
    pushFailedCount: row.pushFailedCount,
  })));
});

router.post("/notifications", blockStudentJwt, requireAdminAuth, requireAdminPermission("notifications", "create"), requireSendWhenPublishing, async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateNotificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(notificationsTable)
    .values({
      ...parsed.data,
      sentAt: parsed.data.isDraft === false ? new Date().toISOString() : null,
    })
    .returning();
  dispatchPushForNotification(row);
  await logActivity(req, {
    action: row.isDraft ? "create" : "send",
    module: "notifications",
    entityType: "notification",
    entityId: row.id,
    entityLabel: row.title,
    after: Object.fromEntries(NOTIFICATION_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: row.isDraft ? `Created notification draft ${row.title}` : `Created and sent notification ${row.title}`,
  });
  res.status(201).json(GetNotificationResponse.parse(row));
});

router.get(
  "/notifications/push/status",
  requireAdminAuth,
  requireAdminPermission("notifications", "view"),
  async (_req, res): Promise<void> => {
    res.json(getPushStatus());
  },
);

router.post(
  "/notifications/automation/run",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "send"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = AutomationRunBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { mode, type, force } = parsed.data;
    // Phase 6: manual admin runs respect category settings by default. A
    // force run — bypassing settings entirely — requires Super Admin, not
    // just the base "notifications:send" permission this route is already
    // gated on.
    if (force && !req.adminUser?.isSuperAdmin) {
      res.status(403).json({ error: "Forcing reminder automation past disabled settings requires Super Admin." });
      return;
    }

    if (mode === "enqueue") {
      const jobTypes: NotificationAutomationJob["type"][] = type === "all"
        ? ["class_reminders", "post_class_reminders", "package_reminders"]
        : [type];
      const jobs = [];
      for (const jobType of jobTypes) {
        const job = await enqueueJob<NotificationAutomationJob>(
          QUEUE_NAMES.notificationAutomation,
          jobType,
          { type: jobType, triggeredBy: "admin", force },
          { jobId: `notification-automation:${jobType}:${new Date().toISOString().slice(0, 13)}` },
        );
        if (!job) {
          res.status(503).json({ error: "Notification automation queue is unavailable. Configure REDIS_URL to enqueue jobs." });
          return;
        }
        jobs.push({ id: job.id, name: job.name, type: jobType });
      }
      await logActivity(req, {
        action: "enqueue",
        module: "notifications",
        entityType: "notification_automation",
        entityLabel: type,
        after: { automationType: type, queuedJobs: jobs.length, force },
        summary: `Enqueued notification automation ${type}`,
      });
      res.status(202).json({ mode, type, queued: jobs });
      return;
    }

    const result = await runAutomationByType(type, { force });
    await logActivity(req, {
      action: "send",
      module: "notifications",
      entityType: "notification_automation",
      entityLabel: type,
      after: { ...automationAuditSummary(type, result), force },
      summary: `Ran notification automation ${type}`,
    });
    res.json({ mode, type, result });
  },
);

const ClassRemindersRunBody = z.object({ force: z.boolean().default(false) });

router.post(
  "/notifications/automation/class-reminders/run",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "send"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = ClassRemindersRunBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.force && !req.adminUser?.isSuperAdmin) {
      res.status(403).json({ error: "Forcing reminder automation past disabled settings requires Super Admin." });
      return;
    }
    const result = await runClassReminder24h({ force: parsed.data.force });
    await logActivity(req, {
      action: "send",
      module: "notifications",
      entityType: "notification_automation",
      entityLabel: "24h class reminders",
      after: { ...automationAuditSummary("class_reminders", result), force: parsed.data.force },
      summary: "Ran 24h class reminder automation",
    });
    res.json(result);
  },
);

// ─── GET /notifications/my ────────────────────────────────────────────────────
// Student-scoped: returns broadcast notifications (target="all") plus any
// per-student notifications (target="student:{studentId}") for the caller.
// Requires student JWT. Must be declared before /:id to avoid routing conflict.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/notifications/my", requireStudentAuth, requireVerifiedStudent, async (req: any, res): Promise<void> => {
  const studentId: number = req.studentId;
  const query = MyNotificationsQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { limit, offset } = query.data;
  const visibility = or(
    eq(notificationsTable.target, "all"),
    eq(notificationsTable.target, `student:${studentId}`),
  );

  const rows = await db
    .select({
      notification: notificationsTable,
      readAt: notificationReadReceiptsTable.readAt,
    })
    .from(notificationsTable)
    .leftJoin(
      notificationReadReceiptsTable,
      and(
        eq(notificationReadReceiptsTable.notificationId, notificationsTable.id),
        eq(notificationReadReceiptsTable.studentId, studentId),
      ),
    )
    .where(and(visibility, eq(notificationsTable.isDraft, false)))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(notificationsTable)
    .where(and(visibility, eq(notificationsTable.isDraft, false)));

  const hasMore = rows.length > limit;
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Has-More", hasMore ? "true" : "false");

  res.json(rows.slice(0, limit).map((row) => ({
    ...row.notification,
    isRead: Boolean(row.readAt),
    readAt: row.readAt ?? null,
  })));
});

router.post("/notifications/:id/read", requireStudentAuth, requireVerifiedStudent, async (req: any, res): Promise<void> => {
  const params = GetNotificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const studentId: number = req.studentId;
  const [notification] = await db
    .select({ id: notificationsTable.id, target: notificationsTable.target, isDraft: notificationsTable.isDraft })
    .from(notificationsTable)
    .where(eq(notificationsTable.id, params.data.id))
    .limit(1);

  if (!notification || !isNotificationVisibleToStudent(notification, studentId)) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const now = new Date().toISOString();
  const [receipt] = await db
    .insert(notificationReadReceiptsTable)
    .values({ notificationId: params.data.id, studentId, readAt: now })
    .onConflictDoUpdate({
      target: [notificationReadReceiptsTable.notificationId, notificationReadReceiptsTable.studentId],
      set: { readAt: sql`${notificationReadReceiptsTable.readAt}` },
    })
    .returning();

  res.json({ id: params.data.id, isRead: true, readAt: receipt.readAt });
});

router.post("/notifications/read-all", requireStudentAuth, requireVerifiedStudent, async (req: any, res): Promise<void> => {
  const studentId: number = req.studentId;
  const now = new Date().toISOString();
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      or(
        eq(notificationsTable.target, "all"),
        eq(notificationsTable.target, `student:${studentId}`),
      ),
      eq(notificationsTable.isDraft, false),
    ));

  if (rows.length === 0) {
    res.json({ marked: 0 });
    return;
  }

  const receipts = rows.map((row) => ({ notificationId: row.id, studentId, readAt: now }));
  await db
    .insert(notificationReadReceiptsTable)
    .values(receipts)
    .onConflictDoNothing({
      target: [notificationReadReceiptsTable.notificationId, notificationReadReceiptsTable.studentId],
    });

  res.json({ marked: rows.length });
});

router.post("/notifications/devices/register", requireStudentAuth, requireVerifiedStudent, async (req: any, res): Promise<void> => {
  logger.info({
    studentId: req.studentId ?? null,
    platform: typeof req.body?.platform === "string" ? req.body.platform : null,
    provider: typeof req.body?.provider === "string" ? req.body.provider : null,
    tokenPrefix: typeof req.body?.pushToken === "string" ? tokenPrefix(req.body.pushToken) : null,
  }, "[PUSH_DIAG] notification device register endpoint reached");

  const parsed = DeviceRegisterBody.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({
      studentId: req.studentId ?? null,
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    }, "[PUSH_DIAG] notification device register rejected");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const studentId: number = req.studentId;
  const now = new Date().toISOString();
  const [existingDevice] = await db
    .select({ id: notificationDevicesTable.id })
    .from(notificationDevicesTable)
    .where(eq(notificationDevicesTable.pushToken, parsed.data.pushToken))
    .limit(1);
  logger.info({
    studentId,
    platform: parsed.data.platform,
    provider: parsed.data.provider,
    tokenPrefix: tokenPrefix(parsed.data.pushToken),
    action: existingDevice ? "update" : "create",
  }, "[PUSH_DIAG] notification device db write start");
  const [device] = await db
    .insert(notificationDevicesTable)
    .values({
      studentId,
      pushToken: parsed.data.pushToken,
      provider: parsed.data.provider,
      platform: parsed.data.platform,
      deviceId: parsed.data.deviceId ?? null,
      isActive: true,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationDevicesTable.pushToken,
      set: {
        studentId,
        provider: parsed.data.provider,
        platform: parsed.data.platform,
        deviceId: parsed.data.deviceId ?? null,
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning();

  logger.info({
    studentId,
    platform: parsed.data.platform,
    provider: parsed.data.provider,
    tokenPrefix: tokenPrefix(parsed.data.pushToken),
    action: existingDevice ? "updated" : "created",
    isActive: device.isActive,
    deviceId: device.id,
  }, "[PUSH_DIAG] notification device registered");

  res.json({ ok: true, id: device.id, isActive: device.isActive, lastSeenAt: device.lastSeenAt });
});

router.post("/notifications/devices/unregister", requireStudentAuth, requireVerifiedStudent, async (req: any, res): Promise<void> => {
  const parsed = DeviceUnregisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const conditions = [eq(notificationDevicesTable.studentId, req.studentId as number)];
  if (parsed.data.pushToken) conditions.push(eq(notificationDevicesTable.pushToken, parsed.data.pushToken));
  if (parsed.data.deviceId) conditions.push(eq(notificationDevicesTable.deviceId, parsed.data.deviceId));

  const rows = await db
    .update(notificationDevicesTable)
    .set({ isActive: false, updatedAt: new Date().toISOString() })
    .where(and(...conditions))
    .returning({ id: notificationDevicesTable.id });

  res.json({ ok: true, updated: rows.length });
});

router.get("/notifications/:id", requireAdminAuth, requireAdminPermission("notifications", "view"), async (req, res): Promise<void> => {
  const params = GetNotificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(GetNotificationResponse.parse(row));
});

router.patch("/notifications/:id", blockStudentJwt, requireAdminAuth, requireNotificationUpdatePermission, async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateNotificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNotificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [before] = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.id, params.data.id))
    .limit(1);
  const [row] = await db
    .update(notificationsTable)
    .set({
      ...parsed.data,
      sentAt: parsed.data.isDraft === false ? parsed.data.sentAt ?? new Date().toISOString() : parsed.data.sentAt,
    })
    .where(eq(notificationsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  if (before?.isDraft && row.isDraft === false) {
    dispatchPushForNotification(row);
  }
  if (before) {
    const { before: beforeDiff, after } = diffFields(
      Object.fromEntries(NOTIFICATION_ACTIVITY_FIELDS.map((key) => [key, before[key]])),
      Object.fromEntries(NOTIFICATION_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
      NOTIFICATION_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = before.isDraft && row.isDraft === false ? "send" : "update";
      await logActivity(req, {
        action,
        module: "notifications",
        entityType: "notification",
        entityId: row.id,
        entityLabel: row.title,
        before: beforeDiff,
        after,
        summary: action === "send"
          ? `Published notification ${row.title}`
          : `Updated notification ${row.title}: ${changedKeys.join(", ")}`,
      });
    }
  }
  res.json(UpdateNotificationResponse.parse(row));
});

router.delete("/notifications/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("notifications", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const params = DeleteNotificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(notificationsTable).where(eq(notificationsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  await logActivity(req, {
    action: "delete",
    module: "notifications",
    entityType: "notification",
    entityId: row.id,
    entityLabel: row.title,
    before: Object.fromEntries(NOTIFICATION_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Deleted notification ${row.title}`,
  });
  res.sendStatus(204);
});

export default router;
