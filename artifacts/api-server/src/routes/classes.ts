import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, bookingsTable, classesTable } from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  CreateClassBody,
  GetClassParams,
  GetClassResponse,
  UpdateClassParams,
  UpdateClassBody,
  UpdateClassResponse,
  DeleteClassParams,
  ListClassesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const CLASS_ACTIVITY_FIELDS = ["title", "description", "instructorId", "category", "danceTypeId", "level", "ageGroup", "durationMins", "capacity", "photoUrl", "classVideoUrl", "isActive"] as const;

const requireClassMediaPermission = (req: Request, res: Response, next: NextFunction): void => {
  const mediaFields = ["photoUrl", "classVideoUrl"];
  if (!mediaFields.some((field) => Object.prototype.hasOwnProperty.call(req.body ?? {}, field))) {
    next();
    return;
  }
  requireAdminPermission("classes", "mediaManage")(req, res, next);
};

import { DbClient } from "../lib/dbTypes";

async function notifyClassBookings(
  client: DbClient,
  classId: number,
  classTitle: string,
) {
  const rows = await client
    .select({
      bookingId: bookingsTable.id,
      studentEmail: bookingsTable.studentEmail,
      participantName: bookingsTable.studentName,
      participantChildId: bookingsTable.participantChildId,
      bookingScope: bookingsTable.bookingScope,
    })
    .from(bookingsTable)
    .where(and(
      eq(bookingsTable.classId, classId),
      inArray(bookingsTable.bookingStatus, ["pending", "confirmed"]),
    ));

  for (const booking of rows) {
    await createStudentNotification(client, {
      studentEmail: booking.studentEmail,
      title: "Class cancelled",
      body: `${classTitle} was cancelled.`,
      type: "schedule_cancelled",
      relatedEntityType: "booking",
      relatedEntityId: booking.bookingId,
      metadata: {
        bookingId: booking.bookingId,
        className: classTitle,
        participantName: booking.participantName,
        participantChildId: booking.participantChildId,
        bookingScope: booking.bookingScope ?? (booking.participantChildId != null ? "child" : "self"),
      },
    });
  }
}

router.get("/classes", async (req, res): Promise<void> => {
  const rows = await db.select().from(classesTable).orderBy(classesTable.createdAt);
  res.json(ListClassesResponse.parse(rows));
});

router.post("/classes", blockStudentJwt, requireAdminAuth, requireAdminPermission("classes", "create"), requireClassMediaPermission, async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(classesTable).values(parsed.data).returning();
  await logActivity(req, {
    action: "create",
    module: "classes",
    entityType: "class",
    entityId: row.id,
    entityLabel: row.title,
    after: Object.fromEntries(CLASS_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Created class ${row.title}`,
  });
  res.status(201).json(GetClassResponse.parse(row));
});

router.get("/classes/:id", async (req, res): Promise<void> => {
  const params = GetClassParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(classesTable).where(eq(classesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  res.json(GetClassResponse.parse(row));
});

router.patch("/classes/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("classes", "edit"), requireClassMediaPermission, async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateClassParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(classesTable).where(eq(classesTable.id, params.data.id));
    if (!existing) return null;

    const [updated] = await tx.update(classesTable).set(parsed.data).where(eq(classesTable.id, params.data.id)).returning();
    if (existing.isActive && updated.isActive === false) {
      await notifyClassBookings(tx, updated.id, updated.title);
    }
    return { beforeClass: existing, row: updated };
  });
  if (!result) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  const { beforeClass, row } = result;
  {
    const { before, after } = diffFields(
      Object.fromEntries(CLASS_ACTIVITY_FIELDS.map((key) => [key, beforeClass[key]])),
      Object.fromEntries(CLASS_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
      CLASS_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = beforeClass.isActive !== row.isActive
        ? row.isActive ? "activate" : "deactivate"
        : "update";
      await logActivity(req, {
        action,
        module: "classes",
        entityType: "class",
        entityId: row.id,
        entityLabel: row.title,
        before,
        after,
        summary: action === "activate"
          ? `Activated class ${row.title}`
          : action === "deactivate"
            ? `Deactivated class ${row.title}`
            : `Updated class ${row.title}: ${changedKeys.join(", ")}`,
      });
    }
  }
  res.json(UpdateClassResponse.parse(row));
});

router.delete("/classes/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("classes", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const params = DeleteClassParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(classesTable).where(eq(classesTable.id, params.data.id));
    if (!existing) return null;

    await notifyClassBookings(tx, existing.id, existing.title);
    const [deleted] = await tx.delete(classesTable).where(eq(classesTable.id, params.data.id)).returning();
    return deleted ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  await logActivity(req, {
    action: "delete",
    module: "classes",
    entityType: "class",
    entityId: row.id,
    entityLabel: row.title,
    before: Object.fromEntries(CLASS_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Deleted class ${row.title}`,
  });
  res.sendStatus(204);
});

export default router;
