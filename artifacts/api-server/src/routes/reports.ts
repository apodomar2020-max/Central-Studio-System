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
 * NOTE (follow-up): there is no "reports" entry in ADMIN_MODULES and no
 * requirePermission middleware in this codebase yet, so access is gated at the
 * "any authenticated admin" level (the existing pattern). A future task should
 * add `reports.view` / `reports.export` permissions and enforce them here.
 *
 * Date filtering is UTC and inclusive: `from` → 00:00:00.000Z of that day,
 * `to` → 23:59:59.999Z of that day. All conditions use Drizzle expressions
 * (no string interpolation of query params).
 */
import { Router, type IRouter } from "express";
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
  schedulesTable,
  attendanceTable,
  balletApplicationsTable,
} from "@workspace/db";
import { requireAdminAuth } from "./adminAuth";

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
  // `xlsx` streams an Excel download; anything else (incl. omitted) returns JSON.
  format: z.enum(["json", "xlsx"]).default("json"),
});

// Human-readable titles for each report (used in JSON title-less previews and
// the Excel worksheet/heading).
const ENTITY_TITLES: Record<Entity, string> = {
  bookings: "Bookings Report",
  users: "Users Report",
  parents: "Parents Report",
  ballet: "Ballet Applications Report",
  attendance: "Attendance Report",
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
      slotLabel: balletApplicationsTable.slotLabel,
      createdAt: balletApplicationsTable.createdAt,
    })
    .from(balletApplicationsTable)
    .where(and(...conds))
    .orderBy(desc(balletApplicationsTable.createdAt))
    .limit(SUMMARY_MAX);

  const summary = {
    total: raw.length,
    submitted: raw.filter((r) => r.status === "submitted").length,
    active: raw.filter((r) => r.status === "activeBallet").length,
    rejected: raw.filter((r) => r.status === "rejected").length,
  };

  const rows = raw.slice(0, limit).map((r) => ({
    id: r.id,
    parentName: r.parentName,
    parentEmail: r.parentEmail,
    childName: r.childName,
    childAge: r.childAge ?? "—",
    status: r.status,
    slotLabel: r.slotLabel ?? "—",
    createdAt: fmtDate(r.createdAt),
  }));

  const columns: ReportColumn[] = [
    { key: "id", label: "Application ID" },
    { key: "parentName", label: "Parent Name" },
    { key: "parentEmail", label: "Parent Email" },
    { key: "childName", label: "Child Name" },
    { key: "childAge", label: "Child Age" },
    { key: "status", label: "Status" },
    { key: "slotLabel", label: "Preferred Slot" },
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
  const summaryHeader = ws.addRow(["Summary"]);
  summaryHeader.font = { bold: true };
  for (const [key, val] of Object.entries(result.summary)) {
    ws.addRow([humanizeKey(key), val as string | number]);
  }

  ws.addRow([]);

  // ── Table header (bold + frozen) ──
  const headerRow = ws.addRow(result.columns.map((c) => c.label));
  headerRow.font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: headerRow.number }];

  // ── Table rows: keep numbers numeric, blanks for null/undefined ──
  for (const row of result.rows) {
    ws.addRow(
      result.columns.map((c) => {
        const v = row[c.key];
        if (v == null) return "";
        return typeof v === "number" || typeof v === "boolean" ? v : String(v);
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

// ─── Route ────────────────────────────────────────────────────────────────────
// TODO: add blockStudentJwt once middleware is committed/exported globally.
router.get("/reports/:entity", requireAdminAuth, async (req, res): Promise<void> => {
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

  // Excel export: same data builder as the JSON preview, streamed as a download.
  // Auth is unchanged (requireAdminAuth above) — no token in the query string,
  // the admin JWT travels in the x-admin-token header of this same request.
  if (format === "xlsx") {
    const buf = await buildXlsxBuffer(entity, result, { from, to, status });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${entity}-report-${stamp}.xlsx"`);
    res.send(buf);
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
