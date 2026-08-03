/**
 * Real-route integration coverage for Phase 2D — conflict visibility on
 * GET /admin/calendar (routes/adminCalendar.ts). Read-only: no schedule is
 * created, updated, or blocked by this endpoint; it only labels occurrences
 * that already exist with the conflict (if any) the Phase 2A engine finds
 * among them.
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

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `calendar-conflict-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string): Promise<Response> {
  return fetch(apiUrl(path), {
    headers: { "x-api-key": "test-api-secret-key", "x-admin-token": adminToken() },
  });
}

type CalendarOccurrence = {
  scheduleId: number;
  source: "class" | "ballet";
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  classTitle: string;
  conflict: { scheduleId: number; source: string; classTitle: string; startTime: string; endTime: string; branchName: string | null; roomName: string | null } | null;
};

async function insertBranchAndRoom(run: string, label: string): Promise<{ branchId: number; roomId: number }> {
  const branch = await pool.query(`INSERT INTO studio_branches (name) VALUES ($1) RETURNING id`, [`Calendar Conflict Branch ${run} ${label}`]);
  const branchId = branch.rows[0].id as number;
  const room = await pool.query(`INSERT INTO studio_rooms (branch_id, name) VALUES ($1, $2) RETURNING id`, [branchId, `Calendar Conflict Room ${run} ${label}`]);
  return { branchId, roomId: room.rows[0].id as number };
}

async function insertRegularClass(run: string, label: string): Promise<number> {
  const res = await pool.query(`INSERT INTO classes (title, category, duration_mins) VALUES ($1, 'Hip Hop', 60) RETURNING id`, [`Calendar Conflict Regular ${run} ${label}`]);
  return res.rows[0].id as number;
}

async function insertRegularSchedule(classId: number, branchId: number, roomId: number, opts: { dayOfWeek: number; startTime: string; endTime: string; status?: string }): Promise<number> {
  const res = await pool.query(
    `INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES ($1, $2, $3, 'weekly', $4, $5, $6, $7, true) RETURNING id`,
    [classId, branchId, roomId, opts.status ?? "active", opts.dayOfWeek, opts.startTime, opts.endTime],
  );
  return res.rows[0].id as number;
}

async function insertCanonicalBalletClass(run: string, label: string): Promise<number> {
  const level = await pool.query(`INSERT INTO ballet_levels (name, sort_order, is_active) VALUES ($1, 990, true) RETURNING id`, [`Calendar Conflict Level ${run} ${label}`]);
  const levelId = level.rows[0].id as number;
  const group = await pool.query(`INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Calendar Conflict Group ${run} ${label}`, levelId]);
  const groupId = group.rows[0].id as number;
  const instructor = await pool.query(`INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`, [`Calendar Conflict Instructor ${run} ${label}`]);
  const instructorId = instructor.rows[0].id as number;
  const balletClass = await pool.query(
    `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active) VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
    [`Calendar Conflict Ballet Class ${run} ${label}`, levelId, groupId, instructorId],
  );
  return balletClass.rows[0].id as number;
}

async function insertBalletSchedule(classId: number, branchId: number, roomId: number, opts: { dayOfWeek: number; startTime: string; endTime: string; status?: string }): Promise<number> {
  const [sh, sm] = opts.startTime.split(":").map(Number);
  const [eh, em] = opts.endTime.split(":").map(Number);
  const res = await pool.query(
    `INSERT INTO ballet_schedules (class_id, branch_id, room_id, day_of_week, start_time, end_time, duration_mins, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [classId, branchId, roomId, opts.dayOfWeek, opts.startTime, opts.endTime, (eh * 60 + em) - (sh * 60 + sm), opts.status ?? "active"],
  );
  return res.rows[0].id as number;
}

// A fixed future Monday, so weekly schedules project into the same window
// regardless of when this test runs.
const MONDAY = "2026-08-03";
const WEEK_FROM = "2026-08-02";
const WEEK_TO = "2026-08-08";

async function fetchCalendar(branchId?: number, roomId?: number): Promise<CalendarOccurrence[]> {
  const params = new URLSearchParams({ from: WEEK_FROM, to: WEEK_TO });
  if (branchId != null) params.set("branchId", String(branchId));
  if (roomId != null) params.set("roomId", String(roomId));
  const res = await asAdmin(`/api/admin/calendar?${params.toString()}`);
  assert.equal(res.status, 200);
  return res.json() as Promise<CalendarOccurrence[]>;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const adminCalendarRouter = (await import("./adminCalendar.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", adminCalendarRouter);
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
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin) VALUES ($1, $2, 'x', 'Calendar Conflict Super', true) RETURNING id`,
      [`calendar-conflict-super-${run}`, `calendar-conflict-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("two overlapping regular schedules in the same room both carry a conflict pointing at each other", async () => {
  const run = `regular-vs-regular-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertRegularClass(run, "a");
  const classB = await insertRegularClass(run, "b");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertRegularSchedule(classA, branchId, roomId, { dayOfWeek: 1, startTime: "10:00", endTime: "11:00" });
  await insertRegularSchedule(classB, branchId, roomId, { dayOfWeek: 1, startTime: "10:30", endTime: "11:30" });

  const occurrences = await fetchCalendar(branchId, roomId);
  const monday = occurrences.filter((o) => o.occurrenceDate === MONDAY);
  assert.equal(monday.length, 2);
  for (const occurrence of monday) {
    assert.ok(occurrence.conflict, `occurrence for schedule ${occurrence.scheduleId} should carry a conflict`);
    assert.notEqual(occurrence.conflict!.scheduleId, occurrence.scheduleId, "must point at the OTHER schedule, not itself");
    assert.equal(occurrence.conflict!.source, "class");
  }
  const [a, b] = monday;
  assert.equal(a.conflict!.scheduleId, b.scheduleId);
  assert.equal(b.conflict!.scheduleId, a.scheduleId);
  assert.equal(a.conflict!.classTitle, b.classTitle);
  assert.ok(a.conflict!.branchName?.includes("Calendar Conflict Branch"));
  assert.ok(a.conflict!.roomName?.includes("Calendar Conflict Room"));
});

test("a regular schedule overlapping a Ballet schedule in the same room shows a cross-source conflict", async () => {
  const run = `regular-vs-ballet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const regularClassId = await insertRegularClass(run, "a");
  const balletClassId = await insertCanonicalBalletClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertRegularSchedule(regularClassId, branchId, roomId, { dayOfWeek: 2, startTime: "14:00", endTime: "15:00" });
  await insertBalletSchedule(balletClassId, branchId, roomId, { dayOfWeek: 2, startTime: "14:30", endTime: "15:30" });

  const occurrences = await fetchCalendar(branchId, roomId);
  const regularOccurrence = occurrences.find((o) => o.source === "class");
  const balletOccurrence = occurrences.find((o) => o.source === "ballet");
  assert.ok(regularOccurrence?.conflict, "regular occurrence should carry a conflict");
  assert.ok(balletOccurrence?.conflict, "ballet occurrence should carry a conflict");
  assert.equal(regularOccurrence!.conflict!.source, "ballet");
  assert.equal(balletOccurrence!.conflict!.source, "class");
});

test("non-overlapping schedules in the same room carry no conflict", async () => {
  const run = `no-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertRegularClass(run, "a");
  const classB = await insertRegularClass(run, "b");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertRegularSchedule(classA, branchId, roomId, { dayOfWeek: 3, startTime: "09:00", endTime: "10:00" });
  await insertRegularSchedule(classB, branchId, roomId, { dayOfWeek: 3, startTime: "10:00", endTime: "11:00" });

  const occurrences = await fetchCalendar(branchId, roomId);
  const wednesday = occurrences.filter((o) => o.occurrenceDate === "2026-08-05");
  assert.equal(wednesday.length, 2);
  for (const occurrence of wednesday) assert.equal(occurrence.conflict, null);
});

test("overlapping schedules in different rooms carry no conflict", async () => {
  const run = `different-room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertRegularClass(run, "a");
  const classB = await insertRegularClass(run, "b");
  const roomA = await insertBranchAndRoom(run, "a");
  const roomB = await insertBranchAndRoom(run, "b");
  await insertRegularSchedule(classA, roomA.branchId, roomA.roomId, { dayOfWeek: 4, startTime: "16:00", endTime: "17:00" });
  await insertRegularSchedule(classB, roomB.branchId, roomB.roomId, { dayOfWeek: 4, startTime: "16:00", endTime: "17:00" });

  const occurrencesA = await fetchCalendar(roomA.branchId, roomA.roomId);
  const occurrencesB = await fetchCalendar(roomB.branchId, roomB.roomId);
  assert.equal(occurrencesA.find((o) => o.occurrenceDate === "2026-08-06")?.conflict, null);
  assert.equal(occurrencesB.find((o) => o.occurrenceDate === "2026-08-06")?.conflict, null);
});

test("a cancelled schedule never appears as a conflict source", async () => {
  const run = `cancelled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertRegularClass(run, "a");
  const classB = await insertRegularClass(run, "b");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertRegularSchedule(classA, branchId, roomId, { dayOfWeek: 5, startTime: "12:00", endTime: "13:00", status: "cancelled" });
  await insertRegularSchedule(classB, branchId, roomId, { dayOfWeek: 5, startTime: "12:00", endTime: "13:00" });

  const occurrences = await fetchCalendar(branchId, roomId);
  const friday = occurrences.filter((o) => o.occurrenceDate === "2026-08-07");
  // The cancelled schedule was never projected at all — only the active one appears, with no conflict.
  assert.equal(friday.length, 1);
  assert.equal(friday[0].conflict, null);
});
