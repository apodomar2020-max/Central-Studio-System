/**
 * Admin Reports API — GET /api/reports/:entity
 *
 * Returns preview-ready report data for the admin Reports → Export Center:
 *   { entity, columns: {key,label}[], rows: Record<string,unknown>[],
 *     summary: Record<string,unknown>, filters }
 *
 * Security: admin-only. Reports concentrate sensitive customer/business data,
 * so these endpoints are guarded by requireAdminAuth (validates the x-admin-token
 * admin JWT) — they do NOT inherit the looser auth of the public list endpoints,
 * and a mobile student JWT (which carries no admin token) is rejected with 401.
 * TODO: also chain blockStudentJwt once that middleware is committed/exported
 * globally for defence-in-depth.
 *
 * Report preview, analytics, and each export format have independent backend
 * permissions so direct API calls cannot bypass the Admin UI controls.
 *
 * Date filtering is UTC and inclusive: `from` → 00:00:00.000Z of that day,
 * `to` → 23:59:59.999Z of that day. All conditions use Drizzle expressions
 * (no string interpolation of query params).
 */
import { Router, type IRouter, type NextFunction, type Response } from "express";
import { and, gte, lte, eq, or, isNull, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { Workbook } from "exceljs";
import {
  db,
  bookingsTable,
  studentsTable,
  childrenTable,
  classesTable,
  instructorsTable,
  schedulesTable,
  attendanceTable,
  balletApplicationsTable,
  packageOrdersTable,
  creditTransactionsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { sanitizeCellText } from "../lib/exportSanitizer";
import { buildPdfBuffer } from "./pdfReport";
import { logActivity } from "../lib/activityLog";

const router: IRouter = Router();

// ─── Shared types ─────────────────────────────────────────────────────────────
interface ReportColumn {
  key: string;
  label: string;
}
interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
}

const ENTITIES = ["bookings", "users", "parents", "ballet", "attendance"] as const;
type Entity = (typeof ENTITIES)[number];

// Safety cap for the underlying scan (summary is accurate up to this many
// matching rows); the response `rows` are then sliced to the requested `limit`.
const SUMMARY_MAX = 5000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QuerySchema = z.object({
  from: z.string().regex(DATE_RE, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(DATE_RE, "to must be YYYY-MM-DD").optional(),
  status: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  // `xlsx`/`pdf` stream a file download; anything else (incl. omitted) → JSON.
  format: z.enum(["json", "xlsx", "pdf"]).default("json"),
});

const AnalyticsQuerySchema = z.object({
  from: z.string().regex(DATE_RE, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(DATE_RE, "to must be YYYY-MM-DD").optional(),
});

function requireReportFormatPermission(req: AdminRequest, res: Response, next: NextFunction): void {
  const format = typeof req.query["format"] === "string" ? req.query["format"] : "json";
  const action = format === "xlsx" ? "exportExcel" : format === "pdf" ? "exportPdf" : "view";
  requireAdminPermission("reports", action)(req, res, next);
}

// Human-readable titles for each report (used in JSON title-less previews and
// the Excel worksheet/heading).
const ENTITY_TITLES: Record<Entity, string> = {
  bookings: "Bookings Report",
  users: "Users Report",
  parents: "Parents Report",
  ballet: "Ballet Applications Report",
  attendance: "Attendance Report",
};

// Short entity label shown in the PDF filters strip ("Entity: …").
const ENTITY_LABELS: Record<Entity, string> = {
  bookings: "Bookings",
  users: "Users",
  parents: "Parents",
  ballet: "Ballet Applications",
  attendance: "Attendance",
};

/** "childrenCount" → "Children Count" — mirrors the admin UI's humanize(). */
function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function dayBounds(from?: string, to?: string): { fromIso?: string; toIso?: string } {
  return {
    fromIso: from ? `${from}T00:00:00.000Z` : undefined,
    toIso: to ? `${to}T23:59:59.999Z` : undefined,
  };
}

/** YYYY-MM-DD (UTC) for display; null/invalid → "—". */
function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function yesNo(v: boolean | null | undefined): string {
  return v ? "Yes" : "No";
}

function scheduleLabel(
  type: string | null,
  dayOfWeek: number | null,
  date: string | null,
  start: string | null,
  end: string | null,
): string {
  const when = type === "one_time" && date ? fmtDate(date) : dayOfWeek != null ? DAY_NAMES[dayOfWeek] ?? "" : "";
  const time = start && end ? `${start}-${end}` : start ?? "";
  const label = [when, time].filter(Boolean).join(" ");
  return label || "—";
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function periodBounds(from?: string, to?: string): {
  from: string;
  to: string;
  fromIso: string;
  toIso: string;
  previousFromIso: string;
  previousToIso: string;
  bucket: "day" | "week" | "month";
} {
  const today = new Date();
  const fallbackTo = today.toISOString().slice(0, 10);
  const fallbackFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const fromDay = from ?? fallbackFrom;
  const toDay = to ?? fallbackTo;
  const currentStart = new Date(`${fromDay}T00:00:00.000Z`);
  const currentEnd = new Date(`${toDay}T23:59:59.999Z`);
  const days = Math.max(1, Math.ceil((currentEnd.getTime() - currentStart.getTime()) / 86_400_000));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(currentStart, -days);
  return {
    from: fromDay,
    to: toDay,
    fromIso: `${fromDay}T00:00:00.000Z`,
    toIso: `${toDay}T23:59:59.999Z`,
    previousFromIso: `${previousStart.toISOString().slice(0, 10)}T00:00:00.000Z`,
    previousToIso: `${previousEnd.toISOString().slice(0, 10)}T23:59:59.999Z`,
    bucket: days <= 14 ? "day" : days <= 90 ? "week" : "month",
  };
}

function bucketLabel(value: string | null | undefined, bucket: "day" | "week" | "month"): string {
  const d = parseDate(value);
  if (!d) return "Unknown";
  if (bucket === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (bucket === "week") {
    const day = (d.getUTCDay() + 6) % 7;
    const monday = addDays(d, -day);
    return `Week of ${monday.toISOString().slice(0, 10)}`;
  }
  return d.toISOString().slice(0, 10);
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function mapToChart(map: Map<string, number>): { name: string; count: number }[] {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }));
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

type ClassPerformanceRow = {
  classId: number;
  className: string;
  instructor: string;
  totalBookings: number;
  totalAttendance: number;
  attendanceRate: number;
  noShowCount: number;
  cancellationCount: number;
};

function normalizeBookingStatus(status?: string | null): string {
  return status || "confirmed";
}

// ─── Entity reports ─────────────────────────────────────────────────────────
async function bookingsReport(fromIso: string | undefined, toIso: string | undefined, status: string | undefined, limit: number): Promise<ReportResult> {
  const conds = [];
  if (fromIso) conds.push(gte(bookingsTable.bookedAt, fromIso));
  if (toIso) conds.push(lte(bookingsTable.bookedAt, toIso));
  if (status && status !== "all") conds.push(eq(bookingsTable.bookingStatus, status));

  const owner = alias(studentsTable, "owner");
  const raw = await db
    .select({
      id: bookingsTable.id,
      studentName: bookingsTable.studentName,
      studentEmail: bookingsTable.studentEmail,
      bookingScope: bookingsTable.bookingScope,
      bookingStatus: bookingsTable.bookingStatus,
      paymentStatus: bookingsTable.paymentStatus,
      paymentMode: bookingsTable.paymentMode,
      bookedAt: bookingsTable.bookedAt,
      classTitle: classesTable.title,
      schedType: schedulesTable.type,
      schedDay: schedulesTable.dayOfWeek,
      schedDate: schedulesTable.date,
      schedStart: schedulesTable.startTime,
      schedEnd: schedulesTable.endTime,
      ownerName: owner.name,
      ownerEmail: owner.email,
      childName: childrenTable.fullName,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .leftJoin(owner, eq(bookingsTable.accountOwnerStudentId, owner.id))
    .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
    .where(and(...conds))
    .orderBy(desc(bookingsTable.bookedAt))
    .limit(SUMMARY_MAX);

  const summary = {
    total: raw.length,
    confirmed: raw.filter((r) => r.bookingStatus === "confirmed").length,
    cancelled: raw.filter((r) => r.bookingStatus === "cancelled").length,
    pending: raw.filter((r) => r.bookingStatus === "pending").length,
    paid: raw.filter((r) => r.paymentStatus === "paid").length,
    pendingPayment: raw.filter((r) => r.paymentStatus === "pending_payment").length,
  };

  const rows = raw.slice(0, limit).map((r) => ({
    id: r.id,
    participant: r.childName ?? r.studentName,
    accountOwner: r.ownerName ?? r.studentName,
    accountOwnerEmail: r.ownerEmail ?? r.studentEmail,
    scope: r.bookingScope ?? (r.childName ? "child" : "self"),
    class: r.classTitle ?? "—",
    schedule: scheduleLabel(r.schedType, r.schedDay, r.schedDate, r.schedStart, r.schedEnd),
    bookingStatus: r.bookingStatus,
    paymentStatus: r.paymentStatus,
    paymentMode: r.paymentMode ?? "—",
    bookedAt: fmtDate(r.bookedAt),
  }));

  const columns: ReportColumn[] = [
    { key: "id", label: "Booking ID" },
    { key: "participant", label: "Participant" },
    { key: "accountOwner", label: "Account Owner" },
    { key: "accountOwnerEmail", label: "Owner Email" },
    { key: "scope", label: "Scope" },
    { key: "class", label: "Class" },
    { key: "schedule", label: "Schedule" },
    { key: "bookingStatus", label: "Booking Status" },
    { key: "paymentStatus", label: "Payment Status" },
    { key: "paymentMode", label: "Payment Mode" },
    { key: "bookedAt", label: "Booked At" },
  ];
  return { columns, rows, summary };
}

async function usersReport(fromIso: string | undefined, toIso: string | undefined, status: string | undefined, limit: number): Promise<ReportResult> {
  const conds = [];
  if (fromIso) conds.push(gte(studentsTable.joinedAt, fromIso));
  if (toIso) conds.push(lte(studentsTable.joinedAt, toIso));
  if (status === "student") conds.push(or(eq(studentsTable.accountType, "student"), isNull(studentsTable.accountType)));
  else if (status === "parent") conds.push(eq(studentsTable.accountType, "parent"));

  const raw = await db
    .select({
      id: studentsTable.id,
      name: studentsTable.name,
      email: studentsTable.email,
      phone: studentsTable.phone,
      accountType: studentsTable.accountType,
      authProvider: studentsTable.authProvider,
      emailVerified: studentsTable.emailVerified,
      profileCompleted: studentsTable.profileCompleted,
      joinedAt: studentsTable.joinedAt,
    })
    .from(studentsTable)
    .where(and(...conds))
    .orderBy(desc(studentsTable.joinedAt))
    .limit(SUMMARY_MAX);

  const summary = {
    total: raw.length,
    students: raw.filter((r) => !r.accountType || r.accountType === "student").length,
    parents: raw.filter((r) => r.accountType === "parent").length,
    verified: raw.filter((r) => r.emailVerified).length,
    profileCompleted: raw.filter((r) => r.profileCompleted).length,
  };

  const rows = raw.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone ?? "—",
    accountType: r.accountType ?? "student",
    authProvider: r.authProvider ?? "local",
    emailVerified: yesNo(r.emailVerified),
    profileCompleted: yesNo(r.profileCompleted),
    joinedAt: fmtDate(r.joinedAt),
  }));

  const columns: ReportColumn[] = [
    { key: "id", label: "User ID" },
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "accountType", label: "Account Type" },
    { key: "authProvider", label: "Auth Provider" },
    { key: "emailVerified", label: "Email Verified" },
    { key: "profileCompleted", label: "Profile Completed" },
    { key: "joinedAt", label: "Joined At" },
  ];
  return { columns, rows, summary };
}

async function parentsReport(fromIso: string | undefined, toIso: string | undefined, limit: number): Promise<ReportResult> {
  const conds = [eq(studentsTable.accountType, "parent")];
  if (fromIso) conds.push(gte(studentsTable.joinedAt, fromIso));
  if (toIso) conds.push(lte(studentsTable.joinedAt, toIso));

  const raw = await db
    .select({
      id: studentsTable.id,
      name: studentsTable.name,
      email: studentsTable.email,
      phone: studentsTable.phone,
      joinedAt: studentsTable.joinedAt,
    })
    .from(studentsTable)
    .where(and(...conds))
    .orderBy(desc(studentsTable.joinedAt))
    .limit(SUMMARY_MAX);

  // Children count per parent (one scan, counted in JS).
  const childRows = await db.select({ parentId: childrenTable.parentId }).from(childrenTable);
  const childCount = new Map<number, number>();
  for (const c of childRows) childCount.set(c.parentId, (childCount.get(c.parentId) ?? 0) + 1);

  const totalChildren = raw.reduce((sum, p) => sum + (childCount.get(p.id) ?? 0), 0);
  const summary = {
    totalParents: raw.length,
    totalChildren,
    avgChildrenPerParent: raw.length ? Math.round((totalChildren / raw.length) * 100) / 100 : 0,
  };

  const rows = raw.slice(0, limit).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone ?? "—",
    childrenCount: childCount.get(p.id) ?? 0,
    joinedAt: fmtDate(p.joinedAt),
  }));

  const columns: ReportColumn[] = [
    { key: "id", label: "Parent ID" },
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "childrenCount", label: "Children" },
    { key: "joinedAt", label: "Joined At" },
  ];
  return { columns, rows, summary };
}

