/**
 * Real route + database integration test for Phase 5 (booking occurrence
 * integrity on reschedule). Boots the ACTUAL Express router
 * (routes/bookings.ts) behind the ACTUAL auth middlewares, issues real HTTP
 * PATCH requests against it, and asserts on real row state in a disposable
 * local Postgres database — proving that moving a booking to a different
 * schedule recomputes occurrenceDate instead of leaving it stale (the exact
 * bug: reminder automation reading a booking's occurrenceDate against its
 * NEW schedule's start time while the date itself still belonged to the OLD
 * schedule).
 *
 * Safety gate + setup: identical convention to
 * balletCancellationRouteIntegration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.REMINDERS_TEST_DATABASE_URL
  ?? "postgres://localhost:5432/central_studio_test_local";

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

let classId: number;
let superAdminId: number;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

function adminToken(adminId: number, username: string): string {
  return jwtSign({ sub: adminId, username, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(superAdminId, `route-test-super-${RUN}`),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function createSchedule(dateOffsetDays: number, startTime = "18:00:00"): Promise<{ id: number; date: string }> {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dateOffsetDays);
  const dateStr = date.toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time) VALUES ($1, 'one_time', 'active', $2, $3, '23:00:00') RETURNING id`,
    [classId, dateStr, startTime],
  );
  return { id: rows[0].id, date: dateStr };
}

async function createBookingRow(schedule: { id: number; date: string }, studentEmail: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO bookings (student_name, student_email, schedule_id, class_id, occurrence_date, booking_status)
     VALUES ('Occurrence Integrity Test', $1, $2, $3, $4, 'confirmed') RETURNING id`,
    [studentEmail, schedule.id, classId, schedule.date],
  );
  return rows[0].id;
}

/** node-postgres parses `date` columns into a local-time Date object — format
 * back to YYYY-MM-DD using LOCAL getters (not UTC) to recover the exact
 * calendar date that was stored, regardless of the test runner's TZ. */
function formatDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  const d = value as Date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function bookingRow(bookingId: number): Promise<{ scheduleId: number | null; occurrenceDate: string | null }> {
  const { rows } = await pool.query(
    `SELECT schedule_id AS "scheduleId", occurrence_date AS "occurrenceDate" FROM bookings WHERE id = $1`,
    [bookingId],
  );
  return { scheduleId: rows[0].scheduleId, occurrenceDate: formatDateOnly(rows[0].occurrenceDate) };
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const bookingsRouter = (await import("./bookings.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(bookingsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id;
  } else {
    const su = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin) VALUES ($1, $2, 'x', 'Route Test Super', true) RETURNING id`,
      [`route-test-super-${RUN}`, `route-test-super-${RUN}@example.com`],
    );
    superAdminId = su.rows[0].id;
  }

  const cls = await pool.query(
    `INSERT INTO classes (title, category) VALUES ($1, 'general') RETURNING id`,
    [`Occurrence Integrity Class ${RUN}`],
  );
  classId = cls.rows[0].id;
});

after(async () => {
  await pool.query(`DELETE FROM bookings WHERE class_id = $1`, [classId]);
  await pool.query(`DELETE FROM schedules WHERE class_id = $1`, [classId]);
  await pool.query(`DELETE FROM classes WHERE id = $1`, [classId]);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("moving a booking to a different schedule recomputes occurrenceDate, not the stale old one", async () => {
  const oldSchedule = await createSchedule(3);
  const newSchedule = await createSchedule(10);
  const bookingId = await createBookingRow(oldSchedule, `occurrence-integrity-${RUN}-1@example.invalid`);

  const before = await bookingRow(bookingId);
  assert.equal(before.occurrenceDate, oldSchedule.date);

  const res = await asAdmin(`/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ scheduleId: newSchedule.id }),
  });
  assert.equal(res.status, 200);

  const afterRow = await bookingRow(bookingId);
  assert.equal(afterRow.scheduleId, newSchedule.id);
  assert.equal(afterRow.occurrenceDate, newSchedule.date, "occurrenceDate must follow the NEW schedule, not stay pinned to the old one");
  assert.notEqual(afterRow.occurrenceDate, oldSchedule.date);
});

test("clearing a booking's scheduleId also clears its occurrenceDate", async () => {
  const schedule = await createSchedule(4);
  const bookingId = await createBookingRow(schedule, `occurrence-integrity-${RUN}-2@example.invalid`);

  const res = await asAdmin(`/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ scheduleId: null }),
  });
  assert.equal(res.status, 200);

  const afterRow = await bookingRow(bookingId);
  assert.equal(afterRow.scheduleId, null);
  assert.equal(afterRow.occurrenceDate, null);
});

test("an update that does not touch scheduleId leaves occurrenceDate untouched", async () => {
  const schedule = await createSchedule(5);
  const bookingId = await createBookingRow(schedule, `occurrence-integrity-${RUN}-3@example.invalid`);

  const res = await asAdmin(`/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: "unrelated edit" }),
  });
  assert.equal(res.status, 200);

  const afterRow = await bookingRow(bookingId);
  assert.equal(afterRow.scheduleId, schedule.id);
  assert.equal(afterRow.occurrenceDate, schedule.date);
});
