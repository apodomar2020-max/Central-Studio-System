/**
 * Real-route integration coverage for Phase 5A.1 —
 * Studio Room Reservations (/admin/room-reservations).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const DATABASE_URL = process.env.DISPOSABLE_ROUTES_DATABASE_URL
  ?? "postgresql://localhost:5432/central_studio_disposable_routes";

process.env.DATABASE_URL = DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let db: typeof import("@workspace/db").db;
let sql: typeof import("drizzle-orm").sql;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let port: number;
let superAdminId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function tokenFor(userId: number): string {
  return jwt.sign({ sub: userId, username: `res-user-${userId}`, isSuperAdmin: false, roleId: null }, ADMIN_JWT_SECRET);
}

async function requestAs(userId: number, method: string, path: string, body?: object): Promise<Response> {
  return fetch(apiUrl(path), {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": tokenFor(userId),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function requestAsSuperAdmin(method: string, path: string, body?: object): Promise<Response> {
  return requestAs(superAdminId, method, path, body);
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function insertRoleAndUser(run: string, label: string, permissions: Record<string, Record<string, boolean>>): Promise<number> {
  const role = await db.execute(
    sql`INSERT INTO roles (name, permissions) VALUES (${`Reservation Role ${run} ${label}`}, ${JSON.stringify(permissions)}::jsonb) RETURNING id`,
  );
  const roleId = role.rows[0].id as number;
  const user = await db.execute(
    sql`INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id)
     VALUES (${`res-user-${run}-${label}`}, ${`res-user-${run}-${label}@example.com`}, 'x', 'Reservation Test User', false, ${roleId}) RETURNING id`,
  );
  return user.rows[0].id as number;
}

async function insertBranchAndRoom(run: string, label: string): Promise<{ branchId: number; roomId: number; room2Id: number }> {
  const branch = await db.execute(
    sql`INSERT INTO studio_branches (name, address, is_active) VALUES (${`Branch ${run} ${label}`}, 'Address', true) RETURNING id`,
  );
  const branchId = branch.rows[0].id as number;

  const room = await db.execute(
    sql`INSERT INTO studio_rooms (branch_id, name, is_active) VALUES (${branchId}, ${`Room A ${run} ${label}`}, true) RETURNING id`,
  );
  const roomId = room.rows[0].id as number;

  const room2 = await db.execute(
    sql`INSERT INTO studio_rooms (branch_id, name, is_active) VALUES (${branchId}, ${`Room B ${run} ${label}`}, true) RETURNING id`,
  );
  const room2Id = room2.rows[0].id as number;

  return { branchId, roomId, room2Id };
}

before(async () => {
  const dbMod = await import("@workspace/db");
  const drizzleMod = await import("drizzle-orm");
  db = dbMod.db;
  sql = drizzleMod.sql;

  const expressMod = await import("express");

  const adminRes = await db.execute(
    sql`INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES (${`res-super-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}, ${`res-super-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`}, 'x', 'Reservation Super Admin', true) RETURNING id`,
  );
  superAdminId = adminRes.rows[0].id as number;

  const adminRoomReservationsRouter = (await import("./adminRoomReservations")).default;

  app = expressMod.default();
  app.use(expressMod.default.json());
  app.use("/api", adminRoomReservationsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("POST /admin/room-reservations — creates a valid room reservation", async () => {
  const run = `create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId } = await insertBranchAndRoom(run, "a");

  const res = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Private Rehearsal",
    reservationType: "rehearsal",
    branchId,
    roomId,
    date: "2026-09-01",
    startTime: "14:00",
    endTime: "16:00",
    description: "Team prep",
    organizerName: "Coach Alex",
  });

  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.title, "Private Rehearsal");
  assert.equal(body.reservationType, "rehearsal");
  assert.equal(body.branchId, branchId);
  assert.equal(body.roomId, roomId);
  assert.equal(body.status, "active");
  assert.equal(typeof body.id, "number");
});

test("POST /admin/room-reservations — detects conflict with regular schedule", async () => {
  const run = `reg-conf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId } = await insertBranchAndRoom(run, "b");

  // Insert active regular class
  const cls = await db.execute(
    sql`INSERT INTO classes (title, category, duration_mins, is_active) VALUES (${`Class ${run}`}, 'General', 60, true) RETURNING id`,
  );
  const classId = cls.rows[0].id as number;

  await db.execute(
    sql`INSERT INTO schedules (class_id, branch_id, room_id, type, status, date, start_time, end_time)
        VALUES (${classId}, ${branchId}, ${roomId}, 'one_time', 'active', '2026-09-02', '10:00', '11:30')`,
  );

  // Attempt overlapping reservation
  const res = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Private Rental",
    reservationType: "room_rental",
    branchId,
    roomId,
    date: "2026-09-02",
    startTime: "11:00",
    endTime: "12:00",
  });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "SCHEDULE_TIME_CONFLICT");
});

test("POST /admin/room-reservations — detects conflict with ballet schedule", async () => {
  const run = `ballet-conf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId } = await insertBranchAndRoom(run, "c");

  const bClass = await db.execute(
    sql`INSERT INTO ballet_classes (title, is_active) VALUES (${`Ballet ${run}`}, true) RETURNING id`,
  );
  const balletClassId = bClass.rows[0].id as number;

  // 2026-09-03 is a Thursday (dayOfWeek 4)
  await db.execute(
    sql`INSERT INTO ballet_schedules (class_id, branch_id, room_id, day_of_week, start_time, end_time, duration_mins, status)
        VALUES (${balletClassId}, ${branchId}, ${roomId}, 4, '15:00', '16:30', 90, 'active')`,
  );

  // Overlapping reservation on same Thursday date
  const res = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Workshop Block",
    reservationType: "workshop",
    branchId,
    roomId,
    date: "2026-09-03",
    startTime: "16:00",
    endTime: "17:00",
  });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "SCHEDULE_TIME_CONFLICT");
});

test("POST /admin/room-reservations — detects conflict with another reservation", async () => {
  const run = `res-conf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId } = await insertBranchAndRoom(run, "d");

  await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Existing Reservation",
    reservationType: "private_training",
    branchId,
    roomId,
    date: "2026-09-04",
    startTime: "10:00",
    endTime: "12:00",
  });

  // Overlapping reservation
  const res = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Second Reservation",
    reservationType: "room_rental",
    branchId,
    roomId,
    date: "2026-09-04",
    startTime: "11:30",
    endTime: "13:00",
  });

  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "SCHEDULE_TIME_CONFLICT");
});

test("POST /admin/room-reservations — allows different room or non-overlapping time", async () => {
  const run = `diff-room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId, room2Id } = await insertBranchAndRoom(run, "e");

  await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Room 1 Reservation",
    reservationType: "private_training",
    branchId,
    roomId,
    date: "2026-09-05",
    startTime: "10:00",
    endTime: "12:00",
  });

  // Same time in Room 2 (allowed)
  const resRoom2 = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Room 2 Reservation",
    reservationType: "private_training",
    branchId,
    roomId: room2Id,
    date: "2026-09-05",
    startTime: "10:00",
    endTime: "12:00",
  });

  assert.equal(resRoom2.status, 201);

  // Later non-overlapping time in Room 1 (allowed)
  const resLater = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Later Room 1 Reservation",
    reservationType: "private_training",
    branchId,
    roomId,
    date: "2026-09-05",
    startTime: "12:00",
    endTime: "14:00",
  });

  assert.equal(resLater.status, 201);
});

test("POST /admin/room-reservations — ignores cancelled reservations for conflict checking", async () => {
  const run = `cancel-ign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId } = await insertBranchAndRoom(run, "f");

  const createRes = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "First Reservation",
    reservationType: "rehearsal",
    branchId,
    roomId,
    date: "2026-09-06",
    startTime: "14:00",
    endTime: "16:00",
  });
  const firstId = (await jsonBody(createRes)).id as number;

  // Cancel the first reservation
  const cancelRes = await requestAsSuperAdmin("PATCH", `/api/admin/room-reservations/${firstId}`, {
    status: "cancelled",
  });
  assert.equal(cancelRes.status, 200);

  // New reservation at same date/time succeeds
  const newRes = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Replacement Reservation",
    reservationType: "rehearsal",
    branchId,
    roomId,
    date: "2026-09-06",
    startTime: "14:00",
    endTime: "16:00",
  });

  assert.equal(newRes.status, 201);
});

test("PATCH /admin/room-reservations/:id — enforces space-time immutability rules", async () => {
  const run = `immut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId, room2Id } = await insertBranchAndRoom(run, "immut");

  const createRes = await requestAsSuperAdmin("POST", "/api/admin/room-reservations", {
    title: "Initial Title",
    reservationType: "rehearsal",
    branchId,
    roomId,
    date: "2026-09-10",
    startTime: "10:00",
    endTime: "12:00",
  });
  const resId = (await jsonBody(createRes)).id as number;

  // PATCH title succeeds
  const patchTitleRes = await requestAsSuperAdmin("PATCH", `/api/admin/room-reservations/${resId}`, {
    title: "Updated Title",
  });
  assert.equal(patchTitleRes.status, 200);
  const updatedTitleBody = await jsonBody(patchTitleRes);
  assert.equal(updatedTitleBody.title, "Updated Title");

  // PATCH roomId fails (immutable field)
  const patchRoomRes = await requestAsSuperAdmin("PATCH", `/api/admin/room-reservations/${resId}`, {
    roomId: room2Id,
  });
  assert.equal(patchRoomRes.status, 400);
  assert.equal((await jsonBody(patchRoomRes)).error, "IMMUTABLE_OCCUPANCY_FIELD");

  // PATCH date fails (immutable field)
  const patchDateRes = await requestAsSuperAdmin("PATCH", `/api/admin/room-reservations/${resId}`, {
    date: "2026-09-11",
  });
  assert.equal(patchDateRes.status, 400);
  assert.equal((await jsonBody(patchDateRes)).error, "IMMUTABLE_OCCUPANCY_FIELD");

  // Cancel reservation
  await requestAsSuperAdmin("PATCH", `/api/admin/room-reservations/${resId}`, {
    status: "cancelled",
  });

  // Attempting to re-activate cancelled reservation fails
  const reactivateRes = await requestAsSuperAdmin("PATCH", `/api/admin/room-reservations/${resId}`, {
    status: "active",
  });
  assert.equal(reactivateRes.status, 400);
  assert.equal((await jsonBody(reactivateRes)).error, "RESERVATION_CANCELLED");
});

test("Permissions — room_reservations view/create/edit/cancel permissions are enforced", async () => {
  const run = `perms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { branchId, roomId } = await insertBranchAndRoom(run, "g");

  const viewUser = await insertRoleAndUser(run, "view", { room_reservations: { view: true } });
  const createUser = await insertRoleAndUser(run, "create", { room_reservations: { create: true } });
  const noPermUser = await insertRoleAndUser(run, "none", {});

  // List: viewUser succeeds, noPermUser fails
  const listNoPerm = await requestAs(noPermUser, "GET", "/api/admin/room-reservations");
  assert.equal(listNoPerm.status, 403);

  const listViewPerm = await requestAs(viewUser, "GET", "/api/admin/room-reservations");
  assert.equal(listViewPerm.status, 200);

  // Create: viewUser fails, createUser succeeds
  const createViewPerm = await requestAs(viewUser, "POST", "/api/admin/room-reservations", {
    title: "Test",
    reservationType: "other",
    branchId,
    roomId,
    date: "2026-09-07",
    startTime: "10:00",
    endTime: "11:00",
  });
  assert.equal(createViewPerm.status, 403);

  const createSuccess = await requestAs(createUser, "POST", "/api/admin/room-reservations", {
    title: "Test",
    reservationType: "other",
    branchId,
    roomId,
    date: "2026-09-07",
    startTime: "10:00",
    endTime: "11:00",
  });
  assert.equal(createSuccess.status, 201);
});
