/**
 * Integration coverage for GET /admin/calendar/resource-view (Phase 4B).
 *
 * Covers:
 * 1. Resource endpoint returns rooms correctly.
 * 2. Multiple schedules in same room appear grouped.
 * 3. Different rooms separate correctly.
 * 4. Regular + Ballet appear together.
 * 5. Schedules without rooms are excluded.
 * 6. Cancelled schedules excluded.
 * 7. Conflict data reused correctly.
 * 8. Permission protection works.
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
  const role = await db.execute(
    sql`INSERT INTO roles (name, permissions) VALUES (${`Res Role ${run} ${label}`}, ${JSON.stringify(permissions)}::jsonb) RETURNING id`,
  );
  const roleId = role.rows[0].id as number;
  const user = await db.execute(
    sql`INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id)
     VALUES (${`res-user-${run}-${label}`}, ${`res-user-${run}-${label}@example.com`}, 'x', 'Res Test User', false, ${roleId}) RETURNING id`,
  );
  return user.rows[0].id as number;
}

before(async () => {
  const dbMod = await import("@workspace/db");
  const drizzleMod = await import("drizzle-orm");
  db = dbMod.db;
  sql = drizzleMod.sql;

  const expressMod = await import("express");

  const adminRes = await db.execute(
    sql`INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES (${`res-super-${Date.now()}`}, ${`res-super-${Date.now()}@example.com`}, 'x', 'Resource Super Admin', true) RETURNING id`,
  );
  superAdminId = adminRes.rows[0].id as number;

  const adminCalendarRouter = (await import("./adminCalendar")).default;

  app = expressMod.default();
  app.use(expressMod.default.json());
  app.use("/api", adminCalendarRouter);

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

test("GET /admin/calendar/resource-view — basic room structure, grouping, and rules", async () => {
  const run = `r1-${Date.now()}`;
  const branchRes = await db.execute(sql`INSERT INTO studio_branches (name) VALUES (${`Branch ${run}`}) RETURNING id`);
  const branchId = branchRes.rows[0].id as number;

  const roomARes = await db.execute(sql`INSERT INTO studio_rooms (branch_id, name) VALUES (${branchId}, ${`Room A ${run}`}) RETURNING id`);
  const roomBRes = await db.execute(sql`INSERT INTO studio_rooms (branch_id, name) VALUES (${branchId}, ${`Room B ${run}`}) RETURNING id`);
  const roomAId = roomARes.rows[0].id as number;
  const roomBId = roomBRes.rows[0].id as number;

  const classARes = await db.execute(sql`INSERT INTO classes (title, category) VALUES ('Class A', 'Dance') RETURNING id`);
  const classBRes = await db.execute(sql`INSERT INTO classes (title, category) VALUES ('Class B', 'Dance') RETURNING id`);
  const classIdA = classARes.rows[0].id as number;
  const classIdB = classBRes.rows[0].id as number;

  const balletClassRes = await db.execute(sql`INSERT INTO ballet_classes (title) VALUES ('Ballet A') RETURNING id`);
  const balletClassId = balletClassRes.rows[0].id as number;

  // 2026-08-03 is a Monday (dayOfWeek = 1)
  // Schedule 1: Room A, 12:00-13:00 (active)
  await db.execute(
    sql`INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES (${classIdA}, ${branchId}, ${roomAId}, 'weekly', 'active', 1, '12:00', '13:00', true)`,
  );
  // Schedule 2: Room A, 14:00-15:00 (active) -> grouped under Room A
  await db.execute(
    sql`INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES (${classIdB}, ${branchId}, ${roomAId}, 'weekly', 'active', 1, '14:00', '15:00', true)`,
  );
  // Schedule 3: Room B, Ballet, 12:00-13:00 (active) -> in Room B together with regular
  await db.execute(
    sql`INSERT INTO ballet_schedules (class_id, branch_id, room_id, status, day_of_week, start_time, end_time, capacity)
     VALUES (${balletClassId}, ${branchId}, ${roomBId}, 'active', 1, '12:00', '13:00', 15)`,
  );
  // Schedule 4: Cancelled in Room B -> should be EXCLUDED
  await db.execute(
    sql`INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES (${classIdA}, ${branchId}, ${roomBId}, 'weekly', 'cancelled', 1, '16:00', '17:00', true)`,
  );
  // Schedule 5: Without room in branch -> should be EXCLUDED
  await db.execute(
    sql`INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES (${classIdA}, ${branchId}, NULL, 'weekly', 'active', 1, '18:00', '19:00', true)`,
  );

  const res = await getAsSuperAdmin(`/api/admin/calendar/resource-view?date=2026-08-03&branchId=${branchId}`);
  assert.equal(res.status, 200);

  const body = await jsonBody(res);
  assert.equal(body.date, "2026-08-03");
  assert.equal(body.branchId, branchId);

  const rooms = body.rooms as Array<{ roomId: number; roomName: string; occurrences: Array<Record<string, unknown>> }>;
  assert.equal(rooms.length, 2);

  const roomA = rooms.find((r) => r.roomId === roomAId)!;
  assert.ok(roomA);
  assert.equal(roomA.occurrences.length, 2);
  assert.equal(roomA.occurrences[0].title, "Class A");
  assert.equal(roomA.occurrences[1].title, "Class B");

  const roomB = rooms.find((r) => r.roomId === roomBId)!;
  assert.ok(roomB);
  assert.equal(roomB.occurrences.length, 1);
  assert.equal(roomB.occurrences[0].source, "ballet");
  assert.equal(roomB.occurrences[0].title, "Ballet A");
});

test("GET /admin/calendar/resource-view — conflict annotation reuse", async () => {
  const run = `r2-${Date.now()}`;
  const branchRes = await db.execute(sql`INSERT INTO studio_branches (name) VALUES (${`Branch Conflict ${run}`}) RETURNING id`);
  const branchId = branchRes.rows[0].id as number;

  const roomRes = await db.execute(sql`INSERT INTO studio_rooms (branch_id, name) VALUES (${branchId}, ${`Conflict Room ${run}`}) RETURNING id`);
  const roomId = roomRes.rows[0].id as number;

  const classARes = await db.execute(sql`INSERT INTO classes (title, category) VALUES ('Conflict Class 1', 'Dance') RETURNING id`);
  const classBRes = await db.execute(sql`INSERT INTO classes (title, category) VALUES ('Conflict Class 2', 'Dance') RETURNING id`);
  const classIdA = classARes.rows[0].id as number;
  const classIdB = classBRes.rows[0].id as number;

  // Overlapping times in same room: 13:00-14:30 and 14:00-15:00 on Monday
  await db.execute(
    sql`INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES (${classIdA}, ${branchId}, ${roomId}, 'weekly', 'active', 1, '13:00', '14:30', true)`,
  );
  await db.execute(
    sql`INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time, is_recurring)
     VALUES (${classIdB}, ${branchId}, ${roomId}, 'weekly', 'active', 1, '14:00', '15:00', true)`,
  );

  const res = await getAsSuperAdmin(`/api/admin/calendar/resource-view?date=2026-08-03&branchId=${branchId}`);
  assert.equal(res.status, 200);

  const body = await jsonBody(res);
  const rooms = body.rooms as Array<{ roomId: number; occurrences: Array<Record<string, unknown>> }>;
  const targetRoom = rooms.find((r) => r.roomId === roomId)!;
  assert.equal(targetRoom.occurrences.length, 2);
  assert.notEqual(targetRoom.occurrences[0].conflict, null);
  assert.notEqual(targetRoom.occurrences[1].conflict, null);
});

test("GET /admin/calendar/resource-view — permissions enforcement", async () => {
  const run = `r3-${Date.now()}`;
  // User with schedules.view permission
  const allowedUser = await insertRoleAndUser(run, "allowed", { schedules: { view: true } });
  // User without permission
  const deniedUser = await insertRoleAndUser(run, "denied", { schedules: { view: false } });

  const allowedRes = await getAs(allowedUser, "/api/admin/calendar/resource-view?date=2026-08-03");
  assert.equal(allowedRes.status, 200);

  const deniedRes = await getAs(deniedUser, "/api/admin/calendar/resource-view?date=2026-08-03");
  assert.equal(deniedRes.status, 403);
});

test("GET /admin/calendar/resource-view — includes studio room reservations alongside classes and ballet", async () => {
  const run = `r-res-${Date.now()}`;
  const branchRes = await db.execute(sql`INSERT INTO studio_branches (name) VALUES (${`Branch Reservation ${run}`}) RETURNING id`);
  const branchId = branchRes.rows[0].id as number;

  const roomRes = await db.execute(sql`INSERT INTO studio_rooms (branch_id, name) VALUES (${branchId}, ${`Res Room ${run}`}) RETURNING id`);
  const roomId = roomRes.rows[0].id as number;

  // Insert active room reservation
  await db.execute(
    sql`INSERT INTO studio_room_reservations (title, reservation_type, branch_id, room_id, date, start_time, end_time, status)
        VALUES ('Private Training Event', 'private_training', ${branchId}, ${roomId}, '2026-08-03', '10:00', '12:00', 'active')`,
  );

  // Insert cancelled room reservation (must be excluded)
  await db.execute(
    sql`INSERT INTO studio_room_reservations (title, reservation_type, branch_id, room_id, date, start_time, end_time, status)
        VALUES ('Cancelled Event', 'room_rental', ${branchId}, ${roomId}, '2026-08-03', '12:00', '14:00', 'cancelled')`,
  );

  const res = await getAsSuperAdmin(`/api/admin/calendar/resource-view?date=2026-08-03&branchId=${branchId}`);
  assert.equal(res.status, 200);

  const data = (await jsonBody(res)) as any;
  assert.equal(Array.isArray(data.rooms), true);
  const targetRoom = data.rooms.find((r: any) => r.roomId === roomId);
  assert.notEqual(targetRoom, undefined);
  assert.equal(targetRoom.occurrences.some((o: any) => o.source === "reservation" && o.title === "Private Training Event"), true);
  assert.equal(targetRoom.occurrences.some((o: any) => o.source === "reservation" && o.title === "Cancelled Event"), false);
});

test("GET /admin/calendar — returns mixed payload of class, ballet, and reservation sources", async () => {
  const branchName = `Mix Branch ${Date.now()}`;
  const branchRes = await db.execute(sql`INSERT INTO studio_branches (name) VALUES (${branchName}) RETURNING id`);
  const branchId = branchRes.rows[0].id as number;
  const roomRes = await db.execute(sql`INSERT INTO studio_rooms (branch_id, name) VALUES (${branchId}, 'Room 1') RETURNING id`);
  const roomId = roomRes.rows[0].id as number;

  await db.execute(
    sql`INSERT INTO studio_room_reservations (title, reservation_type, branch_id, room_id, date, start_time, end_time, status)
        VALUES ('Private Workshop', 'workshop', ${branchId}, ${roomId}, '2026-08-04', '14:00', '16:00', 'active')`,
  );

  const res = await getAsSuperAdmin(`/api/admin/calendar?from=2026-08-04&to=2026-08-04&branchId=${branchId}`);
  assert.equal(res.status, 200);
  const items = (await res.json()) as any[];
  assert.equal(Array.isArray(items), true);
  const reservationItem = items.find((i: any) => i.source === "reservation");
  assert.notEqual(reservationItem, undefined);
  assert.equal(reservationItem.title, "Private Workshop");
  assert.equal(reservationItem.reservationType, "workshop");
});

test("GET /admin/calendar — allows access for user with room_reservations.view permission", async () => {
  const userId = await insertRoleAndUser(`mix-${Date.now()}`, "rrview", { room_reservations: { view: true } });
  const res = await getAs(userId, "/api/admin/calendar?from=2026-08-04&to=2026-08-04");
  assert.equal(res.status, 200);
});
