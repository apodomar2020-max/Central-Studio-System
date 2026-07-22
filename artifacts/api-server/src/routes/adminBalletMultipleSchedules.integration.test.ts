/**
 * Real-route integration coverage for the Ballet multiple-schedule workflow.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values. This file
 * boots the actual Express routers and uses real admin auth middleware; it
 * never calls route helpers directly.
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
  return jwtSign({ sub: superAdminId, username: `multi-schedule-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function insertCanonicalBalletClass(run: string, suffix: string): Promise<{
  levelId: number;
  groupId: number;
  instructorId: number;
  classId: number;
}> {
  const level = await pool.query(
    `INSERT INTO ballet_levels (name, sort_order, is_active) VALUES ($1, 990, true) RETURNING id`,
    [`Multi Schedule Level ${run} ${suffix}`],
  );
  const levelId = level.rows[0].id as number;
  const group = await pool.query(
    `INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`,
    [`Multi Schedule Group ${run} ${suffix}`, levelId],
  );
  const groupId = group.rows[0].id as number;
  const instructor = await pool.query(
    `INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`,
    [`Multi Schedule Instructor ${run} ${suffix}`],
  );
  const instructorId = instructor.rows[0].id as number;
  const balletClass = await pool.query(
    `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active)
     VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
    [`Multi Schedule Class ${run} ${suffix}`, levelId, groupId, instructorId],
  );
  return { levelId, groupId, instructorId, classId: balletClass.rows[0].id as number };
}

async function insertActiveApplicationAndAssignment(run: string, levelId: number, groupId: number): Promise<{
  applicationId: number;
  assignmentId: number;
}> {
  const application = await pool.query(
    `INSERT INTO ballet_applications
       (parent_name, parent_phone, parent_email, child_name, status, assigned_level_id)
     VALUES ($1, '0100000000', $2, $3, 'active', $4)
     RETURNING id`,
    [`Parent ${run}`, `parent-${run}@example.com`, `Child ${run}`, levelId],
  );
  const applicationId = application.rows[0].id as number;
  const assignment = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, group_id, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [applicationId, levelId, groupId],
  );
  return { applicationId, assignmentId: assignment.rows[0].id as number };
}

async function insertSchedule(classId: number, dayOfWeek: number, startTime: string, endTime: string, status = "active"): Promise<number> {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const durationMins = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  const schedule = await pool.query(
    `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [classId, dayOfWeek, startTime, endTime, durationMins, status],
  );
  return schedule.rows[0].id as number;
}

async function countMatchingSchedules(classId: number, dayOfWeek: number, startTime: string, endTime: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
     FROM ballet_schedules
     WHERE class_id = $1 AND day_of_week = $2 AND start_time = $3 AND end_time = $4`,
    [classId, dayOfWeek, startTime, endTime],
  );
  return rows[0].n as number;
}

async function postSchedule(body: { classId: number; dayOfWeek: number; startTime: string; endTime: string; status?: string }): Promise<Response> {
  return asAdmin("/api/admin/ballet/schedules", { method: "POST", body: JSON.stringify({ status: "active", ...body }) });
}

async function patchSchedule(id: number, body: { dayOfWeek?: number; startTime?: string; endTime?: string; status?: string }): Promise<Response> {
  return asAdmin(`/api/admin/ballet/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function postAttendance(body: { levelAssignmentId: number; balletScheduleId: number; classDate: string; status?: string }): Promise<Response> {
  return asAdmin("/api/admin/ballet/attendance", {
    method: "POST",
    body: JSON.stringify({ status: "checked_in", ...body }),
  });
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const adminBalletRouter = (await import("./adminBallet.ts")).default;
  const adminBalletSchedulesRouter = (await import("./adminBalletSchedules.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", adminBalletSchedulesRouter);
  app.use("/api", adminBalletRouter);
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
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Multi Schedule Super', true) RETURNING id`,
      [`multi-schedule-super-${run}`, `multi-schedule-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("concurrent identical Ballet Schedule creation allows one insert and rejects one exact duplicate", async () => {
  const run = `duplicate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { classId } = await insertCanonicalBalletClass(run, "same-slot");
  const body = { classId, dayOfWeek: 2, startTime: "16:00", endTime: "17:00" };

  const responses = await Promise.all([postSchedule(body), postSchedule(body)]);
  const statuses = responses.map((res) => res.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409]);

  const conflict = responses.find((res) => res.status === 409);
  assert.ok(conflict, "one request must fail as an exact duplicate");
  assert.equal((await jsonBody(conflict)).code, "DUPLICATE_BALLET_SCHEDULE_SLOT");

  assert.equal(await countMatchingSchedules(classId, body.dayOfWeek, body.startTime, body.endTime), 1);
});

test("concurrent different Ballet Schedule slots for the same Class both succeed", async () => {
  const run = `different-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { classId } = await insertCanonicalBalletClass(run, "different-slots");

  const first = { classId, dayOfWeek: 1, startTime: "15:00", endTime: "16:00" };
  const second = { classId, dayOfWeek: 3, startTime: "18:00", endTime: "19:00" };
  const responses = await Promise.all([postSchedule(first), postSchedule(second)]);

  assert.deepEqual(responses.map((res) => res.status).sort((a, b) => a - b), [201, 201]);
  assert.equal(await countMatchingSchedules(classId, first.dayOfWeek, first.startTime, first.endTime), 1);
  assert.equal(await countMatchingSchedules(classId, second.dayOfWeek, second.startTime, second.endTime), 1);
});

test("Ballet attendance records the exact schedule id when one Class has multiple active schedules", async () => {
  const run = `attendance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { levelId, groupId, classId } = await insertCanonicalBalletClass(run, "attendance");
  const { assignmentId } = await insertActiveApplicationAndAssignment(run, levelId, groupId);
  const scheduleA = await insertSchedule(classId, 1, "16:00", "17:00");
  const scheduleB = await insertSchedule(classId, 3, "18:00", "19:00");

  const firstDate = "2026-07-06";
  const secondDate = "2026-07-08";
  const first = await postAttendance({ levelAssignmentId: assignmentId, balletScheduleId: scheduleA, classDate: firstDate });
  const second = await postAttendance({ levelAssignmentId: assignmentId, balletScheduleId: scheduleB, classDate: secondDate });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const rows = await pool.query(
    `SELECT ballet_schedule_id, class_date::text AS class_date, ballet_class_id
     FROM attendance
     WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id IN ($2, $3)
     ORDER BY class_date`,
    [assignmentId, scheduleA, scheduleB],
  );
  assert.deepEqual(
    rows.rows.map((row) => ({ scheduleId: row.ballet_schedule_id, classDate: row.class_date, classId: row.ballet_class_id })),
    [
      { scheduleId: scheduleA, classDate: firstDate, classId },
      { scheduleId: scheduleB, classDate: secondDate, classId },
    ],
  );
});

test("cancelled sibling schedule is rejected while the still-active sibling remains attendable", async () => {
  const run = `cancelled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { levelId, groupId, classId } = await insertCanonicalBalletClass(run, "cancelled-sibling");
  const { assignmentId } = await insertActiveApplicationAndAssignment(run, levelId, groupId);
  const scheduleA = await insertSchedule(classId, 1, "09:00", "10:00");
  const scheduleB = await insertSchedule(classId, 4, "11:00", "12:00", "cancelled");

  const rejected = await postAttendance({ levelAssignmentId: assignmentId, balletScheduleId: scheduleB, classDate: "2026-07-09" });
  assert.equal(rejected.status, 422);
  assert.equal(
    (await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE ballet_schedule_id = $1`, [scheduleB])).rows[0].n,
    0,
  );

  const accepted = await postAttendance({ levelAssignmentId: assignmentId, balletScheduleId: scheduleA, classDate: "2026-07-07" });
  assert.equal(accepted.status, 201);
  assert.equal(
    (await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE ballet_schedule_id = $1`, [scheduleA])).rows[0].n,
    1,
  );
});

test("attendance rejects a schedule from another Class/Group and inserts no row", async () => {
  const run = `wrong-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const own = await insertCanonicalBalletClass(run, "own");
  const other = await insertCanonicalBalletClass(run, "other");
  const { assignmentId } = await insertActiveApplicationAndAssignment(run, own.levelId, own.groupId);
  const otherSchedule = await insertSchedule(other.classId, 2, "12:00", "13:00");

  const res = await postAttendance({ levelAssignmentId: assignmentId, balletScheduleId: otherSchedule, classDate: "2026-07-08" });
  assert.equal(res.status, 422);
  assert.equal(
    (await pool.query(
      `SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2`,
      [assignmentId, otherSchedule],
    )).rows[0].n,
    0,
  );
});

test("historical attendance stays linked to Schedule A after editing and cancelling Schedule B", async () => {
  const run = `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { levelId, groupId, classId } = await insertCanonicalBalletClass(run, "history");
  const { assignmentId } = await insertActiveApplicationAndAssignment(run, levelId, groupId);
  const scheduleA = await insertSchedule(classId, 1, "14:00", "15:00");
  const scheduleB = await insertSchedule(classId, 5, "16:00", "17:00");

  const attended = await postAttendance({ levelAssignmentId: assignmentId, balletScheduleId: scheduleA, classDate: "2026-07-06" });
  assert.equal(attended.status, 201);

  await pool.query(
    `UPDATE ballet_schedules SET start_time = '17:00', end_time = '18:00', duration_mins = 60, status = 'cancelled' WHERE id = $1`,
    [scheduleB],
  );

  const rows = await pool.query(
    `SELECT ballet_schedule_id, ballet_class_id, class_date::text AS class_date
     FROM attendance
     WHERE ballet_level_assignment_id = $1
     ORDER BY id`,
    [assignmentId],
  );
  assert.deepEqual(rows.rows, [{ ballet_schedule_id: scheduleA, ballet_class_id: classId, class_date: "2026-07-06" }]);
});

// ─── Regression: PATCH must enforce the same duplicate-slot rule as POST ──────
//
// Confirmed Production-like defect: PATCH /admin/ballet/schedules/:id applied
// day/time changes with no duplicate check at all. Editing a sibling Schedule
// into an already-occupied classId+dayOfWeek+startTime+endTime slot silently
// succeeded (200), producing two visually-identical rows for the same Class —
// same Level/Group/Instructor (guaranteed, since it is literally one Class),
// same Day, same Time, same Status — exactly the symptom observed in Admin.

test("editing a sibling Schedule into an existing Schedule's exact slot is rejected with 409 DUPLICATE_BALLET_SCHEDULE_SLOT", async () => {
  const run = `edit-collision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { classId } = await insertCanonicalBalletClass(run, "edit-collision");

  const a = await postSchedule({ classId, dayOfWeek: 0, startTime: "16:00", endTime: "17:00" });
  const b = await postSchedule({ classId, dayOfWeek: 2, startTime: "09:00", endTime: "10:00" });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const bId = ((await jsonBody(b)).schedule as { id: number }).id;

  const collide = await patchSchedule(bId, { dayOfWeek: 0, startTime: "16:00", endTime: "17:00" });
  assert.equal(collide.status, 409);
  assert.equal((await jsonBody(collide)).code, "DUPLICATE_BALLET_SCHEDULE_SLOT");

  // The sibling must be untouched (still at its original day/time) and no
  // second row must exist in A's slot.
  assert.equal(await countMatchingSchedules(classId, 0, "16:00", "17:00"), 1);
  assert.equal(await countMatchingSchedules(classId, 2, "09:00", "10:00"), 1);
});

test("editing a Schedule while keeping its own day/time unchanged still succeeds", async () => {
  const run = `edit-self-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { classId } = await insertCanonicalBalletClass(run, "edit-self");
  const created = await postSchedule({ classId, dayOfWeek: 4, startTime: "11:00", endTime: "12:00" });
  const id = ((await jsonBody(created)).schedule as { id: number }).id;

  const sameSlot = await patchSchedule(id, { dayOfWeek: 4, startTime: "11:00", endTime: "12:00", status: "active" });
  assert.equal(sameSlot.status, 200);

  const statusOnly = await patchSchedule(id, { status: "deactivated" });
  assert.equal(statusOnly.status, 200);
  assert.equal(await countMatchingSchedules(classId, 4, "11:00", "12:00"), 1);
});

test("duplicate detection trims whitespace so equivalent time strings collide, and stores the canonical trimmed value", async () => {
  const run = `whitespace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { classId } = await insertCanonicalBalletClass(run, "whitespace");

  const first = await postSchedule({ classId, dayOfWeek: 1, startTime: " 16:00", endTime: "17:00 " } as unknown as { classId: number; dayOfWeek: number; startTime: string; endTime: string });
  assert.equal(first.status, 201);
  const stored = ((await jsonBody(first)).schedule as { startTime: string; endTime: string });
  assert.equal(stored.startTime, "16:00");
  assert.equal(stored.endTime, "17:00");

  const duplicate = await postSchedule({ classId, dayOfWeek: 1, startTime: "16:00", endTime: "17:00" });
  assert.equal(duplicate.status, 409);
  assert.equal(await countMatchingSchedules(classId, 1, "16:00", "17:00"), 1);
});

test("two different Classes sharing an identical title may each be scheduled at the same day/time independently (not a duplicate — different classId)", async () => {
  const run = `same-title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const shared = await insertCanonicalBalletClass(run, "shared-a");
  const other = await insertCanonicalBalletClass(run, "shared-b");

  const r1 = await postSchedule({ classId: shared.classId, dayOfWeek: 5, startTime: "13:00", endTime: "14:00" });
  const r2 = await postSchedule({ classId: other.classId, dayOfWeek: 5, startTime: "13:00", endTime: "14:00" });
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(await countMatchingSchedules(shared.classId, 5, "13:00", "14:00"), 1);
  assert.equal(await countMatchingSchedules(other.classId, 5, "13:00", "14:00"), 1);
});
