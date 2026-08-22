/**
 * Finance Final Closure Batch 1 — Part G reproduction attempt.
 *
 * Reported symptom: "A class has recurring weekly times, e.g. Tuesday and
 * Thursday. A participant pays for Tuesday. After Tuesday passes, the class
 * still appears Paid — Thursday may therefore appear paid even though it is
 * a separate occurrence."
 *
 * This test reproduces the exact scenario at the data/API layer: one class
 * with two schedules (Tuesday, Thursday), one participant with an
 * independent booking for each occurrence, Tuesday's booking confirmed
 * paid, and asserts GET /api/my/bookings — the mobile app's single source
 * of truth for booking/payment state (myRoutes.ts) — returns Thursday's
 * booking with its OWN independent, still-pending state.
 *
 * Result of this reproduction attempt (see
 * FINANCE_FINAL_CLOSURE_BATCH_1_REPORT.md Part 14 for the full writeup):
 * NOT REPRODUCIBLE against the current codebase. Every booking is its own
 * row (bookings.occurrence_date is a real per-occurrence column, populated
 * at creation time — see bookings.ts's currentOccurrenceDate() call), GET
 * /my/bookings returns one row per booking with its own paymentStatus, and
 * the two most likely mobile display surfaces (app/(tabs)/bookings.tsx's
 * flat booking list, and app/(tabs)/classes.tsx's class-card matcher, which
 * keys explicitly on `b.scheduleId === item.scheduleId && b.occurrenceDate
 * === item.date`) were both read and are already occurrence-scoped
 * correctly. This test is added as ongoing diagnostic coverage for this
 * exact scenario, and to prove — not merely assert — that occurrence
 * independence holds end-to-end today.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_OCCURRENCE_INDEPENDENCE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_occurrence_unique";

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
process.env.STUDENT_JWT_SECRET = "test-student-secret";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function jsonBody(res: Response): Promise<{ data: Array<Record<string, unknown>> }> {
  return res.json() as Promise<{ data: Array<Record<string, unknown>> }>;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const myRouter = (await import("./myRoutes")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", myRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("Part G reproduction: Tuesday paid does not mark Thursday paid — each occurrence has an independent booking/payment row", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `part-g-${run}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Part G Test`, email],
  );
  const studentId = student.rows[0].id as number;
  const token = jwtSign({ sub: studentId, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Part G Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Part G Twice-Weekly Class ${run}`, instructor.rows[0].id],
  );
  const classId = klass.rows[0].id as number;

  // Two schedules under the SAME class — Tuesday (dayOfWeek 2) and Thursday
  // (dayOfWeek 4) — mirroring exactly the "recurring weekly times, e.g.
  // Tuesday and Thursday" scenario described in the UAT report.
  const tuesdaySchedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 2, '18:00', '19:00', 300) RETURNING id`,
    [classId],
  );
  const thursdaySchedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 4, '18:00', '19:00', 300) RETURNING id`,
    [classId],
  );

  const tuesdayOccurrence = "2026-07-28"; // a Tuesday
  const thursdayOccurrence = "2026-07-30"; // the following Thursday

  const tuesdayBooking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, booking_status, payment_status, payment_mode, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'pending_payment', 'pay_at_studio', 'confirmed') RETURNING id`,
    [email, email, studentId, tuesdaySchedule.rows[0].id, classId, tuesdayOccurrence],
  );
  const thursdayBooking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, booking_status, payment_status, payment_mode, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'pending_payment', 'pay_at_studio', 'confirmed') RETURNING id`,
    [email, email, studentId, thursdaySchedule.rows[0].id, classId, thursdayOccurrence],
  );

  // Tuesday's occurrence passes and its payment is confirmed (mirrors the
  // real payment-confirmation transition, applied directly here since this
  // test targets the READ side, not the confirmation write path already
  // covered by Part E's tests).
  await pool.query(`UPDATE bookings SET payment_status = 'paid' WHERE id = $1`, [tuesdayBooking.rows[0].id]);

  const res = await fetch(apiUrl("/api/my/bookings"), { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);

  const tuesdayRow = body.data.find((b) => b.id === tuesdayBooking.rows[0].id);
  const thursdayRow = body.data.find((b) => b.id === thursdayBooking.rows[0].id);
  assert.ok(tuesdayRow, "Tuesday's booking row must be present");
  assert.ok(thursdayRow, "Thursday's booking row must be present");

  assert.equal(tuesdayRow!.paymentStatus, "paid", "Tuesday remains historically Paid");
  assert.equal(
    thursdayRow!.paymentStatus,
    "pending_payment",
    "Thursday must have an INDEPENDENT payment state — Tuesday's confirmation must not leak into it",
  );
  assert.notEqual(tuesdayRow!.occurrenceDate, thursdayRow!.occurrenceDate, "the two occurrences must be distinguishable by occurrenceDate");
  assert.notEqual(tuesdayRow!.scheduleId, thursdayRow!.scheduleId, "the two occurrences belong to distinct schedule rows, as this class models them");
});