async function balletReport(fromIso: string | undefined, toIso: string | undefined, status: string | undefined, limit: number): Promise<ReportResult> {
  const conds = [];
  if (fromIso) conds.push(gte(balletApplicationsTable.createdAt, fromIso));
  if (toIso) conds.push(lte(balletApplicationsTable.createdAt, toIso));
  if (status && status !== "all") conds.push(eq(balletApplicationsTable.status, status));

  const raw = await db
    .select({
      id: balletApplicationsTable.id,
      parentName: balletApplicationsTable.parentName,
      parentEmail: balletApplicationsTable.parentEmail,
      childName: balletApplicationsTable.childName,
      childAge: balletApplicationsTable.childAge,
      status: balletApplicationsTable.status,
      assessmentDate: balletApplicationsTable.assessmentDate,
      createdAt: balletApplicationsTable.createdAt,
    })
    .from(balletApplicationsTable)
    .where(and(...conds))
    .orderBy(desc(balletApplicationsTable.createdAt))
    .limit(SUMMARY_MAX);

  const summary = {
    total: raw.length,
    submitted: raw.filter((r) => r.status === "pending").length,
    active: raw.filter((r) => r.status === "active").length,
    rejected: raw.filter((r) => r.status === "rejected").length,
  };

  const rows = raw.slice(0, limit).map((r) => ({
    id: r.id,
    parentName: r.parentName,
    parentEmail: r.parentEmail,
    childName: r.childName,
    childAge: r.childAge ?? "—",
    status: r.status,
    assessmentDate: r.assessmentDate ?? "—",
    createdAt: fmtDate(r.createdAt),
  }));

  const columns: ReportColumn[] = [
    { key: "id", label: "Application ID" },
    { key: "parentName", label: "Parent Name" },
    { key: "parentEmail", label: "Parent Email" },
    { key: "childName", label: "Child Name" },
    { key: "childAge", label: "Child Age" },
    { key: "status", label: "Status" },
    { key: "assessmentDate", label: "Assessment Date" },
    { key: "createdAt", label: "Created At" },
  ];
  return { columns, rows, summary };
}

