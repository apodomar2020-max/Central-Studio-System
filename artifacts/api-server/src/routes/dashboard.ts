import { Router, type IRouter } from "express";
import { count, eq, sql } from "drizzle-orm";
import {
  db,
  studentsTable,
  bookingsTable,
  classesTable,
  instructorsTable,
  packageOrdersTable,
  schedulesTable,
  attendanceTable,
  balletEnrollmentCancellationRequestsTable,
  balletLevelAssignmentsTable,
  balletRefundsTable,
} from "@workspace/db";
import { GetDashboardResponse } from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

type ScheduleRow = Pick<
  typeof schedulesTable.$inferSelect,
  "type" | "date" | "dayOfWeek" | "effectiveFrom" | "effectiveUntil"
>;

function cairoDayInfo(date: Date): { key: string; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    key: `${get("year")}-${get("month")}-${get("day")}`,
    dayOfWeek: dayMap[get("weekday")] ?? 0,
  };
}

function occursOn(schedule: ScheduleRow, day: { key: string; dayOfWeek: number }): boolean {
  if (schedule.type === "one_time") return schedule.date === day.key;
  if (schedule.dayOfWeek !== day.dayOfWeek) return false;
  if (schedule.effectiveFrom && schedule.effectiveFrom > day.key) return false;
  if (schedule.effectiveUntil && schedule.effectiveUntil < day.key) return false;
  return true;
}

