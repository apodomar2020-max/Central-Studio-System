/**
 * Real-route integration coverage for Phase 2B — the schedule conflict
 * engine wired into the regular Studio schedule create/update flow
 * (routes/schedules.ts). Ballet is untouched in this phase.
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
  return jwtSign({ sub: superAdminId, username: `conflict-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

async function insertClass(run: string, label: string): Promise<number> {
  const res = await pool.query(
    `INSERT INTO classes (title, category, duration_mins) VALUES ($1, 'Hip Hop', 60) RETURNING id`,
    [`Conflict Test Class ${run} ${label}`],
  );
  return res.rows[0].id as number;
}

async function insertBranchAndRoom(run: string, label: string): Promise<{ branchId: number; roomId: number }> {
  const branch = await pool.query(
    `INSERT INTO studio_branches (name) VALUES ($1) RETURNING id`,
    [`Conflict Branch ${run} ${label}`],
  );
  const branchId = branch.rows[0].id as number;
  const room = await pool.query(
    `INSERT INTO studio_rooms (branch_id, name) VALUES ($1, $2) RETURNING id`,
    [branchId, `Conflict Room ${run} ${label}`],
  );
  return { branchId, roomId: room.rows[0].id as number };
}

async function insertSchedule(
  classId: number,
  branchId: number,
  roomId: number,
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

async function postSchedule(body: Record<string, unknown>): Promise<Response> {
  return asAdmin("/api/schedules", { method: "POST", body: JSON.stringify(body) });
}

async function patchSchedule(id: number, body: Record<string, unknown>): Promise<Response> {
  return asAdmin(`/api/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function countSchedules(branchId: number, roomId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM schedules WHERE branch_id = $1 AND room_id = $2`,
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
  const schedulesRouter = (await import("./schedules.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", schedulesRouter);
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
       VALUES ($1, $2, 'x', 'Conflict Test Super', true) RETURNING id`,
      [`conflict-super-${run}`, `conflict-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── Create flow ────────────────────────────────────────────────────────────

test("creating a schedule that conflicts with another active schedule is blocked with 409 SCHEDULE_TIME_CONFLICT", async () => {
  const run = `create-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertSchedule(classId, branchId, roomId, { dayOfWeek: 1, startTime: "10:00", endTime: "11:00" });

  const res = await postSchedule({
    classId, branchId, roomId,
    type: "weekly", dayOfWeek: 1, startTime: "10:30", endTime: "11:30",
  });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.code, "SCHEDULE_TIME_CONFLICT");
  assert.ok(body.conflict, "response should include conflicting schedule information");
  assert.equal(await countSchedules(branchId, roomId), 1, "the conflicting request must not have been inserted");
});

test("creating a schedule in a different room is allowed even at the exact same time", async () => {
  const run = `different-room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertClass(run, "a");
  const roomA = await insertBranchAndRoom(run, "a");
  const roomB = await insertBranchAndRoom(run, "b");
  await insertSchedule(classId, roomA.branchId, roomA.roomId, { dayOfWeek: 2, startTime: "12:00", endTime: "13:00" });

  const res = await postSchedule({
    classId, branchId: roomB.branchId, roomId: roomB.roomId,
    type: "weekly", dayOfWeek: 2, startTime: "12:00", endTime: "13:00",
  });

  assert.equal(res.status, 201);
  assert.equal(await countSchedules(roomB.branchId, roomB.roomId), 1);
});

test("a cancelled schedule does not block a new schedule in its same room/day/time", async () => {
  const run = `cancelled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertSchedule(classId, branchId, roomId, { dayOfWeek: 3, startTime: "09:00", endTime: "10:00", status: "cancelled" });

  const res = await postSchedule({
    classId, branchId, roomId,
    type: "weekly", dayOfWeek: 3, startTime: "09:00", endTime: "10:00",
  });

  assert.equal(res.status, 201);
  assert.equal(await countSchedules(branchId, roomId), 2);
});

// ─── Update flow ────────────────────────────────────────────────────────────

test("updating a schedule into an occupied room/time is blocked with 409, and the row is left unchanged", async () => {
  const run = `update-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertSchedule(classId, branchId, roomId, { dayOfWeek: 4, startTime: "16:00", endTime: "17:00" });
  const movingId = await insertSchedule(classId, branchId, roomId, { dayOfWeek: 5, startTime: "09:00", endTime: "10:00" });

  const res = await patchSchedule(movingId, { dayOfWeek: 4, startTime: "16:30", endTime: "17:30" });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.code, "SCHEDULE_TIME_CONFLICT");
  assert.ok(body.conflict);

  const untouched = await pool.query(`SELECT day_of_week, start_time, end_time FROM schedules WHERE id = $1`, [movingId]);
  assert.deepEqual(untouched.rows[0], { day_of_week: 5, start_time: "09:00", end_time: "10:00" });
});

test("updating a schedule without introducing a conflict succeeds", async () => {
  const run = `update-ok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertSchedule(classId, branchId, roomId, { dayOfWeek: 6, startTime: "14:00", endTime: "15:00" });

  const res = await patchSchedule(scheduleId, { startTime: "15:00", endTime: "16:00" });

  assert.equal(res.status, 200);
  const updated = await pool.query(`SELECT start_time, end_time FROM schedules WHERE id = $1`, [scheduleId]);
  assert.deepEqual(updated.rows[0], { start_time: "15:00", end_time: "16:00" });
});

test("updating a schedule that keeps its own slot unchanged still succeeds (self-exclusion)", async () => {
  const run = `update-self-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  const scheduleId = await insertSchedule(classId, branchId, roomId, { dayOfWeek: 0, startTime: "11:00", endTime: "12:00" });

  const res = await patchSchedule(scheduleId, { dayOfWeek: 0, startTime: "11:00", endTime: "12:00", priceEgp: 150 });

  assert.equal(res.status, 200);
});

test("moving one schedule into another schedule's room does not corrupt the room lock for a concurrent create", async () => {
  const run = `concurrent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const classId = await insertClass(run, "a");
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");
  await insertSchedule(classId, branchId, roomId, { dayOfWeek: 1, startTime: "08:00", endTime: "09:00" });

  const responses = await Promise.all([
    postSchedule({ classId, branchId, roomId, type: "weekly", dayOfWeek: 1, startTime: "08:30", endTime: "09:30" }),
    postSchedule({ classId, branchId, roomId, type: "weekly", dayOfWeek: 1, startTime: "08:15", endTime: "09:15" }),
  ]);

  // Both concurrent overlapping creates must be rejected — neither one is
  // allowed to slip past the other while the room lock is held.
  assert.deepEqual(responses.map((r) => r.status), [409, 409]);
  assert.equal(await countSchedules(branchId, roomId), 1);
});
