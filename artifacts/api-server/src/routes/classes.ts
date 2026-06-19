import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, bookingsTable, classesTable } from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
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

async function notifyClassBookings(
  client: typeof db,
  classId: number,
  classTitle: string,
) {
  const rows = await client
    .select({
      bookingId: bookingsTable.id,
      studentEmail: bookingsTable.studentEmail,
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
      body: `${classTitle} was cancelled. Booking #${booking.bookingId}.`,
    });
  }
}

router.get("/classes", async (req, res): Promise<void> => {
  const rows = await db.select().from(classesTable).orderBy(classesTable.createdAt);
  res.json(ListClassesResponse.parse(rows));
});

router.post("/classes", async (req, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(classesTable).values(parsed.data).returning();
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

router.patch("/classes/:id", async (req, res): Promise<void> => {
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
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(classesTable).where(eq(classesTable.id, params.data.id));
    if (!existing) return null;

    const [updated] = await tx.update(classesTable).set(parsed.data).where(eq(classesTable.id, params.data.id)).returning();
    if (existing.isActive && updated.isActive === false) {
      await notifyClassBookings(tx, updated.id, updated.title);
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  res.json(UpdateClassResponse.parse(row));
});

router.delete("/classes/:id", async (req, res): Promise<void> => {
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
  res.sendStatus(204);
});

export default router;