async function attendanceReport(fromIso: string | undefined, toIso: string | undefined, status: string | undefined, limit: number): Promise<ReportResult> {
  const conds = [];
  if (fromIso) conds.push(gte(attendanceTable.checkedInAt, fromIso));
  if (toIso) conds.push(lte(attendanceTable.checkedInAt, toIso));
  if (status && status !== "all") conds.push(eq(attendanceTable.status, status));

  const raw = await db
    .select({
      id: attendanceTable.id,
      studentName: attendanceTable.studentName,
      classTitle: attendanceTable.classTitle,
      status: attendanceTable.status,
      creditDeducted: attendanceTable.creditDeducted,
      checkedInBy: attendanceTable.checkedInBy,
      checkedInAt: attendanceTable.checkedInAt,
      schedType: schedulesTable.type,
      schedDay: schedulesTable.dayOfWeek,
      schedDate: schedulesTable.date,
      schedStart: schedulesTable.startTime,
      schedEnd: schedulesTable.endTime,
    })
    .from(attendanceTable)
    .leftJoin(schedulesTable, eq(attendanceTable.scheduleId, schedulesTable.id))
    .where(and(...conds))
    .orderBy(desc(attendanceTable.checkedInAt))
    .limit(SUMMARY_MAX);

  const summary = {
    total: raw.length,
    checkedIn: raw.filter((r) => !r.status || r.status === "checked_in").length,
    late: raw.filter((r) => r.status === "late").length,
    absent: raw.filter((r) => r.status === "absent").length,
    cancelled: raw.filter((r) => r.status === "cancelled").length,
    creditsDeducted: raw.filter((r) => r.creditDeducted).length,
  };

  const rows = raw.slice(0, limit).map((r) => ({
    id: r.id,
    participant: r.studentName,
    class: r.classTitle ?? "—",
    schedule: scheduleLabel(r.schedType, r.schedDay, r.schedDate, r.schedStart, r.schedEnd),
    status: r.status ?? "checked_in",
    creditDeducted: yesNo(r.creditDeducted),
    checkedInBy: r.checkedInBy ?? "—",
    checkedInAt: fmtDate(r.checkedInAt),
  }));

  const columns: ReportColumn[] = [
    { key: "id", label: "Attendance ID" },
    { key: "participant", label: "Participant" },
    { key: "class", label: "Class" },
    { key: "schedule", label: "Schedule" },
    { key: "status", label: "Status" },
    { key: "creditDeducted", label: "Credit Deducted" },
    { key: "checkedInBy", label: "Checked In By" },
    { key: "checkedInAt", label: "Checked In At" },
  ];
  return { columns, rows, summary };
}

