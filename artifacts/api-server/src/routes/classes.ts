import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, bookingsTable, classesTable, schedulesTable } from "@workspace/db";
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
const CLASS_ACTIVITY_FIELDS = ["title", "description", "instructorId", "category", "danceTypeId", "level", "ageGroup", "durationMins", "capacity", "photoUrl", "classVideoUrl", "isActive", "pricingCategory"] as const;

const requireClassMediaPermission = (req: Request, res: Response, next: NextFunction): void => {
  const mediaFields = ["photoUrl", "classVideoUrl"];
  if (!mediaFields.some((field) => Object.prototype.hasOwnProperty.call(req.body ?? {}, field))) {
    next();
    return;
  }
  requireAdminPermission("classes", "mediaManage")(req, res, next);
};

import { DbClient } from "../lib/dbTypes";
import { currentOccurrenceDate } from "../lib/occurrence";
import { getCairoBusinessDate } from "../lib/eligibility/dateOnly";
import { validateAgeRange } from "../lib/eligibility/ageRange";
import {
  ageRangeMetadata,
  evaluateClassCatalogueEligibility,
  studentCatalogueVisible,
} from "../lib/eligibility/catalogueEligibility";
import { resolveCatalogueViewer, setCatalogueCacheHeaders } from "../lib/catalogueViewer";

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

function validateClassAgeRange(input: {
  allowAllAges?: boolean | null;
  minAge?: number | null;
  maxAge?: number | null;
}): string | null {
  if (input.allowAllAges == null && input.minAge == null && input.maxAge == null) return null;
  if (input.allowAllAges == null) return "allowAllAges is required when configuring an age range.";
  const result = validateAgeRange({
    allowAllAges: input.allowAllAges,
    minAge: input.minAge ?? null,
    maxAge: input.maxAge ?? null,
  });
  return result.eligible ? null : result.reasons[0]?.message ?? "Invalid age range.";
}

function presentClassForAdmin(row: typeof classesTable.$inferSelect) {
  const range = { allowAllAges: row.allowAllAges, minAge: row.minAge, maxAge: row.maxAge };
  return {
    ...row,
    ...ageRangeMetadata(range),
    catalogueEligibility: {
      evaluated: false as const,
      eligible: null,
      evaluatedOn: null,
      reasons: [],
    },
  };
}

router.get("/classes", async (req, res): Promise<void> => {
  const viewer = await resolveCatalogueViewer(req, res);
  if (!viewer) return;
  setCatalogueCacheHeaders(res, viewer);

  const allRows = await db.select().from(classesTable).orderBy(classesTable.createdAt);
  const rows = viewer.kind === "admin" ? allRows : allRows.filter((row) => row.isActive);
  const classIds = rows.map((row) => row.id);
  const scheduleRows = classIds.length
    ? await db.select().from(schedulesTable).where(and(
        inArray(schedulesTable.classId, classIds),
        eq(schedulesTable.status, "active"),
      ))
    : [];
  const evaluationByClass = new Map<number, string>();
  for (const schedule of scheduleRows) {
    const occurrence = currentOccurrenceDate(schedule);
    if (!occurrence) continue;
    const current = evaluationByClass.get(schedule.classId);
    if (!current || occurrence < current) evaluationByClass.set(schedule.classId, occurrence);
  }

  const enriched = rows.map((row) => {
    const range = {
      allowAllAges: row.allowAllAges,
      minAge: row.minAge,
      maxAge: row.maxAge,
    };
    const evaluationDate = (evaluationByClass.get(row.id) ?? getCairoBusinessDate()) as ReturnType<typeof getCairoBusinessDate>;
    return {
      ...row,
      ...ageRangeMetadata(range),
      catalogueEligibility: evaluateClassCatalogueEligibility(viewer, range, evaluationDate),
    };
  });
  const visible = viewer.kind === "student"
    ? enriched.filter((row) => studentCatalogueVisible(row.catalogueEligibility))
    : enriched;
  res.json(ListClassesResponse.parse(visible));
});

router.post("/classes", blockStudentJwt, requireAdminAuth, requireAdminPermission("classes", "create"), requireClassMediaPermission, async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ageError = validateClassAgeRange(parsed.data);
  if (ageError) {
    res.status(400).json({ error: ageError, code: "AGE_RANGE_INVALID" });
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
  res.status(201).json(GetClassResponse.parse(presentClassForAdmin(row)));
});

router.get("/classes/:id", async (req, res): Promise<void> => {
  const viewer = await resolveCatalogueViewer(req, res);
  if (!viewer) return;
  setCatalogueCacheHeaders(res, viewer);
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
  const schedules = await db
    .select()
    .from(schedulesTable)
    .where(and(eq(schedulesTable.classId, row.id), eq(schedulesTable.status, "active")));
  const nextOccurrence = schedules
    .map((schedule) => currentOccurrenceDate(schedule))
    .filter((date): date is string => date != null)
    .sort()[0] ?? getCairoBusinessDate();
  const range = { allowAllAges: row.allowAllAges, minAge: row.minAge, maxAge: row.maxAge };
  res.json(GetClassResponse.parse({
    ...row,
    ...ageRangeMetadata(range),
    catalogueEligibility: evaluateClassCatalogueEligibility(
      viewer,
      range,
      nextOccurrence as ReturnType<typeof getCairoBusinessDate>,
    ),
  }));
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

    const candidateRange = {
      allowAllAges: parsed.data.allowAllAges === undefined ? existing.allowAllAges : parsed.data.allowAllAges,
      minAge: parsed.data.minAge === undefined ? existing.minAge : parsed.data.minAge,
      maxAge: parsed.data.maxAge === undefined ? existing.maxAge : parsed.data.maxAge,
    };
    const ageError = validateClassAgeRange(candidateRange);
    if (ageError) return { ageError } as const;

    const [updated] = await tx.update(classesTable).set(parsed.data).where(eq(classesTable.id, params.data.id)).returning();
    if (!updated) throw new Error(`Class ${params.data.id} disappeared during update`);
    if (existing.isActive && updated.isActive === false) {
      await notifyClassBookings(tx, updated.id, updated.title);
    }
    return { beforeClass: existing, row: updated, ageError: null };
  });
  if (!result) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  if ("ageError" in result && result.ageError) {
    res.status(400).json({ error: result.ageError, code: "AGE_RANGE_INVALID" });
    return;
  }
  if (!("row" in result) || !result.row || !result.beforeClass) {
    throw new Error(`Class ${params.data.id} update returned no row`);
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
  res.json(UpdateClassResponse.parse(presentClassForAdmin(row)));
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

    const [linkedSchedule] = await tx.select({ id: schedulesTable.id }).from(schedulesTable).where(eq(schedulesTable.classId, existing.id)).limit(1);

    if (linkedSchedule || existing.isActive) {
      const [archived] = await tx.update(classesTable).set({ isActive: false }).where(eq(classesTable.id, params.data.id)).returning();
      return archived ?? null;
    }

    await notifyClassBookings(tx, existing.id, existing.title);
    const [deleted] = await tx.delete(classesTable).where(eq(classesTable.id, params.data.id)).returning();
    return deleted ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  await logActivity(req, {
    action: "deactivate",
    module: "classes",
    entityType: "class",
    entityId: row.id,
    entityLabel: row.title,
    before: Object.fromEntries(CLASS_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Archived class ${row.title}`,
  });
  res.sendStatus(204);
});

export default router;
