/**
 * lib/balletAttendance.ts — Ballet monthly attendance-hours calculation (C4)
 *
 * The Ballet subscription is a strict per-calendar-month entitlement, NOT a
 * reusable session-credit balance. For a given level assignment and billing
 * month M ("YYYY-MM") this computes, from attendance rows' OWN STORED
 * duration_minutes snapshot (D2 correction — previously this joined live to
 * ballet_schedules.duration_mins; that meant editing a schedule's duration
 * later would retroactively change every past month's totals for every child
 * who ever attended that slot. Each attendance row now snapshots the
 * duration at the moment it was recorded — see attendance.durationMinutes in
 * schema/attendance.ts and the POST/PATCH handlers in routes/adminBallet.ts —
 * so history is immutable going forward regardless of later schedule edits):
 *
 *   attendedHours  = Σ duration where status IN (checked_in, late)
 *   absentHours    = Σ duration where status = absent
 *   consumedHours  = attendedHours + absentHours  (cancelled rows consume nothing)
 *   monthlyHours   = ballet_packages.monthlyHours of the package linked to the
 *                    ballet_payments row where status='paid' AND billingMonth=M
 *   remainingHours = max(monthlyHours - consumedHours, 0)   (only when subscribed)
 *
 * An absence stays visible as its own reported field (absentHours) and its
 * duration is still counted in consumedHours — never added back as a makeup
 * credit in any other month or field.
 *
 * If there is no paid, package-linked payment for month M, the result is the
 * distinct "no active monthly subscription" case: hasActiveSubscription=false
 * with monthlyHours/remainingHours null. We never default monthlyHours to 0 and
 * never fall back to another month's package.
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  attendanceTable,
  balletPackagesTable,
} from "@workspace/db";
import { findPaidCycleActiveOn, todayDateOnly } from "./balletRefundEligibilityMath";
import { getCurrentSubscriptionForApplication, getPaymentCyclesForApplication } from "./balletSubscriptions";

export interface BalletMonthlyAttendanceSummary {
  billingMonth: string;
  hasActiveSubscription: boolean;
  attendedHours: number;
  absentHours: number;
  consumedHours: number;
  monthlyHours: number | null;
  remainingHours: number | null;
  subscriptionId: number | null;
  subscriptionStatus: string;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
  daysRemaining: number | null;
}

/** Current calendar month as "YYYY-MM" (UTC, to avoid server-TZ drift). */
export function currentBillingMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** True when `value` is a well-formed "YYYY-MM" calendar month. */
export function isValidBillingMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthRange(month: string): { start: string; end: string } {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function subscriptionOverlapsMonth(startDate: string | null, expiresAt: string | null, month: string): boolean {
  if (!startDate || !expiresAt) return false;
  const range = monthRange(month);
  return startDate <= range.end && expiresAt >= range.start;
}

interface BalletAttendanceHours {
  attendedHours: number;
  absentHours: number;
  consumedHours: number;
}

async function computeBalletAttendanceHoursForRange(
  levelAssignmentId: number,
  startDate: string,
  endDate: string,
): Promise<BalletAttendanceHours> {
  const rows = await db
    .select({
      status: attendanceTable.status,
      durationMinutes: attendanceTable.durationMinutes,
    })
    .from(attendanceTable)
    .where(and(
      eq(attendanceTable.balletLevelAssignmentId, levelAssignmentId),
      gte(attendanceTable.classDate, startDate),
      lte(attendanceTable.classDate, endDate),
    ));

  let attendedMins = 0;
  let absentMins = 0;
  for (const row of rows) {
    const mins = row.durationMinutes ?? 0;
    if (row.status === "checked_in" || row.status === "late") attendedMins += mins;
    else if (row.status === "absent") absentMins += mins;
  }

  const attendedHours = attendedMins / 60;
  const absentHours = absentMins / 60;
  return {
    attendedHours,
    absentHours,
    consumedHours: attendedHours + absentHours,
  };
}

/**
 * Computes the monthly attendance-hours summary for one level assignment in one
 * calendar month. Attendance rows are scoped to that assignment AND to
 * class_date within month M. The paid entitlement is matched on the
 * APPLICATION (not the level-assignment id) because ballet_payments.levelAssignmentId
 * is optional — mirroring the activation gate's application-scoped payment match.
 */
export async function computeBalletMonthlyAttendanceSummary(
  levelAssignmentId: number,
  applicationId: number,
  month: string,
): Promise<BalletMonthlyAttendanceSummary> {
  // ── Consumed/attended/absent hours from this month's attendance rows ──────
  // Reads each row's own stored durationMinutes snapshot — NOT a live join to
  // ballet_schedules — so later schedule-duration edits never change history.
  const rows = await db
    .select({
      status:          attendanceTable.status,
      durationMinutes: attendanceTable.durationMinutes,
    })
    .from(attendanceTable)
    .where(and(
      eq(attendanceTable.balletLevelAssignmentId, levelAssignmentId),
      sql`to_char(${attendanceTable.classDate}, 'YYYY-MM') = ${month}`,
    ));

  let attendedMins = 0;
  let absentMins = 0;
  for (const row of rows) {
    const mins = row.durationMinutes ?? 0; // a row with no snapshotted duration contributes 0
    if (row.status === "checked_in" || row.status === "late") attendedMins += mins;
    else if (row.status === "absent") absentMins += mins;
    // "cancelled" is excluded from every total — it consumes nothing.
  }

  const attendedHours = attendedMins / 60;
  const absentHours = absentMins / 60;
  const consumedHours = attendedHours + absentHours;

  // ── Monthly entitlement: the current valid subscription cycle ─────────────
  // The legacy billingMonth is still returned for reporting, but access is now
  // derived from the paid payment cycle's date-only start/expires fields. A
  // renewal starts a fresh entitlement; unused hours never roll forward.
  const paid = await getCurrentSubscriptionForApplication(applicationId);

  const subscriptionCoversMonth = paid?.status === "paid"
    && subscriptionOverlapsMonth(paid.subscriptionStartDate, paid.subscriptionExpiresAt, month);

  if (!paid || !subscriptionCoversMonth || paid.packageId == null || paid.packageName == null) {
    // Distinct "no active monthly subscription for this month" result.
    return {
      billingMonth: month,
      hasActiveSubscription: false,
      attendedHours,
      absentHours,
      consumedHours,
      monthlyHours: null,
      remainingHours: null,
      subscriptionId: paid?.id ?? null,
      subscriptionStatus: paid?.subscriptionStatus ?? "pending",
      subscriptionStartDate: paid?.subscriptionStartDate ?? null,
      subscriptionExpiresAt: paid?.subscriptionExpiresAt ?? null,
      daysRemaining: paid?.daysRemaining ?? null,
    };
  }

  const [packageRow] = await db
    .select({ monthlyHours: balletPackagesTable.monthlyHours })
    .from(balletPackagesTable)
    .where(eq(balletPackagesTable.id, paid.packageId))
    .limit(1);
  if (!packageRow) {
    return {
      billingMonth: month,
      hasActiveSubscription: false,
      attendedHours,
      absentHours,
      consumedHours,
      monthlyHours: null,
      remainingHours: null,
      subscriptionId: paid.id,
      subscriptionStatus: paid.subscriptionStatus,
      subscriptionStartDate: paid.subscriptionStartDate,
      subscriptionExpiresAt: paid.subscriptionExpiresAt,
      daysRemaining: paid.daysRemaining,
    };
  }

  const monthlyHours = packageRow.monthlyHours;
  return {
    billingMonth: month,
    hasActiveSubscription: true,
    attendedHours,
    absentHours,
    consumedHours,
    monthlyHours,
    remainingHours: Math.max(monthlyHours - consumedHours, 0),
    subscriptionId: paid.id,
    subscriptionStatus: paid.subscriptionStatus,
    subscriptionStartDate: paid.subscriptionStartDate,
    subscriptionExpiresAt: paid.subscriptionExpiresAt,
    daysRemaining: paid.daysRemaining,
  };
}

/**
 * Parent-facing summary for the latest paid Ballet plan. Unlike the admin's
 * historical calendar-month report above, this resets usage at the plan's
 * subscriptionStartDate and includes attendance only through its
 * subscriptionExpiresAt. A paid renewal therefore starts with the renewed
 * package's hours and cannot inherit attendance from the expired plan.
 */
export async function computeBalletCurrentSubscriptionAttendanceSummary(
  levelAssignmentId: number,
  applicationId: number,
): Promise<BalletMonthlyAttendanceSummary> {
  const paid = findPaidCycleActiveOn(
    await getPaymentCyclesForApplication(applicationId),
    todayDateOnly(),
  );
  const reportingMonth = paid?.subscriptionExpiresAt?.slice(0, 7) ?? currentBillingMonth();

  if (
    !paid
    || !paid.subscriptionStartDate
    || !paid.subscriptionExpiresAt
    || paid.packageId == null
  ) {
    return {
      billingMonth: reportingMonth,
      hasActiveSubscription: false,
      attendedHours: 0,
      absentHours: 0,
      consumedHours: 0,
      monthlyHours: null,
      remainingHours: null,
      subscriptionId: paid?.id ?? null,
      subscriptionStatus: paid?.subscriptionStatus ?? "pending",
      subscriptionStartDate: paid?.subscriptionStartDate ?? null,
      subscriptionExpiresAt: paid?.subscriptionExpiresAt ?? null,
      daysRemaining: paid?.daysRemaining ?? null,
    };
  }

  const [hours, packageRow] = await Promise.all([
    computeBalletAttendanceHoursForRange(
      levelAssignmentId,
      paid.subscriptionStartDate,
      paid.subscriptionExpiresAt,
    ),
    db
      .select({ monthlyHours: balletPackagesTable.monthlyHours })
      .from(balletPackagesTable)
      .where(eq(balletPackagesTable.id, paid.packageId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!packageRow) {
    return {
      billingMonth: reportingMonth,
      hasActiveSubscription: false,
      ...hours,
      monthlyHours: null,
      remainingHours: null,
      subscriptionId: paid.id,
      subscriptionStatus: paid.subscriptionStatus,
      subscriptionStartDate: paid.subscriptionStartDate,
      subscriptionExpiresAt: paid.subscriptionExpiresAt,
      daysRemaining: paid.daysRemaining,
    };
  }

  return {
    billingMonth: reportingMonth,
    hasActiveSubscription: true,
    ...hours,
    monthlyHours: packageRow.monthlyHours,
    remainingHours: Math.max(packageRow.monthlyHours - hours.consumedHours, 0),
    subscriptionId: paid.id,
    subscriptionStatus: paid.subscriptionStatus,
    subscriptionStartDate: paid.subscriptionStartDate,
    subscriptionExpiresAt: paid.subscriptionExpiresAt,
    daysRemaining: paid.daysRemaining,
  };
}