async function analyticsReport(from?: string, to?: string) {
  const period = periodBounds(from, to);
  const dateFilter = (
    column:
      | typeof bookingsTable.bookedAt
      | typeof attendanceTable.checkedInAt
      | typeof studentsTable.joinedAt
      | typeof packageOrdersTable.createdAt
      | typeof creditTransactionsTable.createdAt
      | typeof balletApplicationsTable.createdAt,
  ) =>
    and(gte(column, period.fromIso), lte(column, period.toIso));

  const bookingRows = await db
    .select({
      id: bookingsTable.id,
      bookingStatus: bookingsTable.bookingStatus,
      status: bookingsTable.status,
      paymentStatus: bookingsTable.paymentStatus,
      bookedAt: bookingsTable.bookedAt,
      classId: bookingsTable.classId,
      classTitle: classesTable.title,
      instructorName: instructorsTable.name,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .where(dateFilter(bookingsTable.bookedAt))
    .limit(SUMMARY_MAX);

  const attendanceRows = await db
    .select({
      id: attendanceTable.id,
      status: attendanceTable.status,
      checkedInAt: attendanceTable.checkedInAt,
      classId: attendanceTable.classId,
      classTitle: attendanceTable.classTitle,
      bookingId: attendanceTable.bookingId,
    })
    .from(attendanceTable)
    .where(dateFilter(attendanceTable.checkedInAt))
    .limit(SUMMARY_MAX);

  const userRows = await db
    .select({
      id: studentsTable.id,
      accountType: studentsTable.accountType,
      joinedAt: studentsTable.joinedAt,
    })
    .from(studentsTable)
    .where(and(gte(studentsTable.joinedAt, period.previousFromIso), lte(studentsTable.joinedAt, period.toIso)))
    .limit(SUMMARY_MAX);

  const packageRows = await db
    .select({
      id: packageOrdersTable.id,
      status: packageOrdersTable.status,
      totalCredits: packageOrdersTable.totalCredits,
      remainingCredits: packageOrdersTable.remainingCredits,
      createdAt: packageOrdersTable.createdAt,
    })
    .from(packageOrdersTable)
    .where(dateFilter(packageOrdersTable.createdAt))
    .limit(SUMMARY_MAX);

  const creditRows = await db
    .select({
      id: creditTransactionsTable.id,
      type: creditTransactionsTable.type,
      delta: creditTransactionsTable.delta,
      createdAt: creditTransactionsTable.createdAt,
    })
    .from(creditTransactionsTable)
    .where(dateFilter(creditTransactionsTable.createdAt))
    .limit(SUMMARY_MAX);

  const balletRows = await db
    .select({
      id: balletApplicationsTable.id,
      status: balletApplicationsTable.status,
      createdAt: balletApplicationsTable.createdAt,
    })
    .from(balletApplicationsTable)
    .where(dateFilter(balletApplicationsTable.createdAt))
    .limit(SUMMARY_MAX);

  const bookingTrend = new Map<string, number>();
  const attendanceTrend = new Map<string, number>();
  const userGrowthTrend = new Map<string, number>();
  const packageTrend = new Map<string, number>();

  const classMap = new Map<number, ClassPerformanceRow>();
  const ensureClass = (classId: number | null, className: string | null, instructor: string | null): ClassPerformanceRow => {
    const id = classId ?? 0;
    const existing = classMap.get(id);
    if (existing) return existing;
    const row: ClassPerformanceRow = {
      classId: id,
      className: className ?? "Unlabelled class",
      instructor: instructor ?? "Unassigned",
      totalBookings: 0,
      totalAttendance: 0,
      attendanceRate: 0,
      noShowCount: 0,
      cancellationCount: 0,
    };
    classMap.set(id, row);
    return row;
  };

  const bookingStatusCounts = new Map<string, number>();
  for (const b of bookingRows) {
    const status = normalizeBookingStatus(b.bookingStatus ?? b.status);
    increment(bookingTrend, bucketLabel(b.bookedAt, period.bucket));
    increment(bookingStatusCounts, status);
    if (b.paymentStatus === "refunded") increment(bookingStatusCounts, "refunded");

    const row = ensureClass(b.classId, b.classTitle, b.instructorName);
    row.totalBookings += 1;
    if (status === "attended" || status === "completed") row.totalAttendance += 1;
    if (status === "cancelled" || status === "rejected") row.cancellationCount += 1;
    if (status === "noShow" || status === "no_show") row.noShowCount += 1;
  }

  const attendanceStatusCounts = new Map<string, number>();
  for (const a of attendanceRows) {
    const status = a.status ?? "checked_in";
    increment(attendanceTrend, bucketLabel(a.checkedInAt, period.bucket));
    increment(attendanceStatusCounts, status);
    if (status === "absent") {
      ensureClass(a.classId, a.classTitle, null).noShowCount += 1;
    } else if (status === "cancelled") {
      ensureClass(a.classId, a.classTitle, null).cancellationCount += 1;
    } else if (status === "checked_in" || status === "late") {
      const row = ensureClass(a.classId, a.classTitle, null);
      if (!a.bookingId) row.totalAttendance += 1;
    }
  }

  const currentStudents = userRows.filter((s) => {
    const joined = parseDate(s.joinedAt);
    return joined && joined >= new Date(period.fromIso) && joined <= new Date(period.toIso);
  });
  const previousStudents = userRows.filter((s) => {
    const joined = parseDate(s.joinedAt);
    return joined && joined >= new Date(period.previousFromIso) && joined <= new Date(period.previousToIso);
  });
  const studentAccounts = (rows: typeof userRows) => rows.filter((s) => !s.accountType || s.accountType === "student").length;
  const parentAccounts = (rows: typeof userRows) => rows.filter((s) => s.accountType === "parent").length;
  for (const s of currentStudents) increment(userGrowthTrend, bucketLabel(s.joinedAt, period.bucket));
  for (const order of packageRows) increment(packageTrend, bucketLabel(order.createdAt, period.bucket));

  const classPerformance = Array.from(classMap.values()).map((row) => ({
    ...row,
    attendanceRate: row.totalBookings ? Math.round((row.totalAttendance / row.totalBookings) * 1000) / 10 : 0,
  }));
  const topClasses = [...classPerformance]
    .filter((r) => r.totalBookings > 0)
    .sort((a, b) => b.attendanceRate - a.attendanceRate || b.totalAttendance - a.totalAttendance)
    .slice(0, 5);
  const lowestClasses = [...classPerformance]
    .filter((r) => r.totalBookings >= 3)
    .sort((a, b) => a.attendanceRate - b.attendanceRate || b.totalBookings - a.totalBookings)
    .slice(0, 5);

  const attendedClasses = attendanceRows.filter((a) => !a.status || a.status === "checked_in" || a.status === "late").length;
  const creditsIssued = packageRows.reduce((sum, p) => sum + (p.totalCredits ?? 0), 0);
  const creditsUsed = creditRows.reduce((sum, tx) => sum + (tx.delta < 0 ? Math.abs(tx.delta) : 0), 0);
  const creditsRemaining = packageRows.reduce((sum, p) => sum + (p.remainingCredits ?? 0), 0);
  const packageUsageRate = creditsIssued ? Math.round((creditsUsed / creditsIssued) * 1000) / 10 : 0;

  const balletPendingStatuses = new Set(["pending", "needsFollowUp"]);
  const balletApprovedStatuses = new Set(["accepted", "assignedToLevel", "active"]);
  const currentNewStudents = studentAccounts(currentStudents);
  const previousNewStudents = studentAccounts(previousStudents);
  const currentNewParents = parentAccounts(currentStudents);
  const previousNewParents = parentAccounts(previousStudents);

  return {
    filters: {
      from: period.from,
      to: period.to,
      bucket: period.bucket,
    },
    executive: {
      totalBookings: bookingRows.length,
      confirmedBookings: bookingRows.filter((b) => normalizeBookingStatus(b.bookingStatus ?? b.status) === "confirmed").length,
      attendedClasses,
      newStudents: currentNewStudents,
      newParents: currentNewParents,
      balletApplications: balletRows.length,
      packageOrders: packageRows.length,
    },
    classPerformance: {
      rows: classPerformance.sort((a, b) => b.totalBookings - a.totalBookings || a.className.localeCompare(b.className)),
      top: topClasses,
      lowest: lowestClasses,
      minimumLowestSampleSize: 3,
    },
    attendance: {
      trend: mapToChart(attendanceTrend),
      breakdown: [
        { name: "Checked In", count: attendanceStatusCounts.get("checked_in") ?? 0 },
        { name: "Late", count: attendanceStatusCounts.get("late") ?? 0 },
        { name: "Absent", count: attendanceStatusCounts.get("absent") ?? 0 },
        { name: "Cancelled", count: attendanceStatusCounts.get("cancelled") ?? 0 },
      ],
    },
    bookings: {
      trend: mapToChart(bookingTrend),
      statusDistribution: [
        { name: "Confirmed", count: bookingStatusCounts.get("confirmed") ?? 0 },
        { name: "Pending", count: bookingStatusCounts.get("pending") ?? 0 },
        { name: "Cancelled", count: bookingStatusCounts.get("cancelled") ?? 0 },
        { name: "Refunded", count: bookingStatusCounts.get("refunded") ?? 0 },
        { name: "Completed", count: (bookingStatusCounts.get("completed") ?? 0) + (bookingStatusCounts.get("attended") ?? 0) },
        { name: "No Show", count: (bookingStatusCounts.get("noShow") ?? 0) + (bookingStatusCounts.get("no_show") ?? 0) },
      ],
    },
    growth: {
      newStudents: {
        current: currentNewStudents,
        previous: previousNewStudents,
        changePct: percentChange(currentNewStudents, previousNewStudents),
      },
      newParents: {
        current: currentNewParents,
        previous: previousNewParents,
        changePct: percentChange(currentNewParents, previousNewParents),
      },
      trend: mapToChart(userGrowthTrend),
    },
    packages: {
      orders: packageRows.length,
      creditsIssued,
      creditsUsed,
      creditsRemaining,
      usageRate: packageUsageRate,
      trend: mapToChart(packageTrend),
    },
    ballet: {
      submitted: balletRows.length,
      approved: balletRows.filter((b) => balletApprovedStatuses.has(b.status)).length,
      pending: balletRows.filter((b) => balletPendingStatuses.has(b.status)).length,
      rejected: balletRows.filter((b) => b.status === "rejected").length,
      cancelled: balletRows.filter((b) => b.status === "cancelled").length,
      withdrawn: balletRows.filter((b) => b.status === "withdrawn").length,
      activeBalletStudents: balletRows.filter((b) => b.status === "active").length,
    },
  };
}

// ─── Excel export ─────────────────────────────────────────────────────────────
// Builds a single-worksheet .xlsx from the SAME ReportResult used for the JSON
// preview, so the download always matches what the admin sees on screen.
// Layout: title → generated timestamp → date range → active filters → summary
// rows → (blank) → bold table header (frozen) → table rows.
async function buildXlsxBuffer(
  entity: Entity,
  result: ReportResult,
  filters: { from?: string; to?: string; status?: string },
): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = "Central Studio Admin";
  wb.created = new Date();

  const ws = wb.addWorksheet(ENTITY_TITLES[entity], {
    views: [], // header freeze set after we know its row number
  });

  // ── Meta block ──
  const titleRow = ws.addRow([ENTITY_TITLES[entity]]);
  titleRow.font = { bold: true, size: 14 };

  ws.addRow([`Generated: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`]);

  const rangeLabel =
    filters.from || filters.to
      ? `${filters.from ?? "—"} to ${filters.to ?? "—"}`
      : "All dates";
  ws.addRow([`Date range: ${rangeLabel}`]);
  ws.addRow([`Filters: status = ${filters.status && filters.status !== "all" ? filters.status : "all"}`]);

  ws.addRow([]);

  // ── Summary block ──
  // (The meta lines above are safe without sanitizing: each interpolates
  // user input only after a fixed "Label: " prefix, and formulas only
  // trigger on a cell's FIRST character.)
  const summaryHeader = ws.addRow(["Summary"]);
  summaryHeader.font = { bold: true };
  for (const [key, val] of Object.entries(result.summary)) {
    ws.addRow([humanizeKey(key), typeof val === "string" ? sanitizeCellText(val) : (val as number)]);
  }

  ws.addRow([]);

  // ── Table header (bold + frozen) ──
  const headerRow = ws.addRow(result.columns.map((c) => c.label));
  headerRow.font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: headerRow.number }];

  // ── Table rows: keep numbers numeric, blanks for null/undefined ──
  // Every text cell goes through sanitizeCellText — rows contain
  // attacker-controlled values (student names, emails, phones), and all
  // spreadsheet exports must neutralize formula prefixes (Security Phase H).
  for (const row of result.rows) {
    ws.addRow(
      result.columns.map((c) => {
        const v = row[c.key];
        if (v == null) return "";
        return typeof v === "number" || typeof v === "boolean" ? v : sanitizeCellText(String(v));
      }),
    );
  }

  // ── Simple auto-width (capped) ──
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cell.value == null ? 0 : String(cell.value).length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 60);
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Routes ───────────────────────────────────────────────────────────────────
router.get(
  "/reports/analytics",
  requireAdminAuth,
  requireAdminPermission("reports", "analytics"),
  async (req, res): Promise<void> => {
  const parsed = AnalyticsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query parameters" });
    return;
  }

  const { from, to } = parsed.data;
  res.json(await analyticsReport(from, to));
  },
);

