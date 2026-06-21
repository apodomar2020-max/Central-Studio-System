import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { desc, eq, or } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import {
  CreateNotificationBody,
  GetNotificationParams,
  GetNotificationResponse,
  UpdateNotificationParams,
  UpdateNotificationBody,
  UpdateNotificationResponse,
  DeleteNotificationParams,
  ListNotificationsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

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
  const rows = await db.select().from(notificationsTable).orderBy(notificationsTable.createdAt);
  res.json(ListNotificationsResponse.parse(rows));
});

router.post("/notifications", requireAdminAuth, requireAdminPermission("notifications", "create"), requireSendWhenPublishing, async (req, res): Promise<void> => {
  const parsed = CreateNotificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(notificationsTable).values(parsed.data).returning();
  res.status(201).json(GetNotificationResponse.parse(row));
});

// ─── GET /notifications/my ────────────────────────────────────────────────────
// Student-scoped: returns broadcast notifications (target="all") plus any
// per-student notifications (target="student:{studentId}") for the caller.
// Requires student JWT. Must be declared before /:id to avoid routing conflict.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/notifications/my", requireStudentAuth, requireVerifiedStudent, async (req: any, res): Promise<void> => {
  const studentId: number = req.studentId;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(
      or(
        eq(notificationsTable.target, "all"),
        eq(notificationsTable.target, `student:${studentId}`),
      ),
    )
    .orderBy(desc(notificationsTable.createdAt));

  res.json(ListNotificationsResponse.parse(rows.filter((n) => !n.isDraft)));
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

router.patch("/notifications/:id", requireAdminAuth, requireNotificationUpdatePermission, async (req, res): Promise<void> => {
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
  const [row] = await db.update(notificationsTable).set(parsed.data).where(eq(notificationsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(UpdateNotificationResponse.parse(row));
});

router.delete("/notifications/:id", requireAdminAuth, requireAdminPermission("notifications", "delete"), async (req, res): Promise<void> => {
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
