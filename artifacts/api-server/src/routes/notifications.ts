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
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { getPushStatus, sendBroadcastPushNotification, sendPushNotification } from "../lib/pushNotifications";
import { runClassReminder24h } from "../lib/notificationReminders";
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

router.post("/notifications", blockStudentJwt, requireAdminAuth, requireAdminPermission("notifications", "create"), requireSendWhenPublishing, async (req, res): Promise<void> => {
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
  "/notifications/automation/class-reminders/run",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("notifications", "send"),
  async (_req, res): Promise<void> => {
    const result = await runClassReminder24h();
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
  const parsed = DeviceRegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const studentId: number = req.studentId;
  const now = new Date().toISOString();
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

router.patch("/notifications/:id", blockStudentJwt, requireAdminAuth, requireNotificationUpdatePermission, async (req, res): Promise<void> => {
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
    .select({ isDraft: notificationsTable.isDraft })
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
  res.json(UpdateNotificationResponse.parse(row));
});

router.delete("/notifications/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("notifications", "delete"), async (req, res): Promise<void> => {
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
  res.sendStatus(204);
});

export default router;
