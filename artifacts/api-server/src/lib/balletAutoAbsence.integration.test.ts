/**
 * Real-database integration tests for the automatic Ballet absence job's
 * core work function, processBalletAutoAbsenceOccurrence — idempotency under
 * retries/concurrent execution, eligibility filtering, and interaction with
 * a pre-existing attendance row (scanner-wins race).
 *
 * planDueBalletAbsenceOccurrences() (the recurring planner) requires a live
 * Redis connection (REDIS_URL) to enqueue BullMQ jobs, which is not
 * available in this disposable-DB-only environment — its discovery query
 * (which schedules are due) is exercised separately below without
 * requiring Redis; full end-to-end queue enqueue/dequeue is not covered by
 * this file. Redis-backed BullMQ Job Scheduler dedup (queue.upsertJobScheduler)
 * already has an established, unmodified precedent elsewhere in this repo
 * (notification-automation, ballet-cancellation-finalization) that this
 * change reuses verbatim — see queue.ts.
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
delete process.env.REDIS_URL; // force queue-unavailable path for planDueBalletAbsenceOccurrences

let pool: import("pg").Pool;
let processBalletAutoAbsenceOccurrence: typeof import("./balletAutoAbsence.ts").processBalletAutoAbsenceOccurrence;
let planDueBalletAbsenceOccurrences: typeof import("./balletAutoAbsence.ts").planDueBalletAbsenceOccurrences;
let reconcileBalletAbsencePushDelivery: typeof import("./balletAutoAbsence.ts").reconcileBalletAbsencePushDelivery;
let processBalletAbsencePushDelivery: typeof import("./balletAutoAbsence.ts").processBalletAbsencePushDelivery;
let enqueueProcessOccurrence: typeof import("./balletAutoAbsence.ts").enqueueProcessOccurrence;
let enqueueAbsencePushDelivery: typeof import("./balletAutoAbsence.ts").enqueueAbsencePushDelivery;
let balletAbsenceOccurrenceJobId: typeof import("./balletAutoAbsence.ts").balletAbsenceOccurrenceJobId;
let balletAbsencePushJobId: typeof import("./balletAutoAbsence.ts").balletAbsencePushJobId;
let assertValidBullMqCustomJobId: typeof import("./balletAutoAbsence.ts").assertValidBullMqCustomJobId;
let BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS: number;
let cairoDateTimeToUtcMs: typeof import("./occurrence.ts").cairoDateTimeToUtcMs;

const CLASS_DATE = "2026-07-20"; // Monday, dayOfWeek=1

function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Converts a Cairo WALL-CLOCK date+time into the real UTC Date it
// represents, via the same ICU-driven conversion the production code uses —
// every test below must execute "at/after the occurrence's end time" for
// processBalletAutoAbsenceOccurrence to write anything (Section 6).
function cairoAt(dateOnly: string, time: string): Date {
  return new Date(cairoDateTimeToUtcMs(dateOnly, time));
}

// The fixture schedule below is 17:00-18:00 Cairo — this is comfortably
// after end time (17:00 + POST_END_GRACE_MS) for every test's classDate.
function afterEnd(date: string): Date {
  return cairoAt(date, "18:05");
}

interface Fixture {
  levelId: number;
  groupId: number;
  classId: number;
  scheduleId: number;
}
let fx: Fixture;

async function insertApplicationAssignment(
  childLabel: string,
  paid: boolean,
  linkedParent = true,
): Promise<{ applicationId: number; assignmentId: number; parentStudentId: number }> {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const parent = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000009', 'parent') RETURNING id`,
    [`Absence Test Parent ${childLabel}`, `absence-${childLabel}-${run}@example.com`],
  );
  const application = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status, assigned_level_id)
     VALUES ($1, $2, '0100000009', $3, $4, 'active', $5) RETURNING id`,
    [linkedParent ? parent.rows[0].id : null, `Absence Test Parent ${childLabel}`, `absence-${childLabel}-${run}@example.com`, `Absence Test Child ${childLabel}`, fx.levelId],
  );
  const assignment = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, group_id, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [application.rows[0].id, fx.levelId, fx.groupId],
  );
  if (paid) {
    const pkg = await pool.query(
      `INSERT INTO ballet_packages (name, monthly_classes, monthly_hours, price_egp, is_active) VALUES ($1, 8, 12, 2500, true) RETURNING id`,
      [`Absence Test Package ${run}`],
    );
    await pool.query(
      `INSERT INTO ballet_payments (application_id, package_id, amount_egp, status, payment_method, paid_at, subscription_start_date, subscription_expires_at)
       VALUES ($1, $2, 2500, 'paid', 'inPerson', now(), $3, $4)`,
      [application.rows[0].id, pkg.rows[0].id, addDays(CLASS_DATE, -10), addDays(CLASS_DATE, 365)],
    );
  }
  return { applicationId: application.rows[0].id, assignmentId: assignment.rows[0].id, parentStudentId: parent.rows[0].id };
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const mod = await import("./balletAutoAbsence.ts");
  processBalletAutoAbsenceOccurrence = mod.processBalletAutoAbsenceOccurrence;
  planDueBalletAbsenceOccurrences = mod.planDueBalletAbsenceOccurrences;
  reconcileBalletAbsencePushDelivery = mod.reconcileBalletAbsencePushDelivery;
  processBalletAbsencePushDelivery = mod.processBalletAbsencePushDelivery;
  enqueueProcessOccurrence = mod.enqueueProcessOccurrence;
  enqueueAbsencePushDelivery = mod.enqueueAbsencePushDelivery;
  balletAbsenceOccurrenceJobId = mod.balletAbsenceOccurrenceJobId;
  balletAbsencePushJobId = mod.balletAbsencePushJobId;
  assertValidBullMqCustomJobId = mod.assertValidBullMqCustomJobId;
  BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS = mod.BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS;
  const occurrenceModule = await import("./occurrence.ts");
  cairoDateTimeToUtcMs = occurrenceModule.cairoDateTimeToUtcMs;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const level = await pool.query(`SELECT id FROM ballet_levels ORDER BY id LIMIT 1`);
  fx = {} as Fixture;
  fx.levelId = level.rows[0].id;

  const group = await pool.query(`INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Absence Test Group ${run}`, fx.levelId]);
  fx.groupId = group.rows[0].id;

  const instructor = await pool.query(`INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`, [`Absence Test Instructor ${run}`]);
  const balletClass = await pool.query(
    `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active) VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
    [`Absence Test Class ${run}`, fx.levelId, fx.groupId, instructor.rows[0].id],
  );
  fx.classId = balletClass.rows[0].id;

  const schedule = await pool.query(
    `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status) VALUES ($1, 1, '17:00', '18:00', 60, 'active') RETURNING id`,
    [fx.classId],
  );
  fx.scheduleId = schedule.rows[0].id;
});

after(async () => {
  await pool.end();
});

test("linked parent commits Attendance, one durable Notification intent, and strict audit together", async () => {
  const { assignmentId, parentStudentId } = await insertApplicationAssignment("basic", true);
  const date = addDays(CLASS_DATE, 7);
  const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date));
  assert.equal(result.inserted, 1);
  assert.equal(result.insertedWithNotification, 1);
  assert.equal(result.insertedWithoutLinkedAccount, 0);
  assert.equal(result.skippedExisting, 0);

  const rows = await pool.query(
    `SELECT id, status, duration_minutes FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].status, "absent");
  assert.equal(rows.rows[0].duration_minutes, 60);

  const notifications = await pool.query(
    `SELECT id, target FROM notifications WHERE type = 'ballet_absence_recorded' AND related_entity_id = $1`,
    [rows.rows[0].id],
  );
  assert.equal(notifications.rows.length, 1);
  assert.equal(notifications.rows[0].target, `student:${parentStudentId}`);

  const audits = await pool.query(
    `SELECT after FROM admin_activity_logs WHERE entity_type = 'ballet_attendance' AND entity_id = $1`,
    [String(rows.rows[0].id)],
  );
  assert.equal(audits.rows.length, 1);
  assert.equal(audits.rows[0].after.notificationOutcome, "created");
});

test("no linked parent commits Attendance plus explicit no-recipient audit and no Notification", async () => {
  const { assignmentId } = await insertApplicationAssignment("unlinked", true, false);
  const date = addDays(CLASS_DATE, 7);
  const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date));

  const attendance = await pool.query(
    `SELECT id, status FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(attendance.rows.length, 1);
  assert.equal(attendance.rows[0].status, "absent");
  assert.ok(result.insertedWithoutLinkedAccount >= 1);

  const notifications = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE type = 'ballet_absence_recorded' AND related_entity_id = $1`,
    [attendance.rows[0].id],
  );
  assert.equal(notifications.rows[0].n, 0);

  const audits = await pool.query(
    `SELECT after FROM admin_activity_logs WHERE entity_type = 'ballet_attendance' AND entity_id = $1`,
    [String(attendance.rows[0].id)],
  );
  assert.equal(audits.rows.length, 1);
  assert.equal(audits.rows[0].after.notificationOutcome, "unavailable_no_linked_account");
});

test("linked-parent Notification insertion failure rolls back Attendance for only that student", async () => {
  const label = `notification-failure-${Date.now()}`;
  const { assignmentId } = await insertApplicationAssignment(label, true);
  const date = addDays(CLASS_DATE, 14);
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_fail_absence_notification_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.type = 'ballet_absence_recorded' AND NEW.body LIKE '%${label}%' THEN
        RAISE EXCEPTION 'forced notification insert failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_fail_absence_notification_insert
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION test_fail_absence_notification_insert();
  `);
  try {
    const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date));
    assert.ok(result.failed >= 1);
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
      [assignmentId, fx.scheduleId, date],
    );
    assert.equal(rows.rows[0].n, 0);
  } finally {
    await pool.query(`DROP TRIGGER test_fail_absence_notification_insert ON notifications; DROP FUNCTION test_fail_absence_notification_insert()`);
  }
});

test("strict audit failure rolls back linked and unlinked automatic absences independently", async () => {
  const linkedLabel = `audit-linked-failure-${Date.now()}`;
  const unlinkedLabel = `audit-unlinked-failure-${Date.now()}`;
  const linked = await insertApplicationAssignment(linkedLabel, true);
  const unlinked = await insertApplicationAssignment(unlinkedLabel, true, false);
  const unaffected = await insertApplicationAssignment(`audit-unaffected-${Date.now()}`, true);
  const date = addDays(CLASS_DATE, 21);
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_fail_absence_audit_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.entity_type = 'ballet_attendance'
         AND (NEW.entity_label LIKE '%${linkedLabel}%' OR NEW.entity_label LIKE '%${unlinkedLabel}%') THEN
        RAISE EXCEPTION 'forced strict audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_fail_absence_audit_insert
      BEFORE INSERT ON admin_activity_logs
      FOR EACH ROW EXECUTE FUNCTION test_fail_absence_audit_insert();
  `);
  try {
    const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date));
    assert.ok(result.failed >= 2);
    for (const assignmentId of [linked.assignmentId, unlinked.assignmentId]) {
      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
        [assignmentId, fx.scheduleId, date],
      );
      assert.equal(rows.rows[0].n, 0);
    }
    const unaffectedRows = await pool.query(
      `SELECT status FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
      [unaffected.assignmentId, fx.scheduleId, date],
    );
    assert.deepEqual(unaffectedRows.rows, [{ status: "absent" }]);
  } finally {
    await pool.query(`DROP TRIGGER test_fail_absence_audit_insert ON admin_activity_logs; DROP FUNCTION test_fail_absence_audit_insert()`);
  }
});

test("skips (does not mark absent) an assignment with no active paid subscription", async () => {
  const { assignmentId } = await insertApplicationAssignment("unpaid", false);
  const date = addDays(CLASS_DATE, 14);
  const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date));
  assert.equal(result.skippedIneligible >= 1, true);

  const rows = await pool.query(
    `SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows[0].n, 0);
});

test("a pre-existing checked_in row prevents the absence job from writing anything (scanner wins the race)", async () => {
  const { assignmentId } = await insertApplicationAssignment("prechecked", true);
  const date = addDays(CLASS_DATE, 21);
  await pool.query(
    `INSERT INTO attendance (ballet_level_assignment_id, ballet_schedule_id, ballet_class_id, class_date, status, duration_minutes, student_name, student_email, checked_in_by)
     VALUES ($1, $2, $3, $4, 'checked_in', 60, 'Precheck', 'precheck@example.com', 'test')`,
    [assignmentId, fx.scheduleId, fx.classId, date],
  );

  // NOTE: this test file shares one Group across tests, so by this point the
  // Group may contain other, unrelated eligible assignments from earlier
  // tests (each legitimately due its own absent row for this new date) —
  // result.inserted/skippedExisting are therefore GROUP-WIDE aggregates, not
  // scoped to this test's own assignment. The scanner-wins-the-race claim is
  // proven precisely by the assignment-scoped DB assertions below instead.
  await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date));

  const rows = await pool.query(
    `SELECT status FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows.length, 1, "must never produce a second row alongside the existing checked_in one");
  assert.equal(rows.rows[0].status, "checked_in", "existing checked_in must never be overwritten to absent");
});

test("running the processor twice for the same occurrence (retry simulation) inserts exactly one absent row", async () => {
  const { assignmentId } = await insertApplicationAssignment("retry", true);
  const date = addDays(CLASS_DATE, 28);

  // Same group-wide-aggregate caveat as above: other eligible assignments
  // accumulated from earlier tests are legitimately processed too, so the
  // proof of "never zero or two for THIS assignment" is the assignment-
  // scoped DB assertion below, not the raw combined inserted counts.
  await Promise.all([
    processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date)),
    processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date)),
  ]);

  const rows = await pool.query(
    `SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3 AND status = 'absent'`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows[0].n, 1);
});

test("cancelled schedule produces zero absences", async () => {
  const cancelledSchedule = await pool.query(
    `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status) VALUES ($1, 1, '19:00', '20:00', 60, 'cancelled') RETURNING id`,
    [fx.classId],
  );
  const { assignmentId } = await insertApplicationAssignment("cancelledsched", true);
  const date = addDays(CLASS_DATE, 35);
  const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: cancelledSchedule.rows[0].id, classDate: date }, cairoAt(date, "20:05"));
  assert.equal(result.inserted, 0);
  assert.equal(result.assignmentsChecked, 0, "a cancelled schedule must never even be resolved to a Group/assignment lookup");

  const rows = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1`, [assignmentId]);
  assert.equal(rows.rows[0].n, 0);
});

// ─── Section 6 — execution-time re-validation ──────────────────────────────

test("executing before the occurrence's end time writes nothing and reports rescheduled=true", async () => {
  const { assignmentId } = await insertApplicationAssignment("early", true);
  const date = addDays(CLASS_DATE, 42);
  const result = await processBalletAutoAbsenceOccurrence(
    { balletScheduleId: fx.scheduleId, classDate: date },
    cairoAt(date, "12:00"), // hours before the 17:00 start, let alone the 18:00 end
  );
  assert.equal(result.rescheduled, true);
  assert.equal(result.inserted, 0);
  assert.equal(result.assignmentsChecked, 0, "must never even look at candidate assignments before the occurrence has ended");

  const rows = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1`, [assignmentId]);
  assert.equal(rows.rows[0].n, 0);
});

test("executing exactly at the end time (before the post-end grace) still writes an absence", async () => {
  // Same group-wide-aggregate caveat as the earlier tests in this file: by
  // this point the shared Group also contains other still-eligible
  // assignments from prior tests (e.g. "early", never yet given a row for
  // THIS new date) — result.inserted is a group-wide aggregate, so the proof
  // is the assignment-scoped DB assertion below, not the raw count.
  const { assignmentId } = await insertApplicationAssignment("exactend", true);
  const date = addDays(CLASS_DATE, 49);
  const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, cairoAt(date, "18:00"));
  assert.equal(result.rescheduled, false, "18:00 IS the occurrence's real end instant — not before it");
  const rows = await pool.query(
    `SELECT status FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].status, "absent");
});

test("a classDate that no longer matches the Schedule's current day of week is skipped — no absence, no crash", async () => {
  const { assignmentId } = await insertApplicationAssignment("weekdaymismatch", true);
  // fx.scheduleId has dayOfWeek=1 (Monday); this classDate is a Tuesday.
  const wrongDayDate = addDays(CLASS_DATE, 1);
  const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: wrongDayDate }, afterEnd(wrongDayDate));
  assert.equal(result.diagnostic, "weekday_mismatch");
  assert.equal(result.inserted, 0);
  assert.equal(result.assignmentsChecked, 0);

  const rows = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1`, [assignmentId]);
  assert.equal(rows.rows[0].n, 0);
});

test("a malformed classDate is rejected with a safe diagnostic, never crashes the job", async () => {
  for (const classDate of ["not-a-date", "2026-02-30"]) {
    const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate });
    assert.equal(result.diagnostic, "invalid_class_date");
    assert.equal(result.inserted, 0);
  }
});

test("Ballet Auto Absence custom job IDs are deterministic, distinct, and colon-free", () => {
  const pushA = balletAbsencePushJobId(101);
  const pushARepeat = balletAbsencePushJobId(101);
  const pushB = balletAbsencePushJobId(102);
  assert.equal(pushA, "ballet-absence-push-101");
  assert.equal(pushA, pushARepeat);
  assert.notEqual(pushA, pushB);
  assert.equal(pushA.includes(":"), false);

  const occurrenceA = balletAbsenceOccurrenceJobId(11, "2026-07-20");
  const occurrenceARepeat = balletAbsenceOccurrenceJobId(11, "2026-07-20");
  const occurrenceOtherDate = balletAbsenceOccurrenceJobId(11, "2026-07-27");
  const occurrenceOtherSchedule = balletAbsenceOccurrenceJobId(12, "2026-07-20");
  assert.equal(occurrenceA, "ballet-auto-absence-11-2026-07-20");
  assert.equal(occurrenceA, occurrenceARepeat);
  assert.notEqual(occurrenceA, occurrenceOtherDate);
  assert.notEqual(occurrenceA, occurrenceOtherSchedule);
  assert.equal(occurrenceA.includes(":"), false);

  assert.throws(
    () => assertValidBullMqCustomJobId("ballet-absence-push:101"),
    /custom jobId must not contain ':'/,
  );
  assert.throws(() => balletAbsenceOccurrenceJobId(11, "2026-02-30"), /canonical ISO class date/);
});

test("occurrence and push enqueue boundaries use canonical IDs and deduplicate repeats", async () => {
  const jobs = new Map<string, { getState(): Promise<string>; retry(): Promise<void> }>();
  const added: { name: string; jobId: string }[] = [];
  const queue = {
    getJob: async (jobId: string) => jobs.get(jobId) ?? null,
    add: async (name: string, _data: unknown, opts: { jobId?: string }) => {
      assert.ok(opts.jobId);
      const job = {
        getState: async () => "waiting",
        retry: async () => undefined,
      };
      jobs.set(opts.jobId, job);
      added.push({ name, jobId: opts.jobId });
      return job;
    },
  };
  const typedQueue = queue as unknown as Parameters<typeof enqueueProcessOccurrence>[0];

  assert.equal(await enqueueProcessOccurrence(typedQueue, 21, "2026-07-20", 0), "enqueued");
  assert.equal(await enqueueProcessOccurrence(typedQueue, 21, "2026-07-20", 0), "duplicate");
  assert.equal(await enqueueProcessOccurrence(typedQueue, 21, "2026-07-27", 0), "enqueued");
  assert.equal(await enqueueProcessOccurrence(typedQueue, 22, "2026-07-20", 0), "enqueued");
  assert.equal(await enqueueAbsencePushDelivery(301, typedQueue), "enqueued");
  assert.equal(await enqueueAbsencePushDelivery(301, typedQueue), "duplicate");
  assert.equal(await enqueueAbsencePushDelivery(302, typedQueue), "enqueued");

  assert.deepEqual(added, [
    { name: "process_occurrence", jobId: balletAbsenceOccurrenceJobId(21, "2026-07-20") },
    { name: "process_occurrence", jobId: balletAbsenceOccurrenceJobId(21, "2026-07-27") },
    { name: "process_occurrence", jobId: balletAbsenceOccurrenceJobId(22, "2026-07-20") },
    { name: "deliver_absence_push", jobId: balletAbsencePushJobId(301) },
    { name: "deliver_absence_push", jobId: balletAbsencePushJobId(302) },
  ]);
  assert.ok(added.every(({ jobId }) => !jobId.includes(":")));
});

test("future, out-of-horizon, and mismatched deterministic job dates are rejected before student writes", async () => {
  const future = addDays(CLASS_DATE, 7);
  const futureResult = await processBalletAutoAbsenceOccurrence(
    { balletScheduleId: fx.scheduleId, classDate: future },
    afterEnd(CLASS_DATE),
    { jobId: balletAbsenceOccurrenceJobId(fx.scheduleId, future) },
  );
  assert.equal(futureResult.diagnostic, "future_occurrence");

  const beyondHorizonNow = afterEnd(addDays(CLASS_DATE, BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS + 1));
  const oldResult = await processBalletAutoAbsenceOccurrence(
    { balletScheduleId: fx.scheduleId, classDate: CLASS_DATE },
    beyondHorizonNow,
    { jobId: balletAbsenceOccurrenceJobId(fx.scheduleId, CLASS_DATE) },
  );
  assert.equal(oldResult.diagnostic, "outside_recovery_horizon");

  const identityResult = await processBalletAutoAbsenceOccurrence(
    { balletScheduleId: fx.scheduleId, classDate: CLASS_DATE },
    afterEnd(CLASS_DATE),
    { jobId: balletAbsenceOccurrenceJobId(fx.scheduleId + 1, CLASS_DATE) },
  );
  assert.equal(identityResult.diagnostic, "job_identity_mismatch");
});

test("early Worker execution delegates one active-job delay to the authoritative end instant and writes no absence", async () => {
  const { assignmentId } = await insertApplicationAssignment("early-reschedule", true);
  const date = addDays(CLASS_DATE, 63);
  const sentinel = new Error("delayed-by-test-worker");
  const requestedTimestamps: number[] = [];
  await assert.rejects(
    processBalletAutoAbsenceOccurrence(
      { balletScheduleId: fx.scheduleId, classDate: date },
      cairoAt(date, "12:00"),
      {
        jobId: balletAbsenceOccurrenceJobId(fx.scheduleId, date),
        rescheduleAt: async (timestamp): Promise<never> => {
          requestedTimestamps.push(timestamp);
          throw sentinel;
        },
      },
    ),
    (err: unknown) => err === sentinel,
  );
  assert.deepEqual(requestedTimestamps, [cairoDateTimeToUtcMs(date, "18:00") + 45_000]);
  const rows = await pool.query(
    `SELECT count(*)::int AS n FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows[0].n, 0);
});

test("queued status and duration fields are ignored; canonical absent status and Schedule duration are stored", async () => {
  const { assignmentId } = await insertApplicationAssignment("queued-fields", true);
  const date = addDays(CLASS_DATE, 70);
  await processBalletAutoAbsenceOccurrence(
    { balletScheduleId: fx.scheduleId, classDate: date, status: "checked_in", durationMinutes: 1 } as unknown as { balletScheduleId: number; classDate: string },
    afterEnd(date),
    { jobId: balletAbsenceOccurrenceJobId(fx.scheduleId, date) },
  );
  const rows = await pool.query(
    `SELECT status, duration_minutes FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [assignmentId, fx.scheduleId, date],
  );
  assert.equal(rows.rows.length, 1);
  assert.deepEqual(rows.rows[0], { status: "absent", duration_minutes: 60 });
});

// ─── Section 10 — per-student failure isolation ────────────────────────────

test("one assignment with no linked child (structural mismatch) does not abort the rest of the occurrence", async () => {
  const date = addDays(CLASS_DATE, 56);
  const { assignmentId: goodAssignmentId } = await insertApplicationAssignment("isolation-good", true);
  const { applicationId: badApplicationId } = await insertApplicationAssignment("isolation-bad", true);

  // Force a structural mismatch: give the application a linked childId that
  // does NOT match its level assignment's childId — performBalletAttendanceWrite
  // rejects this as child_mismatch, a per-student business error that must
  // not abort the rest of the occurrence.
  const unrelatedParent = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Isolation Mismatch Parent', $1, '0100000010', 'parent') RETURNING id`,
    [`isolation-mismatch-${Date.now()}@example.com`],
  );
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name) VALUES ($1, 'Isolation Mismatch Child') RETURNING id`,
    [unrelatedParent.rows[0].id],
  );
  await pool.query(`UPDATE ballet_applications SET child_id = $1 WHERE id = $2`, [child.rows[0].id, badApplicationId]);

  const result = await processBalletAutoAbsenceOccurrence({ balletScheduleId: fx.scheduleId, classDate: date }, afterEnd(date));
  assert.equal(result.skippedIneligible >= 1, true, "the mismatched assignment must be bucketed as ineligible, not crash the job");

  const goodRows = await pool.query(
    `SELECT status FROM attendance WHERE ballet_level_assignment_id = $1 AND ballet_schedule_id = $2 AND class_date = $3`,
    [goodAssignmentId, fx.scheduleId, date],
  );
  assert.equal(goodRows.rows.length, 1, "the unrelated, valid assignment must still get its absence recorded");
  assert.equal(goodRows.rows[0].status, "absent");
});

// ─── Section 7 — bounded recovery-horizon reconciliation (planner discovery) ─

test("the recovery horizon is a positive, bounded, named constant (not a 20-minute cutoff)", () => {
  assert.ok(Number.isInteger(BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS));
  assert.ok(BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS >= 1, "must cover at least a full missed weekly occurrence");
});

test("planner discovery finds today's due schedule even without a live queue (discovery is queue-independent)", async () => {
  // now = just after today's occurrence would have ended, using CLASS_DATE's
  // own weekday so today's Cairo date resolves to a Monday matching fx.scheduleId.
  const now = afterEnd(CLASS_DATE);
  const result = await planDueBalletAbsenceOccurrences(now);
  assert.equal(result.enqueued, 0, "queue is unavailable (no REDIS_URL) — must fail closed on enqueue only, never throw");
  assert.ok(result.scheduleIds.includes(fx.scheduleId), "discovery must still find today's due schedule even though nothing could be enqueued");
});

test("planner reconciliation walks back within the recovery horizon and discovers the EXACT occurrence due N days ago", async () => {
  // "now" is HORIZON days after CLASS_DATE — CLASS_DATE itself sits exactly
  // at daysBack = HORIZON from "now" and must still be discovered by the
  // bounded past-reconciliation sweep, proving a Worker outage of up to the
  // configured horizon is recoverable, not silently missed. Asserting on the
  // precise (scheduleId, date) pair — not just scheduleIds — rules out a
  // false pass from this weekly schedule's NEXT recurrence happening to also
  // fall inside the window.
  const now = afterEnd(addDays(CLASS_DATE, BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS));
  const result = await planDueBalletAbsenceOccurrences(now);
  const found = result.occurrences.some((o) => o.balletScheduleId === fx.scheduleId && o.classDate === CLASS_DATE);
  assert.ok(found, "an occurrence exactly at the edge of the recovery horizon must still be discovered by (scheduleId, exact date)");
});

test("an occurrence older than the recovery horizon is outside the bounded sweep (not silently mis-scanned as recovered)", async () => {
  // "now" is HORIZON+1 days after CLASS_DATE — one day OLDER than the
  // bounded day-loop can reach (daysBack only goes 0..HORIZON), so this
  // specific (scheduleId, CLASS_DATE) pair must be structurally absent from
  // discovery. This is the documented, intentional boundary (Section 7):
  // occurrences past it need a manual admin backfill, not automatic
  // recovery — never a silent, unbounded full-history scan.
  const now = afterEnd(addDays(CLASS_DATE, BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS + 1));
  const result = await planDueBalletAbsenceOccurrences(now);
  const found = result.occurrences.some((o) => o.balletScheduleId === fx.scheduleId && o.classDate === CLASS_DATE);
  assert.equal(found, false, "an occurrence one day beyond the recovery horizon must never be discovered by the bounded sweep");
});

test("planner discovery query runs without a live Redis connection and reports zero enqueued", async () => {
  const result = await planDueBalletAbsenceOccurrences(new Date());
  assert.equal(result.enqueued, 0, "queue is unavailable (no REDIS_URL) — must fail closed, never throw");
  assert.equal(Array.isArray(result.scheduleIds), true);
});

// ─── Section 9 — push delivery reconciliation ──────────────────────────────

// attendanceIdSeed only needs to be unique enough to produce a collision-free
// reminderIdempotencyKey across runs against the same persistent disposable
// DB — derived from Date.now()+random, matching this file's other fixtures.
function uniqueAttendanceIdSeed(): number {
  // Stays comfortably within Postgres int4 range (max ~2.1 billion).
  return Math.floor(Date.now() % 1_000_000) * 1000 + Math.floor(Math.random() * 1000);
}

async function insertBalletAbsenceNotification(studentId: number, attendanceIdSeed: number): Promise<number> {
  const notification = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, is_draft, sent_at, reminder_idempotency_key)
     VALUES ('Absence recorded', 'test', $1, 'ballet_absence_recorded', 'attendance', $2, false, now(), $3) RETURNING id`,
    [`student:${studentId}`, attendanceIdSeed, `ballet_absence:${attendanceIdSeed}`],
  );
  return notification.rows[0].id;
}

async function insertDeliveryLog(notificationId: number, status: "sent" | "failed" | "skipped", errorCode: string | null = null): Promise<void> {
  await pool.query(
    `INSERT INTO notification_delivery_logs (notification_id, status, error_code) VALUES ($1, $2, $3)`,
    [notificationId, status, errorCode],
  );
}

test("reconciliation enqueues missing/failed delivery with safe IDs and leaves sent/skipped terminal", async () => {
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Reconcile Job IDs', $1, '0100000024', 'parent') RETURNING id`,
    [`reconcile-job-ids-${Date.now()}@example.com`],
  );
  const missingId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());
  const failedId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());
  const sentId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());
  const skippedId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());
  await insertDeliveryLog(failedId, "failed", "transient_fcm_error");
  await insertDeliveryLog(sentId, "sent");
  await insertDeliveryLog(skippedId, "skipped", "no_active_device");

  const addedJobIds: string[] = [];
  const queue = {
    getJob: async () => null,
    add: async (_name: string, _data: unknown, opts: { jobId?: string }) => {
      assert.ok(opts.jobId);
      addedJobIds.push(opts.jobId);
      return { id: opts.jobId };
    },
  } as unknown as Parameters<typeof enqueueProcessOccurrence>[0];

  const notificationCountBefore = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE id = ANY($1::int[])`,
    [[missingId, failedId, sentId, skippedId]],
  );
  await reconcileBalletAbsencePushDelivery(new Date(), queue);
  const notificationCountAfter = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE id = ANY($1::int[])`,
    [[missingId, failedId, sentId, skippedId]],
  );

  assert.ok(addedJobIds.includes(balletAbsencePushJobId(missingId)));
  assert.ok(addedJobIds.includes(balletAbsencePushJobId(failedId)));
  assert.equal(addedJobIds.includes(balletAbsencePushJobId(sentId)), false);
  assert.equal(addedJobIds.includes(balletAbsencePushJobId(skippedId)), false);
  assert.ok(addedJobIds.every((jobId) => !jobId.includes(":")));
  assert.equal(notificationCountBefore.rows[0].n, 4);
  assert.equal(notificationCountAfter.rows[0].n, 4, "reconciliation must not create duplicate logical Notifications");
});

test("two reconcilers may discover the same missing delivery while two processors call the provider only once", async () => {
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Reconcile Concurrent', $1, '0100000020', 'parent') RETURNING id`,
    [`reconcile-concurrent-${Date.now()}@example.com`],
  );
  const notificationId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());
  const discoveries = await Promise.all([
    reconcileBalletAbsencePushDelivery(),
    reconcileBalletAbsencePushDelivery(),
  ]);
  assert.ok(discoveries.every((result) => result.scanned >= 1));

  let providerCalls = 0;
  const sender: import("./balletAutoAbsence.ts").AbsencePushSender = async (notification) => {
    providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    await insertDeliveryLog(notification.id, "sent");
    return "push_sent";
  };
  const results = await Promise.all([
    processBalletAbsencePushDelivery(notificationId, sender),
    processBalletAbsencePushDelivery(notificationId, sender),
  ]);
  assert.equal(providerCalls, 1, "the PostgreSQL advisory claim must serialize provider calls");
  assert.deepEqual(results.map((result) => result.outcome).sort(), ["sent", "sent"]);
});

test("missing delivery state is retryable and later sent state is terminal", async () => {
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Reconcile Missing', $1, '0100000021', 'parent') RETURNING id`,
    [`reconcile-missing-${Date.now()}@example.com`],
  );
  const notificationId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());

  let calls = 0;
  const sender: import("./balletAutoAbsence.ts").AbsencePushSender = async (notification) => {
    calls += 1;
    await insertDeliveryLog(notification.id, "sent");
    return "push_sent";
  };
  assert.equal((await processBalletAbsencePushDelivery(notificationId, sender)).outcome, "sent");
  assert.equal((await processBalletAbsencePushDelivery(notificationId, sender)).outcome, "sent");
  assert.equal(calls, 1);
});

test("latest skipped state is terminal, including failed followed by skipped", async () => {
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Reconcile Skipped', $1, '0100000022', 'parent') RETURNING id`,
    [`reconcile-skipped-${Date.now()}@example.com`],
  );
  const notificationId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());
  await insertDeliveryLog(notificationId, "failed", "transient_fcm_error");
  await insertDeliveryLog(notificationId, "skipped", "no_active_device");
  let calls = 0;
  const result = await processBalletAbsencePushDelivery(notificationId, async () => {
    calls += 1;
    return "push_sent";
  });
  assert.equal(result.outcome, "skipped");
  assert.equal(calls, 0);
});

test("latest failed state retries, while latest sent state never retries", async () => {
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Reconcile Sent', $1, '0100000023', 'parent') RETURNING id`,
    [`reconcile-sent-${Date.now()}@example.com`],
  );
  const notificationId = await insertBalletAbsenceNotification(student.rows[0].id, uniqueAttendanceIdSeed());
  await insertDeliveryLog(notificationId, "skipped", "no_active_device");
  await insertDeliveryLog(notificationId, "failed", "transient_fcm_error");
  let calls = 0;
  const sender: import("./balletAutoAbsence.ts").AbsencePushSender = async (notification) => {
    calls += 1;
    await insertDeliveryLog(notification.id, "sent");
    return "push_sent";
  };
  assert.equal((await processBalletAbsencePushDelivery(notificationId, sender)).outcome, "sent");
  assert.equal(calls, 1);
  assert.equal((await processBalletAbsencePushDelivery(notificationId, sender)).outcome, "sent");
  assert.equal(calls, 1);
});
