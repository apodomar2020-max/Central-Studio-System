import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, attendanceTable, packageOrdersTable } from "@workspace/db";
import {
  ListAttendanceQueryParams,
  ListAttendanceResponse,
  CheckInBody,
  GetAttendanceStatsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/attendance", async (req, res): Promise<void> => {
  const query = ListAttendanceQueryParams.safeParse(req.query);
  let rows = await db.select().from(attendanceTable).orderBy(desc(attendanceTable.checkedInAt));
  if (query.success && query.data.studentEmail) {
    rows = rows.filter((r) => r.studentEmail === query.data.studentEmail);
  }
  res.json(ListAttendanceResponse.parse(rows));
});

router.post("/attendance", async (req, res): Promise<void> => {
  const parsed = CheckInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { packageOrderId, creditDeducted } = parsed.data;

  if (creditDeducted && packageOrderId) {
    const [order] = await db.select().from(packageOrdersTable).where(eq(packageOrdersTable.id, packageOrderId));
    if (order && order.remainingCredits > 0) {
      const newRemaining = order.remainingCredits - 1;
      await db.update(packageOrdersTable)
        .set({
          remainingCredits: newRemaining,
          status: newRemaining <= 0 ? "fullyUsed" : order.status,
        })
        .where(eq(packageOrdersTable.id, packageOrderId));
    }
  }

  const [row] = await db.insert(attendanceTable).values({
    studentName: parsed.data.studentName,
    studentEmail: parsed.data.studentEmail,
    packageOrderId: parsed.data.packageOrderId ?? null,
    classTitle: parsed.data.classTitle ?? null,
    creditDeducted: parsed.data.creditDeducted ?? false,
    notes: parsed.data.notes ?? null,
    checkedInAt: new Date().toISOString(),
  }).returning();
  res.status(201).json(row);
});

router.get("/attendance/stats", async (req, res): Promise<void> => {
  const query = GetAttendanceStatsQueryParams.safeParse(req.query);
  const period = (query.success && query.data.period) ? query.data.period : "monthly";

  const rows = await db.select().from(attendanceTable).orderBy(desc(attendanceTable.checkedInAt));

  const now = new Date();
  let data: { label: string; count: number }[] = [];

  if (period === "daily") {
    const buckets: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      buckets[label] = 0;
    }
    for (const row of rows) {
      const d = new Date(row.checkedInAt);
      const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      if (label in buckets) buckets[label]++;
    }
    data = Object.entries(buckets).map(([label, count]) => ({ label, count }));
  } else if (period === "monthly") {
    const buckets: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      buckets[label] = 0;
    }
    for (const row of rows) {
      const d = new Date(row.checkedInAt);
      const label = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      if (label in buckets) buckets[label]++;
    }
    data = Object.entries(buckets).map(([label, count]) => ({ label, count }));
  } else {
    const buckets: Record<string, number> = {};
    for (let i = 2; i >= 0; i--) {
      const label = String(now.getFullYear() - i);
      buckets[label] = 0;
    }
    for (const row of rows) {
      const label = String(new Date(row.checkedInAt).getFullYear());
      if (label in buckets) buckets[label]++;
    }
    data = Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);
  res.json({ period, total, data });
});

export default router;