router.get("/reports/:entity", requireAdminAuth, requireReportFormatPermission, async (req, res): Promise<void> => {
  const entity = req.params.entity as Entity;
  if (!ENTITIES.includes(entity)) {
    res.status(400).json({ error: `Unknown report entity '${req.params.entity}'. Allowed: ${ENTITIES.join(", ")}` });
    return;
  }

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query parameters" });
    return;
  }
  const { from, to, status, limit, format } = parsed.data;
  const { fromIso, toIso } = dayBounds(from, to);

  let result: ReportResult;
  switch (entity) {
    case "bookings":   result = await bookingsReport(fromIso, toIso, status, limit); break;
    case "users":      result = await usersReport(fromIso, toIso, status, limit); break;
    case "parents":    result = await parentsReport(fromIso, toIso, limit); break;
    case "ballet":     result = await balletReport(fromIso, toIso, status, limit); break;
    case "attendance": result = await attendanceReport(fromIso, toIso, status, limit); break;
  }

  // File exports (xlsx/pdf): same data builder as the JSON preview, streamed as a
  // download. The admin JWT travels in the x-admin-token header and the format
  // permission was checked before report generation.
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "xlsx") {
    try {
      const buf = await buildXlsxBuffer(entity, result, { from, to, status });
      await logActivity(req as AdminRequest, {
        action: "exportExcel",
        module: "reports",
        entityType: "report_export",
        entityId: entity,
        entityLabel: ENTITY_LABELS[entity],
        after: { entity, format: "xlsx", from: from ?? null, to: to ?? null, status: status ?? null, rowCount: result.rows.length },
        summary: `Exported ${ENTITY_LABELS[entity]} report as Excel`,
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${entity}-report-${stamp}.xlsx"`);
      res.send(buf);
    } catch (err) {
      console.error("[reports] xlsx export failed:", err);
      res.status(500).json({ error: "Failed to generate Excel export" });
    }
    return;
  }

  if (format === "pdf") {
    try {
      const buf = await buildPdfBuffer({
        title: ENTITY_TITLES[entity],
        entityLabel: ENTITY_LABELS[entity],
        columns: result.columns,
        rows: result.rows,
        summary: result.summary,
        filters: { from, to, status },
        generatedBy: (req as AdminRequest).adminUser?.username ?? "Admin",
      });
      await logActivity(req as AdminRequest, {
        action: "exportPdf",
        module: "reports",
        entityType: "report_export",
        entityId: entity,
        entityLabel: ENTITY_LABELS[entity],
        after: { entity, format: "pdf", from: from ?? null, to: to ?? null, status: status ?? null, rowCount: result.rows.length },
        summary: `Exported ${ENTITY_LABELS[entity]} report as PDF`,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${entity}-report-${stamp}.pdf"`);
      res.send(buf);
    } catch (err) {
      console.error("[reports] pdf export failed:", err);
      res.status(500).json({ error: "Failed to generate PDF export" });
    }
    return;
  }

  res.json({
    entity,
    columns: result.columns,
    rows: result.rows,
    summary: result.summary,
    filters: { from, to, status, entity },
  });
});

export default router;
