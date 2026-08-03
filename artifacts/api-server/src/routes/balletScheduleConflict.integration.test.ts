/**
 * Real-route integration coverage for Phase 2C — the schedule conflict
 * engine wired into Ballet schedule creation/update
 * (routes/adminBalletSchedules.ts). Regular Studio schedule routes are not
 * mounted/exercised here beyond direct fixture inserts.
 *
 * Note: unlike adminBalletMultipleSchedules.integration.test.ts, every
 * postSchedule() call here includes branchId/roomId — CreateScheduleBody
 * requires both, and POSTs that omit them return 400 VALIDATION_ERROR.
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
  return jwtSign({ sub: superAdminId, username: `ballet-conflict-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

async function insertBranchAndRoom(run: string, label: string): Promise<{ branchId: number; roomId: number }> {
  const branch = await pool.query(
    `INSERT INTO studio_branches (name) VALUES ($1) RETURNING id`,
    [`Ballet Conflict Branch ${run} ${label}`],
  );
  const branchId = branch.rows[0].id as number;
  const room = await pool.query(
    `INSERT INTO studio_rooms (branch_id, name) VALUES ($1, $2) RETURNING id`,
    [branchId, `Ballet Conflict Room ${run} ${label}`],
  );
  return { branchId, roomId: room.rows[0].id as number };
}

async function insertCanonicalBalletClass(run: string, label: string): Promise<number> {
  const level = await pool.query(
    `INSERT INTO ballet_levels (name, sort_order, is_active) VALUES ($1, 990, true) RETURNING id`,
    [`Ballet Conflict Level ${run} ${label}`],
  );
  const levelId = level.rows[0].id as number;
  const group = await pool.query(
    `INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`,
    [`Ballet Conflict Group ${run} ${label}`, levelId],
  );
  const groupId = group.rows[0].id as number;
  const instructor = await pool.query(
    `INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`,
    [`Ballet Conflict Instructor ${run} ${label}`],
  );
  const instructorId = instructor.rows[0].id as number;
  const balletClass = await pool.query(
    `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active)
     VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
    [`Ballet Conflict Class ${run} ${label}`, levelId, groupId, instructorId],
  );
  return balletClass.rows[0].id as number;
}

async function insertRegularClass(run: string, label: string): Promise<number> {
  const res = await pool.query(
    `INSERT INTO classes (title, category, duration_mins) VALUES ($1, 'Hip Hop', 60) RETURNING id`,
    [`Ballet Conflict Regular Class ${run} ${label}`],
  );
  return res.rows[0].id as number;
}

async function insertRegularSchedule(
  classId: number, branchId: number, roomId: number,
  opts: { dayOfWeek?: number; date?: string; type?: "weekly" | "one_time"; startTime: string; endTime: string; status?: string },
): Promise<number> {
  const type = opts.type ?? "weekly";
  const status = opts.status ?? "active";
  const res = await pool.query(
    `INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, date, start_time, end_time, is_recurring)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [classId, branchId, roomId, type, status, opts.dayOfWeek ?? null, opts.date ?? null, opts.startTime, opts.endTime, type === "weekly"],
  );
  return res.rows[0].id as number;
}

async function insertBalletSchedule(
  classId: number, branchId: number, roomId: number,
  opts: { dayOfWeek: number; startTime: string; endTime: string; status?: string },
): Promise<number> {
  const [startHour, startMinute] = opts.startTime.split(":").map(Number);
  const [endHour, endMinute] = opts.endTime.split(":").map(Number);
  const durationMins = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  const res = await pool.query(
    `INSERT INTO ballet_schedules (class_id, branch_id, room_id, day_of_week, start_time, end_time, duration_mins, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [classId, branchId, roomId, opts.dayOfWeek, opts.startTime, opts.endTime, durationMins, opts.status ?? "active"],
  );
  return res.rows[0].id as number;
}

async function postSchedule(body: Record<string, unknown>): Promise<Response> {
  return asAdmin("/api/admin/ballet/schedules", { method: "POST", body: JSON.stringify({ status: "active", ...body }) });
}

async function patchSchedule(id: number, body: Record<string, unknown>): Promise<Response> {
  return asAdmin(`/api/admin/ballet/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function countBalletSchedules(branchId: number, roomId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM ballet_schedules WHERE branch_id = $1 AND room_id = $2`,
    [branchId, roomId],
  );
  return rows[0].n as number;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const adminBalletSchedulesRouter = (await import("./adminBalletSchedules.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", adminBalletSchedulesRouter);
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
       VALUES ($1, $2, 'x', 'Ballet Conflict Super', true) RETURNING id`,
      [`ballet-conflict-super-${run}`, `ballet-conflict-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── Create flow ────────────────────────────────────────────────────────────

test("a Ballet schedule conflicting with another Ballet schedule in the same room is blocked with 409 SCHEDULE_TIME_CONFLICT", async () => {
  const run = `ballet-vs-ballet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertCanonicalBalletClass(run, "a");
  const classB = await insertCanonicalBalletClass(run, "b");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertBalletSchedule(classA, branchId, roomId, { dayOfWeek: 1, startTime: "10:00", endTime: "11:00" });

  const res = await postSchedule({
    classId: classB, branchId, roomId,
    dayOfWeek: 1, startTime: "10:30", endTime: "11:30",
  });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.code, "SCHEDULE_TIME_CONFLICT");
  assert.ok(body.conflict, "response should include conflicting schedule information");
  assert.equal(await countBalletSchedules(branchId, roomId), 1, "the conflicting request must not have been inserted");
});

test("a Ballet schedule conflicting with a regular Studio schedule in the same room is blocked with 409 SCHEDULE_TIME_CONFLICT", async () => {
  const run = `ballet-vs-regular-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const balletClassId = await insertCanonicalBalletClass(run, "a");
  const regularClassId = await insertRegularClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertRegularSchedule(regularClassId, branchId, roomId, { dayOfWeek: 2, startTime: "14:00", endTime: "15:00" });

  const res = await postSchedule({
    classId: balletClassId, branchId, roomId,
    dayOfWeek: 2, startTime: "14:30", endTime: "15:30",
  });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.code, "SCHEDULE_TIME_CONFLICT");
  const conflict = body.conflict as { source: string };
  assert.equal(conflict.source, "class");
});

test("Ballet schedule creation in a different room is allowed even at the exact same time", async () => {
  const run = `different-room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertCanonicalBalletClass(run, "a");
  const classB = await insertCanonicalBalletClass(run, "b");
  const roomA = await insertBranchAndRoom(run, "a");
  const roomB = await insertBranchAndRoom(run, "b");
  await insertBalletSchedule(classA, roomA.branchId, roomA.roomId, { dayOfWeek: 3, startTime: "12:00", endTime: "13:00" });

  const res = await postSchedule({
    classId: classB, branchId: roomB.branchId, roomId: roomB.roomId,
    dayOfWeek: 3, startTime: "12:00", endTime: "13:00",
  });

  assert.equal(res.status, 201);
  assert.equal(await countBalletSchedules(roomB.branchId, roomB.roomId), 1);
});

test("a cancelled Ballet schedule does not block a new Ballet schedule in its same room/day/time", async () => {
  const run = `cancelled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertCanonicalBalletClass(run, "a");
  const classB = await insertCanonicalBalletClass(run, "b");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertBalletSchedule(classA, branchId, roomId, { dayOfWeek: 4, startTime: "09:00", endTime: "10:00", status: "cancelled" });

  const res = await postSchedule({
    classId: classB, branchId, roomId,
    dayOfWeek: 4, startTime: "09:00", endTime: "10:00",
  });

  assert.equal(res.status, 201);
  assert.equal(await countBalletSchedules(branchId, roomId), 2);
});

// ─── Update flow ────────────────────────────────────────────────────────────

test("updating a Ballet schedule into an occupied room/time is blocked with 409, and the row is left unchanged", async () => {
  const run = `update-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classA = await insertCanonicalBalletClass(run, "a");
  const classB = await insertCanonicalBalletClass(run, "b");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertBalletSchedule(classA, branchId, roomId, { dayOfWeek: 5, startTime: "16:00", endTime: "17:00" });
  const movingId = await insertBalletSchedule(classB, branchId, roomId, { dayOfWeek: 6, startTime: "09:00", endTime: "10:00" });

  const res = await patchSchedule(movingId, { dayOfWeek: 5, startTime: "16:30", endTime: "17:30" });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.code, "SCHEDULE_TIME_CONFLICT");
  assert.ok(body.conflict);

  const untouched = await pool.query(`SELECT day_of_week, start_time, end_time FROM ballet_schedules WHERE id = $1`, [movingId]);
  assert.deepEqual(untouched.rows[0], { day_of_week: 6, start_time: "09:00", end_time: "10:00" });
});

test("updating a Ballet schedule without introducing a room conflict succeeds", async () => {
  const run = `update-ok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertCanonicalBalletClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertBalletSchedule(classId, branchId, roomId, { dayOfWeek: 0, startTime: "14:00", endTime: "15:00" });

  const res = await patchSchedule(scheduleId, { startTime: "15:00", endTime: "16:00" });

  assert.equal(res.status, 200);
  const updated = await pool.query(`SELECT start_time, end_time FROM ballet_schedules WHERE id = $1`, [scheduleId]);
  assert.deepEqual(updated.rows[0], { start_time: "15:00", end_time: "16:00" });
});

// ─── Existing per-class validation must be untouched ───────────────────────

test("existing Ballet duplicate-slot validation (DUPLICATE_BALLET_SCHEDULE_SLOT) still fires, unaffected by the new room check", async () => {
  const run = `duplicate-still-works-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertCanonicalBalletClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const body = { classId, branchId, roomId, dayOfWeek: 1, startTime: "18:00", endTime: "19:00" };

  const first = await postSchedule(body);
  assert.equal(first.status, 201);

  const duplicate = await postSchedule(body);
  assert.equal(duplicate.status, 409);
  assert.equal((await jsonBody(duplicate)).code, "DUPLICATE_BALLET_SCHEDULE_SLOT");
  assert.equal(await countBalletSchedules(branchId, roomId), 1);
});

test("existing Ballet per-class overlap validation (BALLET_SCHEDULE_TIME_CONFLICT) still fires for the same class, unaffected by the new room check", async () => {
  const run = `class-overlap-still-works-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertCanonicalBalletClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const first = await postSchedule({ classId, branchId, roomId, dayOfWeek: 2, startTime: "10:00", endTime: "11:00" });
  assert.equal(first.status, 201);

  // Different room, but the SAME class overlapping on the same day — the
  // existing per-class check must still catch this even though the new
  // room-level check would not (different room).
  const otherRoom = await insertBranchAndRoom(run, "b");
  const overlap = await postSchedule({ classId, branchId: otherRoom.branchId, roomId: otherRoom.roomId, dayOfWeek: 2, startTime: "10:30", endTime: "11:30" });
  assert.equal(overlap.status, 409);
  assert.equal((await jsonBody(overlap)).code, "BALLET_SCHEDULE_TIME_CONFLICT");
});
