/**
 * Real-database integration tests for performBalletAttendanceWrite — the
 * single Ballet attendance write engine shared by the manual Application
 * Detail endpoint and the unified QR/phone/name confirm path.
 *
 * Safety gate matches the repo's established convention (see
 * balletCancellationRouteIntegration.test.ts / balletMyClassesRouteIntegration.test.ts).
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";

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
let performBalletAttendanceWrite: typeof import("./balletAttendanceWrite.ts").performBalletAttendanceWrite;
let isBalletAttendanceError: typeof import("./balletAttendanceWrite.ts").isBalletAttendanceError;
let cairoDateTimeToUtcMs: typeof import("./occurrence.ts").cairoDateTimeToUtcMs;

// Converts a Cairo WALL-CLOCK date+time into the real UTC Date it represents,
// via the same ICU-driven conversion the production code uses — never a
// hardcoded offset. Egypt's UTC offset is +3 in July (summer-time policy) and
// +2 in winter, so hand-computing "Cairo time minus 2h" would silently break
// depending on which month the test happens to reference.
function cairoAt(dateOnly: string, time: string): Date {
  return new Date(cairoDateTimeToUtcMs(dateOnly, time));
}

// A Monday in the test's reference week — dayOfWeek 1, matching JS Date#getUTCDay().
const CLASS_DATE = "2026-07-20"; // confirmed Monday
const FUTURE_DATE = "2026-07-27"; // the Monday after
const WRONG_DAY_DATE = "2026-07-21"; // Tuesday

function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Fixture {
  parentId: number;
  otherParentId: number;
  levelId: number;
  groupId: number;
  applicationId: number;
  assignmentId: number;
  classId: number;
  scheduleId: number; // 17:00-18:00 Cairo, dayOfWeek=1 (Monday)
  longScheduleId: number; // 17:00-18:30 Cairo, dayOfWeek=1, 90 min
  midnightScheduleId: number; // 01:00-02:00 Cairo, dayOfWeek=2 (Tuesday)
}
let fx: Fixture;

async function insertPaidCycle(applicationId: number, startDate: string, expiresAt: string): Promise<void> {
  const pkg = await pool.query(
    `INSERT INTO ballet_packages (name, monthly_classes, monthly_hours, price_egp, is_active) VALUES ($1, 8, 12, 2500, true) RETURNING id`,
    [`Write Test Package ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`],
  );
  await pool.query(
    `INSERT INTO ballet_payments (application_id, package_id, amount_egp, status, payment_method, paid_at, subscription_start_date, subscription_expires_at)
     VALUES ($1, $2, 2500, 'paid', 'inPerson', now(), $3, $4)`,
    [applicationId, pkg.rows[0].id, startDate, expiresAt],
  );
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  db = dbModule.db;
  const writeModule = await import("./balletAttendanceWrite.ts");
  performBalletAttendanceWrite = writeModule.performBalletAttendanceWrite;
  isBalletAttendanceError = writeModule.isBalletAttendanceError;
  const occurrenceModule = await import("./occurrence.ts");
  cairoDateTimeToUtcMs = occurrenceModule.cairoDateTimeToUtcMs;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const level = await pool.query(`SELECT id FROM ballet_levels ORDER BY id LIMIT 1`);
  fx = {} as Fixture;
  fx.levelId = level.rows[0].id;

  const parent = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Write Test Parent', $1, '0100000001', 'parent') RETURNING id`,
    [`write-test-parent-${run}@example.com`],
  );
  fx.parentId = parent.rows[0].id;
  const otherParent = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Write Test Other Parent', $1, '0100000002', 'parent') RETURNING id`,
    [`write-test-other-${run}@example.com`],
  );
  fx.otherParentId = otherParent.rows[0].id;

  const group = await pool.query(`INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Write Test Group ${run}`, fx.levelId]);
  fx.groupId = group.rows[0].id;

  const application = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status, assigned_level_id)
     VALUES ($1, 'Write Test Parent', '0100000001', $2, 'Write Test Child', 'active', $3) RETURNING id`,
    [fx.parentId, `write-test-parent-${run}@example.com`, fx.levelId],
  );
  fx.applicationId = application.rows[0].id;

  const assignment = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, group_id, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [fx.applicationId, fx.levelId, fx.groupId],
  );
  fx.assignmentId = assignment.rows[0].id;

  const instructor = await pool.query(`INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`, [`Write Test Instructor ${run}`]);
  const balletClass = await pool.query(
    `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active) VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
    [`Write Test Class ${run}`, fx.levelId, fx.groupId, instructor.rows[0].id],
  );
  fx.classId = balletClass.rows[0].id;

  const schedule = await pool.query(
    `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status) VALUES ($1, 1, '17:00', '18:00', 60, 'active') RETURNING id`,
    [fx.classId],
  );
  fx.scheduleId = schedule.rows[0].id;

  const longSchedule = await pool.query(
    `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status) VALUES ($1, 1, '17:00', '18:30', 90, 'active') RETURNING id`,
    [fx.classId],
  );
  fx.longScheduleId = longSchedule.rows[0].id;

  const midnightSchedule = await pool.query(
    `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status) VALUES ($1, 2, '01:00', '02:00', 60, 'active') RETURNING id`,
    [fx.classId],
  );
  fx.midnightScheduleId = midnightSchedule.rows[0].id;

  await insertPaidCycle(fx.applicationId, addDays(CLASS_DATE, -10), addDays(CLASS_DATE, 400));
});

after(async () => {
  await pool.end();
});

test("happy path: checked_in inside the window with an active subscription succeeds and snapshots duration", async () => {
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: CLASS_DATE,
    status: "checked_in",
    performedBy: "test@example.com",
    source: "applicationDetail",
    ownerStudentId: fx.parentId,
    now: cairoAt(CLASS_DATE, "17:30"),
  });
  assert.equal(result.attendance.status, "checked_in");
  assert.equal(result.attendance.durationMinutes, 60);
  assert.equal(result.applicationId, fx.applicationId);
});

test("owner mismatch is rejected (never trust a resolver-supplied assignment id)", async () => {
  const date = addDays(CLASS_DATE, 7);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "test@example.com",
      source: "applicationDetail",
      ownerStudentId: fx.otherParentId,
      now: cairoAt(date, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "owner_mismatch" && err.status === 403,
  );
});

test("wrong day of week is rejected", async () => {
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: WRONG_DAY_DATE,
      status: "checked_in",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(WRONG_DAY_DATE, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "wrong_day_of_week",
  );
});

test("too early is rejected before the 120-minute grace window opens", async () => {
  const date = addDays(CLASS_DATE, 14);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(date, "14:00"), // 3h before a 17:00 start — outside the 120-minute window
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "too_early",
  );
});

test("check-in strictly at/after end time is rejected (check_in_closed)", async () => {
  const date = addDays(CLASS_DATE, 21);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(date, "18:00"), // exactly the scheduled end time
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "check_in_closed",
  );
});

test("check-in one minute before end still succeeds", async () => {
  const date = addDays(CLASS_DATE, 70);
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "checked_in",
    performedBy: "test@example.com",
    source: "applicationDetail",
    now: cairoAt(date, "17:59"),
  });
  assert.equal(result.attendance.status, "checked_in");
});

test("absent before the class has ended is rejected (not_yet_ended)", async () => {
  const date = addDays(CLASS_DATE, 28);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "absent",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(date, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "not_yet_ended",
  );
});

test("absent after the class has ended succeeds and snapshots full duration", async () => {
  const date = addDays(CLASS_DATE, 77);
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "absent",
    performedBy: "test@example.com",
    source: "applicationDetail",
    now: cairoAt(date, "18:05"),
  });
  assert.equal(result.attendance.status, "absent");
  assert.equal(result.attendance.durationMinutes, 60);
});

test("absent for a future class date is rejected", async () => {
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: FUTURE_DATE,
      status: "absent",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(CLASS_DATE, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "class_date_in_future",
  );
});

test("no active subscription blocks checked_in and absent, but not cancelled", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const application = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status, assigned_level_id)
     VALUES ($1, 'Unpaid Parent', '0100000003', $2, 'Unpaid Child', 'active', $3) RETURNING id`,
    [fx.parentId, `unpaid-${run}@example.com`, fx.levelId],
  );
  const assignment = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, group_id, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [application.rows[0].id, fx.levelId, fx.groupId],
  );
  const date = addDays(CLASS_DATE, 35);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: assignment.rows[0].id,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(date, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "no_active_subscription",
  );
  // cancelled bypasses the subscription gate — a pure administrative correction.
  const cancelled = await performBalletAttendanceWrite({
    levelAssignmentId: assignment.rows[0].id,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "cancelled",
    performedBy: "test@example.com",
    source: "applicationDetail",
    now: cairoAt(date, "17:30"),
  });
  assert.equal(cancelled.attendance.status, "cancelled");
});

test("expired subscription (does not cover classDate) blocks checked_in", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const application = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status, assigned_level_id)
     VALUES ($1, 'Expired Parent', '0100000004', $2, 'Expired Child', 'active', $3) RETURNING id`,
    [fx.parentId, `expired-${run}@example.com`, fx.levelId],
  );
  const assignment = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, group_id, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [application.rows[0].id, fx.levelId, fx.groupId],
  );
  const date = addDays(CLASS_DATE, 42);
  await insertPaidCycle(application.rows[0].id, addDays(date, -60), addDays(date, -30)); // expired well before classDate
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: assignment.rows[0].id,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(date, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "no_active_subscription",
  );
});

test("duplicate attendance for the same occurrence returns 409 with the existing row id", async () => {
  const date = addDays(CLASS_DATE, 49);
  const first = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "checked_in",
    performedBy: "test@example.com",
    source: "applicationDetail",
    now: cairoAt(date, "17:30"),
  });
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "test@example.com",
      source: "applicationDetail",
      now: cairoAt(date, "17:35"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "duplicate_attendance" && err.status === 409 && err.existingAttendanceId === first.attendance.id,
  );
});

test("a 90-minute class snapshots 90 minutes regardless of check-in timestamp — never endTime-checkInTime", async () => {
  const date = addDays(CLASS_DATE, 56);
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.longScheduleId,
    classDate: date,
    status: "checked_in",
    performedBy: "test@example.com",
    source: "applicationDetail",
    now: cairoAt(date, "17:59"), // 89 min after a 17:00 start, 31 min before an 18:30 end
  });
  assert.equal(result.attendance.durationMinutes, 90, "duration must be the full scheduled length, not end-minus-checkin");
});

test("checked_in for a PAST class date is allowed as a historical/staff-correction entry (not gated by the live window)", async () => {
  // The manual Application Detail path is documented to remain useful for
  // "historical review, staff correction" — an admin backfilling a
  // forgotten check-in days after the class happened must still work, even
  // though the live 120-minute/end-time window has long since closed.
  const date = addDays(CLASS_DATE, -7); // within the fixture's paid-subscription window
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "checked_in",
    performedBy: "admin@example.com",
    source: "applicationDetail",
    now: cairoAt(CLASS_DATE, "17:30"), // "now" is weeks after the backfilled date
  });
  assert.equal(result.attendance.status, "checked_in");
});

test("checked_in for a FUTURE class date is always rejected, historical or not", async () => {
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: FUTURE_DATE,
      status: "checked_in",
      performedBy: "admin@example.com",
      source: "applicationDetail",
      now: cairoAt(CLASS_DATE, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "class_date_in_future",
  );
});

// ─── Source-mode enforcement (Section 3) ────────────────────────────────────

test("gateway source forces status=checked_in — any other status is rejected", async () => {
  const date = addDays(CLASS_DATE, 84);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "absent",
      performedBy: "gateway",
      source: "gateway",
      ownerStudentId: fx.parentId,
      now: cairoAt(date, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "invalid_status_for_source",
  );
});

test("gateway source requires a resolved ownerStudentId", async () => {
  const date = addDays(CLASS_DATE, 91);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "gateway",
      source: "gateway",
      now: cairoAt(date, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "owner_mismatch" && err.status === 403,
  );
});

test("gateway source rejects a classDate that is not today's Cairo occurrence, even inside the live window", async () => {
  const date = addDays(CLASS_DATE, 98);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: addDays(date, -7), // a past Monday — not today, even though "now" below is inside ITS window
      status: "checked_in",
      performedBy: "gateway",
      source: "gateway",
      ownerStudentId: fx.parentId,
      now: cairoAt(date, "17:30"), // "today" is `date`, not `date - 7`
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "not_todays_occurrence",
  );
});

test("gateway source succeeds for today's occurrence inside the live window and forces status server-side", async () => {
  const date = addDays(CLASS_DATE, 105);
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "checked_in",
    performedBy: "gateway",
    source: "gateway",
    ownerStudentId: fx.parentId,
    now: cairoAt(date, "17:30"),
  });
  assert.equal(result.attendance.status, "checked_in");
});

test("gateway accepts Tuesday's 01:00 occurrence on Monday at 23:00 and snapshots Tuesday as classDate", async () => {
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.midnightScheduleId,
    classDate: WRONG_DAY_DATE,
    status: "checked_in",
    performedBy: "gateway",
    source: "gateway",
    ownerStudentId: fx.parentId,
    now: cairoAt(CLASS_DATE, "23:00"),
  });
  assert.equal(result.attendance.classDate, WRONG_DAY_DATE);
  assert.equal(result.attendance.durationMinutes, 60);
});

test("gateway rejects the cross-midnight occurrence at Tuesday 02:00 and cannot substitute Monday's date", async () => {
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.midnightScheduleId,
      classDate: WRONG_DAY_DATE,
      status: "checked_in",
      performedBy: "gateway",
      source: "gateway",
      ownerStudentId: fx.parentId,
      now: cairoAt(WRONG_DAY_DATE, "02:00"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "check_in_closed",
  );

  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.midnightScheduleId,
      classDate: CLASS_DATE,
      status: "checked_in",
      performedBy: "gateway",
      source: "gateway",
      ownerStudentId: fx.parentId,
      now: cairoAt(CLASS_DATE, "23:00"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "wrong_day_of_week",
  );
});

test("autoAbsence source forces status=absent — any other status is rejected", async () => {
  const date = addDays(CLASS_DATE, 112);
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: date,
      status: "checked_in",
      performedBy: "system",
      source: "autoAbsence",
      now: cairoAt(date, "17:30"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "invalid_status_for_source",
  );
});

test("autoAbsence source does not run the live-clock check itself — the Worker is the timing authority", async () => {
  // Unlike applicationDetail's "absent" path, autoAbsence never checks
  // whether the occurrence has genuinely ended — balletAutoAbsence.ts proves
  // that independently before ever calling this function. A "now" hours
  // before the class would even start still succeeds here.
  const date = addDays(CLASS_DATE, 119);
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "absent",
    performedBy: "system",
    source: "autoAbsence",
    now: cairoAt(date, "12:00"), // hours before the class would even start
  });
  assert.equal(result.attendance.status, "absent");

  // Structural checks (day-of-week) still apply regardless of source.
  await assert.rejects(
    performBalletAttendanceWrite({
      levelAssignmentId: fx.assignmentId,
      balletScheduleId: fx.scheduleId,
      classDate: WRONG_DAY_DATE,
      status: "absent",
      performedBy: "system",
      source: "autoAbsence",
      now: cairoAt(WRONG_DAY_DATE, "12:00"),
    }),
    (err: unknown) => isBalletAttendanceError(err) && err.code === "wrong_day_of_week",
  );
});

test("autoAbsence source does not require ownerStudentId (no account is doing the resolving)", async () => {
  const date = addDays(CLASS_DATE, 126);
  const result = await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "absent",
    performedBy: "system",
    source: "autoAbsence",
    now: cairoAt(date, "18:05"),
  });
  assert.equal(result.attendance.status, "absent");
});

// ─── Section 8 — transactional composition (client param) plumbing ─────────

test("Section 8: a failure AFTER the attendance insert, inside the SAME caller-supplied transaction, rolls back the attendance row too", async () => {
  // Proves the atomicity guarantee balletAutoAbsence.ts relies on: composing
  // performBalletAttendanceWrite(client: tx) with a later step in the same
  // db.transaction() means ANY failure of that later step (e.g. the
  // notification insert) undoes the attendance insert — never a committed
  // absence row with no notification intent alongside it.
  const date = addDays(CLASS_DATE, 133);
  let thrown: unknown;
  try {
    await db.transaction(async (tx) => {
      await performBalletAttendanceWrite({
        levelAssignmentId: fx.assignmentId,
        balletScheduleId: fx.scheduleId,
        classDate: date,
        status: "absent",
        performedBy: "system",
        source: "autoAbsence",
        now: cairoAt(date, "18:05"),
        client: tx,
      });
      throw new Error("simulated notification-insert failure");
    });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error && thrown.message === "simulated notification-insert failure");

  const rows = await pool.query(
    `SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [fx.assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows[0].n, 0, "attendance must not remain committed when a later step in the same transaction fails");
});

test("Section 8: a duplicate_attendance error inside a composed transaction does not poison the outer transaction (SAVEPOINT recovery)", async () => {
  // Postgres aborts an entire transaction on error until ROLLBACK. Without
  // wrapping the insert in its own nested transaction (SAVEPOINT) when
  // `client` is already a caller-supplied tx, the existing-row lookup this
  // function runs right after catching a 23505 would itself fail with
  // "current transaction is aborted" — and the outer transaction would then
  // fail to commit at all. This proves both: the duplicate is still reported
  // correctly, AND the outer transaction survives to commit afterward.
  const date = addDays(CLASS_DATE, 140);
  await performBalletAttendanceWrite({
    levelAssignmentId: fx.assignmentId,
    balletScheduleId: fx.scheduleId,
    classDate: date,
    status: "absent",
    performedBy: "system",
    source: "autoAbsence",
    now: cairoAt(date, "18:05"),
  });

  let duplicateCode: string | undefined;
  await db.transaction(async (tx) => {
    try {
      await performBalletAttendanceWrite({
        levelAssignmentId: fx.assignmentId,
        balletScheduleId: fx.scheduleId,
        classDate: date,
        status: "absent",
        performedBy: "system",
        source: "autoAbsence",
        now: cairoAt(date, "18:05"),
        client: tx,
      });
    } catch (err) {
      duplicateCode = isBalletAttendanceError(err) ? err.code : undefined;
    }
  });
  assert.equal(duplicateCode, "duplicate_attendance");
});
