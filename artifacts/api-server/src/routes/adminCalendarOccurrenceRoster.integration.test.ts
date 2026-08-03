/**
 * Real-route integration coverage for Phase 4A.1 —
 * GET /admin/calendar/occurrence-roster (routes/adminCalendarOccurrenceRoster.ts).
 * Read-only: no schedule, booking, or attendance row is created, updated,
 * or blocked by this endpoint.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values. This
 * file boots the actual Express router and uses real admin auth middleware;
 * it never calls route helpers directly.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ROUTES_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;
process.env.API_SECRET_KEY = "test-api-secret-key";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: import("pg").Pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function tokenFor(userId: number): string {
  return jwtSign({ sub: userId, username: `roster-user-${userId}`, isSuperAdmin: false, roleId: null }, ADMIN_JWT_SECRET);
}

async function getAs(userId: number, path: string): Promise<Response> {
  return fetch(apiUrl(path), {
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key", "x-admin-token": tokenFor(userId) },
  });
}

async function getAsSuperAdmin(path: string): Promise<Response> {
  return getAs(superAdminId, path);
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function insertRoleAndUser(run: string, label: string, permissions: Record<string, Record<string, boolean>>): Promise<number> {
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2) RETURNING id`,
    [`Roster Role ${run} ${label}`, JSON.stringify(permissions)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id)
     VALUES ($1, $2, 'x', 'Roster Test User', false, $3) RETURNING id`,
    [`roster-user-${run}-${label}`, `roster-user-${run}-${label}@example.com`, roleId],
  );
  return user.rows[0].id as number;
}

async function insertBranchAndRoom(run: string, label: string): Promise<{ branchId: number; roomId: number }> {
  const branch = await pool.query(`INSERT INTO studio_branches (name) VALUES ($1) RETURNING id`, [`Roster Branch ${run} ${label}`]);
  const branchId = branch.rows[0].id as number;
  const room = await pool.query(`INSERT INTO studio_rooms (branch_id, name) VALUES ($1, $2) RETURNING id`, [branchId, `Roster Room ${run} ${label}`]);
  return { branchId, roomId: room.rows[0].id as number };
}

async function insertRegularClass(run: string, label: string, capacity = 20): Promise<number> {
  const res = await pool.query(
    `INSERT INTO classes (title, category, duration_mins, capacity) VALUES ($1, 'Hip Hop', 60, $2) RETURNING id`,
    [`Roster Regular Class ${run} ${label}`, capacity],
  );
  return res.rows[0].id as number;
}

async function insertRegularSchedule(classId: number, branchId: number, roomId: number, dayOfWeek: number, startTime: string, endTime: string): Promise<number> {
  const res = await pool.query(
    `INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES ($1, $2, $3, 'weekly', 'active', $4, $5, $6, true) RETURNING id`,
    [classId, branchId, roomId, dayOfWeek, startTime, endTime],
  );
  return res.rows[0].id as number;
}

async function insertCanonicalBalletClass(run: string, label: string): Promise<number> {
  const level = await pool.query(`INSERT INTO ballet_levels (name, sort_order, is_active) VALUES ($1, 990, true) RETURNING id`, [`Roster Level ${run} ${label}`]);
  const levelId = level.rows[0].id as number;
  const group = await pool.query(`INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Roster Group ${run} ${label}`, levelId]);
  const groupId = group.rows[0].id as number;
  const instructor = await pool.query(`INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`, [`Roster Instructor ${run} ${label}`]);
  const instructorId = instructor.rows[0].id as number;
  const balletClass = await pool.query(
    `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active) VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
    [`Roster Ballet Class ${run} ${label}`, levelId, groupId, instructorId],
  );
  return balletClass.rows[0].id as number;
}

async function insertBalletSchedule(classId: number, branchId: number, roomId: number, dayOfWeek: number, startTime: string, endTime: string, capacity = 15): Promise<number> {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const res = await pool.query(
    `INSERT INTO ballet_schedules (class_id, branch_id, room_id, day_of_week, start_time, end_time, duration_mins, status, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8) RETURNING id`,
    [classId, branchId, roomId, dayOfWeek, startTime, endTime, (eh * 60 + em) - (sh * 60 + sm), capacity],
  );
  return res.rows[0].id as number;
}

async function insertBooking(opts: {
  studentName: string; studentEmail: string; scheduleId?: number; balletScheduleId?: number; occurrenceDate?: string;
  bookingStatus?: string; paymentStatus?: string; classId?: number;
}): Promise<number> {
  const res = await pool.query(
    `INSERT INTO bookings (student_name, student_email, class_id, schedule_id, ballet_schedule_id, occurrence_date, booking_status, payment_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      opts.studentName, opts.studentEmail, opts.classId ?? null, opts.scheduleId ?? null, opts.balletScheduleId ?? null,
      opts.occurrenceDate ?? null, opts.bookingStatus ?? "confirmed", opts.paymentStatus ?? "paid",
    ],
  );
  return res.rows[0].id as number;
}

async function insertAttendance(bookingId: number, studentName: string, studentEmail: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO attendance (booking_id, student_name, student_email, status) VALUES ($1, $2, $3, $4)`,
    [bookingId, studentName, studentEmail, status],
  );
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const adminCalendarOccurrenceRosterRouter = (await import("./adminCalendarOccurrenceRoster.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", adminCalendarOccurrenceRosterRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id as number;
  } else {
    const superAdmin = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin) VALUES ($1, $2, 'x', 'Roster Super', true) RETURNING id`,
      [`roster-super-${run}`, `roster-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("regular occurrence returns the schedule summary and a correct roster", async () => {
  const run = `regular-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertRegularClass(run, "a", 20);
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertRegularSchedule(classId, branchId, roomId, 1, "10:00", "11:00");
  const occurrenceDate = "2026-08-10";
  await insertBooking({ studentName: "Sara Ahmed", studentEmail: "sara@example.com", scheduleId, occurrenceDate, classId });

  const res = await getAsSuperAdmin(`/api/admin/calendar/occurrence-roster?source=class&scheduleId=${scheduleId}&occurrenceDate=${occurrenceDate}`);
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.scheduleId, scheduleId);
  assert.equal(body.source, "class");
  assert.equal(body.capacity, 20);
  assert.equal(body.startTime, "10:00");
  assert.equal(body.endTime, "11:00");
  assert.equal(body.bookingCount, 1);
  assert.deepEqual(body.summary, {
    checkedInCount: 0,
    absentCount: 0,
    pendingCheckInCount: 1,
    remainingCapacity: 19,
    unpaidCount: 0,
  });
  const roster = body.roster as Array<Record<string, unknown>>;
  assert.equal(roster.length, 1);
  assert.equal(roster[0].studentName, "Sara Ahmed");
  assert.equal(roster[0].participantName, "Sara Ahmed");
  assert.equal(roster[0].bookingStatus, "confirmed");
  assert.equal(roster[0].paymentStatus, "paid");
});

test("regular roster is scoped to the exact occurrence date — a booking on a different date is excluded", async () => {
  const run = `regular-scoped-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertRegularClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertRegularSchedule(classId, branchId, roomId, 2, "12:00", "13:00");
  await insertBooking({ studentName: "Other Week", studentEmail: "other@example.com", scheduleId, occurrenceDate: "2026-08-04", classId });

  const res = await getAsSuperAdmin(`/api/admin/calendar/occurrence-roster?source=class&scheduleId=${scheduleId}&occurrenceDate=2026-08-11`);
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.bookingCount, 0);
  assert.deepEqual(body.roster, []);
});

test("ballet occurrence returns the schedule summary and its full (non-occurrence-scoped) roster", async () => {
  const run = `ballet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertCanonicalBalletClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertBalletSchedule(classId, branchId, roomId, 3, "16:00", "17:00", 12);
  await insertBooking({ studentName: "Layla Hassan", studentEmail: "layla@example.com", balletScheduleId: scheduleId });

  const res = await getAsSuperAdmin(`/api/admin/calendar/occurrence-roster?source=ballet&scheduleId=${scheduleId}&occurrenceDate=2026-08-10`);
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.source, "ballet");
  assert.equal(body.capacity, 12);
  assert.equal(body.bookingCount, 1);
  const roster = body.roster as Array<Record<string, unknown>>;
  assert.equal(roster.length, 1);
  assert.equal(roster[0].studentName, "Layla Hassan");
});

test("a booking with attendance returns attendanceStatus and checkedInAt", async () => {
  const run = `with-attendance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertRegularClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertRegularSchedule(classId, branchId, roomId, 4, "09:00", "10:00");
  const occurrenceDate = "2026-08-13";
  const bookingId = await insertBooking({ studentName: "Nour Khaled", studentEmail: "nour@example.com", scheduleId, occurrenceDate, classId });
  await insertAttendance(bookingId, "Nour Khaled", "nour@example.com", "checked_in");

  const res = await getAsSuperAdmin(`/api/admin/calendar/occurrence-roster?source=class&scheduleId=${scheduleId}&occurrenceDate=${occurrenceDate}`);
  const body = await jsonBody(res);
  const roster = body.roster as Array<Record<string, unknown>>;
  assert.equal(roster.length, 1);
  assert.equal(roster[0].attendanceStatus, "checked_in");
  assert.ok(roster[0].checkedInAt);
});

test("a booking without attendance returns attendanceStatus = null", async () => {
  const run = `without-attendance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertRegularClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertRegularSchedule(classId, branchId, roomId, 5, "14:00", "15:00");
  const occurrenceDate = "2026-08-14";
  await insertBooking({ studentName: "No Show Yet", studentEmail: "noshow@example.com", scheduleId, occurrenceDate, classId });

  const res = await getAsSuperAdmin(`/api/admin/calendar/occurrence-roster?source=class&scheduleId=${scheduleId}&occurrenceDate=${occurrenceDate}`);
  const body = await jsonBody(res);
  const roster = body.roster as Array<Record<string, unknown>>;
  assert.equal(roster.length, 1);
  assert.equal(roster[0].attendanceStatus, null);
  assert.equal(roster[0].checkedInAt, null);
});

test("an occurrence with no bookings returns an empty roster array, not an error", async () => {
  const run = `empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertRegularClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertRegularSchedule(classId, branchId, roomId, 6, "17:00", "18:00");

  const res = await getAsSuperAdmin(`/api/admin/calendar/occurrence-roster?source=class&scheduleId=${scheduleId}&occurrenceDate=2026-08-15`);
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.bookingCount, 0);
  assert.deepEqual(body.roster, []);
});

test("missing or invalid parameters return 400", async () => {
  const missingAll = await getAsSuperAdmin("/api/admin/calendar/occurrence-roster");
  assert.equal(missingAll.status, 400);

  const badSource = await getAsSuperAdmin("/api/admin/calendar/occurrence-roster?source=invalid&scheduleId=1&occurrenceDate=2026-08-10");
  assert.equal(badSource.status, 400);

  const badDate = await getAsSuperAdmin("/api/admin/calendar/occurrence-roster?source=class&scheduleId=1&occurrenceDate=not-a-date");
  assert.equal(badDate.status, 400);

  const missingScheduleId = await getAsSuperAdmin("/api/admin/calendar/occurrence-roster?source=class&occurrenceDate=2026-08-10");
  assert.equal(missingScheduleId.status, 400);
});

test("an unknown schedule id returns 404", async () => {
  const res = await getAsSuperAdmin("/api/admin/calendar/occurrence-roster?source=class&scheduleId=999999999&occurrenceDate=2026-08-10");
  assert.equal(res.status, 404);
});

test("permission: missing bookings.view is rejected with 403", async () => {
  const run = `perm-no-bookings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = await insertRoleAndUser(run, "no-bookings", { attendance: { view: true } });
  const res = await getAs(userId, "/api/admin/calendar/occurrence-roster?source=class&scheduleId=1&occurrenceDate=2026-08-10");
  assert.equal(res.status, 403);
});

test("permission: missing attendance.view is rejected with 403", async () => {
  const run = `perm-no-attendance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = await insertRoleAndUser(run, "no-attendance", { bookings: { view: true } });
  const res = await getAs(userId, "/api/admin/calendar/occurrence-roster?source=class&scheduleId=1&occurrenceDate=2026-08-10");
  assert.equal(res.status, 403);
});

test("permission: both bookings.view and attendance.view succeeds", async () => {
  const run = `perm-both-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertRegularClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertRegularSchedule(classId, branchId, roomId, 0, "11:00", "12:00");
  const userId = await insertRoleAndUser(run, "both", { bookings: { view: true }, attendance: { view: true } });

  const res = await getAs(userId, `/api/admin/calendar/occurrence-roster?source=class&scheduleId=${scheduleId}&occurrenceDate=2026-08-16`);
  assert.equal(res.status, 200);
});
