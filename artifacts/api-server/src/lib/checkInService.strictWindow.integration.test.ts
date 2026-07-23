/**
 * Real-database integration test proving the Studio check-in engine
 * (performBookingCheckIn) now enforces the strict end-time cutoff added on
 * top of the pre-existing 120-minute grace window — the one behavior change
 * this task made to Studio, with the rest of the transaction (booking lock,
 * attendance write, credit deduction, ledger, booking status) left exactly
 * as before. No pre-existing test covered this transaction at all prior to
 * this change (confirmed via repo-wide grep), so this is new coverage, not
 * a regression check against an old suite.
 *
 * performBookingCheckIn now accepts an optional `now` override (added by
 * this same change) purely so this test can inject a deterministic instant
 * instead of depending on the real wall clock — real callers (checkIn.ts,
 * attendance.ts) never pass it and get the real clock exactly as before.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DISPOSABLE_ATTENDANCE_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5612/central_studio_disposable_attendance";

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

let pool: import("pg").Pool;
let db: typeof import("@workspace/db").db;
let bookingsTable: typeof import("@workspace/db").bookingsTable;
let performBookingCheckIn: typeof import("./checkInService.ts").performBookingCheckIn;
let isCheckInError: typeof import("./checkInService.ts").isCheckInError;
let cairoDateTimeToUtcMs: typeof import("./occurrence.ts").cairoDateTimeToUtcMs;

function cairoAt(dateOnly: string, time: string): Date {
  return new Date(cairoDateTimeToUtcMs(dateOnly, time));
}

// A fixed date so "today" in these tests is always this exact calendar day —
// avoids flakiness tied to whatever real date the suite happens to run on.
const OCCURRENCE_DATE = "2026-08-03";

let studentId: number;
let studentEmail: string;
let classId: number;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  db = dbModule.db;
  bookingsTable = dbModule.bookingsTable;
  const svc = await import("./checkInService.ts");
  performBookingCheckIn = svc.performBookingCheckIn;
  isCheckInError = svc.isCheckInError;
  const occurrenceModule = await import("./occurrence.ts");
  cairoDateTimeToUtcMs = occurrenceModule.cairoDateTimeToUtcMs;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Studio Cutoff Test', $1, '0100000099', 'parent') RETURNING id`,
    [`studio-cutoff-${run}@example.com`],
  );
  studentId = student.rows[0].id;
  studentEmail = `studio-cutoff-${run}@example.com`;

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Studio Cutoff Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id) VALUES ('Studio Cutoff Class', 'general', $1) RETURNING id`,
    [instructor.rows[0].id],
  );
  classId = klass.rows[0].id;
});

after(async () => {
  await pool.end();
});

async function makeBooking(startTime: string, endTime: string, label: string, occurrenceDate = OCCURRENCE_DATE): Promise<number> {
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time) VALUES ($1, 'one_time', 'active', $2, $3, $4) RETURNING id`,
    [classId, occurrenceDate, startTime, endTime],
  );
  const booking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, status, booking_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'confirmed') RETURNING id`,
    [`Studio Cutoff Test ${label}`, studentEmail, studentId, schedule.rows[0].id, classId, occurrenceDate],
  );
  return booking.rows[0].id;
}

async function attemptCheckIn(bookingId: number, now: Date) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).for("update");
    return performBookingCheckIn(tx, {
      booking,
      student: { id: studentId, name: "Studio Cutoff Test", email: studentEmail },
      paymentMode: "pay_at_studio",
      performedBy: "test@example.com",
      now,
    });
  });
}

test("Studio check-in succeeds one minute before the scheduled end time", async () => {
  const bookingId = await makeBooking("17:00", "18:00", "before-end");
  const result = await attemptCheckIn(bookingId, cairoAt(OCCURRENCE_DATE, "17:59"));
  assert.ok(result.attendanceId > 0);
});

test("Studio check-in is rejected exactly at the scheduled end time (check_in_closed)", async () => {
  const bookingId = await makeBooking("17:00", "18:00", "at-end");
  await assert.rejects(
    attemptCheckIn(bookingId, cairoAt(OCCURRENCE_DATE, "18:00")),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_closed" && err.status === 400,
  );
});

test("Studio check-in is rejected after the scheduled end time", async () => {
  const bookingId = await makeBooking("17:00", "18:00", "after-end");
  await assert.rejects(
    attemptCheckIn(bookingId, cairoAt(OCCURRENCE_DATE, "20:00")),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_closed",
  );
});

test("a booking resolved (candidate-listed) before end but confirmed at/after end is rejected — resolver eligibility is never trusted at confirm time", async () => {
  const bookingId = await makeBooking("17:00", "18:00", "resolve-then-late-confirm");
  // Simulates: admin resolves candidates at 17:59 (would show eligible), but
  // the actual confirmation network round-trip completes at 18:00 exactly.
  await assert.rejects(
    attemptCheckIn(bookingId, cairoAt(OCCURRENCE_DATE, "18:00")),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_closed",
  );
});

test("Studio check-in still respects the pre-existing 120-minute too-early boundary (unchanged by this task)", async () => {
  const bookingId = await makeBooking("17:00", "18:00", "too-early");
  await assert.rejects(
    attemptCheckIn(bookingId, cairoAt(OCCURRENCE_DATE, "14:00")),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_too_early",
  );
});

test("Studio occurrence-specific booking for Tuesday 01:00 opens Monday at 23:00 and closes Tuesday at 02:00", async () => {
  const monday = "2026-07-27";
  const tuesday = "2026-07-28";
  const beforeOpenId = await makeBooking("01:00", "02:00", "midnight-too-early", tuesday);
  await assert.rejects(
    attemptCheckIn(beforeOpenId, cairoAt(monday, "22:59")),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_too_early",
  );

  const openId = await makeBooking("01:00", "02:00", "midnight-open", tuesday);
  const result = await attemptCheckIn(openId, cairoAt(monday, "23:00"));
  assert.ok(result.attendanceId > 0);

  const endedId = await makeBooking("01:00", "02:00", "midnight-ended", tuesday);
  await assert.rejects(
    attemptCheckIn(endedId, cairoAt(tuesday, "02:00")),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_closed",
  );
});
