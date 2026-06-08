import { Router, type IRouter } from "express";
import { eq, count, sql } from "drizzle-orm";
import { db, studentsTable, bookingsTable, classesTable, instructorsTable, offersTable } from "@workspace/db";
import { GetDashboardResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const [
    [{ totalStudents }],
    [{ totalBookings }],
    [{ activeClasses }],
    [{ activeInstructors }],
    [{ pendingBookings }],
    [{ todayBookings }],
    [{ totalOffers }],
  ] = await Promise.all([
    db.select({ totalStudents: count() }).from(studentsTable),
    db.select({ totalBookings: count() }).from(bookingsTable),
    db.select({ activeClasses: count() }).from(classesTable).where(eq(classesTable.isActive, true)),
    db.select({ activeInstructors: count() }).from(instructorsTable).where(eq(instructorsTable.isActive, true)),
    db.select({ pendingBookings: count() }).from(bookingsTable).where(eq(bookingsTable.status, "pending")),
    db.select({ todayBookings: count() }).from(bookingsTable).where(
      sql`DATE(${bookingsTable.bookedAt}) = CURRENT_DATE`
    ),
    db.select({ totalOffers: count() }).from(offersTable),
  ]);

  res.json(GetDashboardResponse.parse({
    totalStudents,
    totalBookings,
    activeClasses,
    activeInstructors,
    pendingBookings,
    todayBookings,
    totalOffers,
    totalRevenue: 0,
  }));
});

export default router;