// Admin-only: aggregates user counts and operational stats. The
// shared API key is an app identifier, not authentication — it must never be
// enough to read financial data (Security Assessment H-01).
router.get("/dashboard", requireAdminAuth, requireAdminPermission("dashboard", "view"), async (req: AdminRequest, res): Promise<void> => {
  const [
    [userStats],
    [bookingStats],
    [classStats],
    [instructorStats],
    [attendanceStats],
    [packageStats],
    [balletCancellationStats],
    [balletEnrollmentStats],
    [balletRefundStats],
    scheduleRows,
  ] = await Promise.all([
    db.select({
      totalUsers: count(),
      students: sql<number>`count(*) filter (where ${studentsTable.accountType} is null or ${studentsTable.accountType} = 'student')`,
      parents: sql<number>`count(*) filter (where ${studentsTable.accountType} = 'parent')`,
    }).from(studentsTable),
    db.select({
      totalBookings: count(),
      todayBookings: sql<number>`count(*) filter (where (${bookingsTable.bookedAt} at time zone 'Africa/Cairo')::date = (current_timestamp at time zone 'Africa/Cairo')::date)`,
      confirmedBookings: sql<number>`count(*) filter (where ${bookingsTable.bookingStatus} = 'confirmed')`,
      pendingBookings: sql<number>`count(*) filter (where ${bookingsTable.bookingStatus} = 'pending')`,
      cancelledBookings: sql<number>`count(*) filter (where ${bookingsTable.bookingStatus} = 'cancelled')`,
      completedBookings: sql<number>`count(*) filter (where ${bookingsTable.bookingStatus} in ('attended', 'completed'))`,
      pendingPayments: sql<number>`count(*) filter (where ${bookingsTable.paymentStatus} = 'pending_payment')`,
      refundedBookings: sql<number>`count(*) filter (where ${bookingsTable.paymentStatus} = 'refunded')`,
    }).from(bookingsTable),
    db.select({ activeClasses: count() }).from(classesTable).where(eq(classesTable.isActive, true)),
    db.select({ activeInstructors: count() }).from(instructorsTable).where(eq(instructorsTable.isActive, true)),
    db.select({
      totalCheckIns: sql<number>`count(*) filter (where ${attendanceTable.status} in ('checked_in', 'late'))`,
      todayCheckIns: sql<number>`count(*) filter (where ${attendanceTable.status} in ('checked_in', 'late') and (${attendanceTable.checkedInAt} at time zone 'Africa/Cairo')::date = (current_timestamp at time zone 'Africa/Cairo')::date)`,
      missedAttendance: sql<number>`count(*) filter (where ${attendanceTable.status} = 'absent')`,
    }).from(attendanceTable),
    db.select({
      activePackages: sql<number>`count(*) filter (where ${packageOrdersTable.status} = 'active')`,
      pendingPackageOrders: sql<number>`count(*) filter (where ${packageOrdersTable.status} = 'pendingPayment')`,
    }).from(packageOrdersTable),
    db.select({
      pendingCancellationRequests: sql<number>`count(*) filter (where ${balletEnrollmentCancellationRequestsTable.status} = 'pendingReview')`,
    }).from(balletEnrollmentCancellationRequestsTable),
    db.select({
      activeBalletEnrollments: sql<number>`count(*) filter (where ${balletLevelAssignmentsTable.status} = 'active')`,
      withdrawnBalletEnrollments: sql<number>`count(*) filter (where ${balletLevelAssignmentsTable.status} = 'withdrawn')`,
    }).from(balletLevelAssignmentsTable),
	    db.select({
	      refundsUnderReview: sql<number>`count(*) filter (where ${balletRefundsTable.status} = 'underReview')`,
	      completedFullRefunds: sql<number>`
	        (
	          select count(*)::int
	          from (
	            select br.payment_id, sum(br.refunded_amount_egp) as completed_refund_total, max(bp.amount_egp) as original_amount
	            from ballet_refunds br
	            inner join ballet_payments bp on bp.id = br.payment_id
	            where br.status = 'refunded' and br.processed_at is not null and br.refunded_amount_egp > 0
	            group by br.payment_id
	          ) totals
	          where totals.completed_refund_total >= totals.original_amount
	        )
	      `,
	      completedPartialRefunds: sql<number>`
	        (
	          select count(*)::int
	          from (
	            select br.payment_id, sum(br.refunded_amount_egp) as completed_refund_total, max(bp.amount_egp) as original_amount
	            from ballet_refunds br
	            inner join ballet_payments bp on bp.id = br.payment_id
	            where br.status = 'refunded' and br.processed_at is not null and br.refunded_amount_egp > 0
	            group by br.payment_id
	          ) totals
	          where totals.completed_refund_total > 0 and totals.completed_refund_total < totals.original_amount
	        )
	      `,
	    }).from(balletRefundsTable),
    db.select({
      type: schedulesTable.type,
      date: schedulesTable.date,
      dayOfWeek: schedulesTable.dayOfWeek,
      effectiveFrom: schedulesTable.effectiveFrom,
      effectiveUntil: schedulesTable.effectiveUntil,
    })
      .from(schedulesTable)
      .innerJoin(classesTable, eq(schedulesTable.classId, classesTable.id))
      .where(eq(classesTable.isActive, true)),
  ]);

  const today = cairoDayInfo(new Date());
  const upcomingDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + index + 1);
    return cairoDayInfo(date);
  });
  const todayClasses = scheduleRows.filter((schedule: ScheduleRow) => occursOn(schedule, today)).length;
  const upcomingClasses = upcomingDays.reduce(
    (total, day) => total + scheduleRows.filter((schedule: ScheduleRow) => occursOn(schedule, day)).length,
    0,
  );

  const response = GetDashboardResponse.parse({
    totalUsers: Number(userStats.totalUsers),
    totalStudents: Number(userStats.students),
    totalParents: Number(userStats.parents),
    totalBookings: Number(bookingStats.totalBookings),
    todayBookings: Number(bookingStats.todayBookings),
    confirmedBookings: Number(bookingStats.confirmedBookings),
    pendingBookings: Number(bookingStats.pendingBookings),
    cancelledBookings: Number(bookingStats.cancelledBookings),
    completedBookings: Number(bookingStats.completedBookings),
    pendingPayments: Number(bookingStats.pendingPayments),
    refundedBookings: Number(bookingStats.refundedBookings),
    activeClasses: Number(classStats.activeClasses),
    activeInstructors: Number(instructorStats.activeInstructors),
    pendingCancellationRequests: Number(balletCancellationStats.pendingCancellationRequests),
    activeBalletEnrollments: Number(balletEnrollmentStats.activeBalletEnrollments),
    withdrawnBalletEnrollments: Number(balletEnrollmentStats.withdrawnBalletEnrollments),
    refundsUnderReview: Number(balletRefundStats.refundsUnderReview),
    completedFullRefunds: Number(balletRefundStats.completedFullRefunds),
    completedPartialRefunds: Number(balletRefundStats.completedPartialRefunds),
    activePackages: Number(packageStats.activePackages),
    pendingPackageOrders: Number(packageStats.pendingPackageOrders),
    totalCheckIns: Number(attendanceStats.totalCheckIns),
    todayCheckIns: Number(attendanceStats.todayCheckIns),
    missedAttendance: Number(attendanceStats.missedAttendance),
    todayClasses,
    upcomingClasses,
  });

  res.json(response);
});

export default router;
