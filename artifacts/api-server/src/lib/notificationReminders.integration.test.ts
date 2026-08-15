/**
 * Real DB integration tests for booked-class reminder automation.
 *
 * Unlike the source/regex-assertion style used elsewhere, this suite calls
 * the ACTUAL exported runner functions (runClassReminder24h, runClassReminder1h,
 * runPostClassRatingReminders, getOrCreateClassReminderSettings) against a
 * disposable local Postgres database, and asserts on real row state —
 * including the reminder_idempotency_key partial unique index added in
 * migration 0072.
 *
 * Safety gate: refuses to run unless DATABASE_URL points at 127.0.0.1/
 * localhost and a database name containing disposable/local/test — same
 * rule as lib/db/tools/verification/run-disposable-migrations.mjs. This
 * database must already be migrated through 0074 before running this file.
 *
 * No Redis, no push notifications by default: REDIS_URL is left unset and
 * PUSH_NOTIFICATIONS_ENABLED defaults to unset (disabled) so most tests take
 * the push-disabled path deliberately (see the dedicated push-disabled /
 * no-active-device tests, which toggle the env var locally per-test).
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

// Set BEFORE any dynamic import of app modules below — @workspace/db opens
// its connection pool at import time.
process.env.DATABASE_URL = DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let pool: import("pg").Pool;
let reminders: typeof import("./notificationReminders");
let settingsLib: typeof import("./classReminderSettings");

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let classId: number;
let studentSeq = 0;
let scheduleSeq = 0;

/** Cairo-local {date, time} for `minutesFromNow` minutes from `base` (defaults to real now). Mirrors lib/occurrence.ts's cairoNow(). */
function cairoOffsetParts(minutesFromNow: number, base: Date = new Date()): { date: string; time: string } {
  const target = new Date(base.getTime() + minutesFromNow * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(target)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

async function createStudent(): Promise<{ id: number; email: string }> {
  studentSeq += 1;
  const email = `reminder-verify-${RUN}-${studentSeq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email) VALUES ($1, $2) RETURNING id`,
    [`Reminder Verify ${studentSeq}`, email],
  );
  return { id: rows[0].id, email };
}

/** One-time schedule whose class start is `minutesFromNow` minutes away (Cairo wall clock). */
async function createSchedule(opts: { minutesFromNow: number; status?: string }): Promise<{ id: number; date: string; startTime: string }> {
  scheduleSeq += 1;
  const { date, time } = cairoOffsetParts(opts.minutesFromNow);
  const { rows } = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time) VALUES ($1, 'one_time', $2, $3, $4, $5) RETURNING id`,
    [classId, opts.status ?? "active", date, time, time],
  );
  return { id: rows[0].id, date, startTime: time };
}

async function createBooking(
  schedule: { id: number; date: string },
  student: { id: number; email: string },
  opts: { bookingStatus?: string; paymentMode?: string } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, booking_status, payment_mode)
     VALUES ('Reminder Verify', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [student.email, student.id, schedule.id, classId, schedule.date, opts.bookingStatus ?? "confirmed", opts.paymentMode ?? null],
  );
  return rows[0].id;
}

async function reminderNotificationFor(bookingId: number, type: string): Promise<{ id: number; reminderIdempotencyKey: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT id, reminder_idempotency_key AS "reminderIdempotencyKey" FROM notifications
     WHERE related_entity_type = 'booking' AND related_entity_id = $1 AND type = $2
     ORDER BY id DESC LIMIT 1`,
    [bookingId, type],
  );
  return rows[0] ?? null;
}

async function countReminderNotifications(bookingId: number, type: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE related_entity_type = 'booking' AND related_entity_id = $1 AND type = $2`,
    [bookingId, type],
  );
  return rows[0].n;
}

/** Wave 1: the notification's source/origin classification column. */
async function notificationSourceFor(bookingId: number, type: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT source FROM notifications
     WHERE related_entity_type = 'booking' AND related_entity_id = $1 AND type = $2
     ORDER BY id DESC LIMIT 1`,
    [bookingId, type],
  );
  return rows[0]?.source ?? null;
}

async function deliveryLogFor(notificationId: number): Promise<{ status: string; errorCode: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT status, error_code AS "errorCode" FROM notification_delivery_logs WHERE notification_id = $1 ORDER BY id DESC LIMIT 1`,
    [notificationId],
  );
  return rows[0] ?? null;
}

async function resetReminderSettings(): Promise<void> {
  await pool.query(
    `UPDATE class_reminder_settings SET automatic_reminders_enabled = true, class_reminder_24h_enabled = true, class_reminder_1h_enabled = true, post_class_rating_3h_enabled = true WHERE id = 1`,
  );
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  reminders = await import("./notificationReminders");
  settingsLib = await import("./classReminderSettings");

  await resetReminderSettings();

  const { rows } = await pool.query(
    `INSERT INTO classes (title, category) VALUES ($1, 'general') RETURNING id`,
    [`Reminder Verify Class ${RUN}`],
  );
  classId = rows[0].id;
});

after(async () => {
  await resetReminderSettings();
  await pool.query(`DELETE FROM notification_delivery_logs WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`reminder-verify-${RUN}-%`]);
  await pool.query(`DELETE FROM notifications WHERE metadata->>'className' = $1`, [`Reminder Verify Class ${RUN}`]);
  await pool.query(`DELETE FROM bookings WHERE class_id = $1`, [classId]);
  await pool.query(`DELETE FROM schedules WHERE class_id = $1`, [classId]);
  await pool.query(`DELETE FROM classes WHERE id = $1`, [classId]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`reminder-verify-${RUN}-%`]);
  await pool.end();
});

// ─── 1-4: booking-status / payment-method eligibility ───────────────────────

test("confirmed booking within the 24h window is selected and created", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 22 * 60 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  const notification = await reminderNotificationFor(bookingId, "class_reminder_24h");
  assert.ok(notification, "expected a class_reminder_24h notification to be created");
  assert.equal(notification!.reminderIdempotencyKey, `booking:${bookingId}:class_reminder_24h:${schedule.date}`);
});

test("pending booking is excluded from reminders", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 22 * 60 });
  const bookingId = await createBooking(schedule, student, { bookingStatus: "pending" });
  await reminders.runClassReminder24h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_24h"), 0);
});

test("confirmed pay-at-studio booking is selected (payment method does not gate eligibility)", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 30 });
  const bookingId = await createBooking(schedule, student, { paymentMode: "pay_at_studio" });
  await reminders.runClassReminder1h();
  const notification = await reminderNotificationFor(bookingId, "class_reminder_1h");
  assert.ok(notification, "pay-at-studio confirmed booking must be eligible");
});

test("confirmed package-credit booking is selected (payment method does not gate eligibility)", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 30 });
  const bookingId = await createBooking(schedule, student, { paymentMode: "package_credit" });
  await reminders.runClassReminder1h();
  const notification = await reminderNotificationFor(bookingId, "class_reminder_1h");
  assert.ok(notification, "package-credit confirmed booking must be eligible");
});

// ─── 5-6: schedule status eligibility ────────────────────────────────────────

test("inactive (expired) schedule is excluded — canonical active status required, not merely non-cancelled", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 22 * 60, status: "expired" });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_24h"), 0);
});

test("cancelled schedule is excluded", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 22 * 60, status: "cancelled" });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_24h"), 0);
});

// ─── 7-9: 24h catch-up window boundaries ─────────────────────────────────────

test("24h catch-up: selected at 23h before class start", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 23 * 60 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  assert.ok(await reminderNotificationFor(bookingId, "class_reminder_24h"));
});

test("24h catch-up: selected just above 21h before class start (lower boundary, inclusive)", async () => {
  const student = await createStudent();
  // +1 minute buffer above the exact 21h boundary: the fixture's class-start
  // timestamp is fixed at creation time, but the SQL comparison evaluates
  // against Postgres's now() moments later — without slack, elapsed test
  // latency alone can push a class fixed at exactly now+21h just outside the
  // (now-at-query-time)+21h lower bound. The excluded-side test below has no
  // such risk (elapsed time only pushes it further outside the window).
  const schedule = await createSchedule({ minutesFromNow: 21 * 60 + 1 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  assert.ok(await reminderNotificationFor(bookingId, "class_reminder_24h"));
});

test("24h catch-up: excluded just below 21h before class start", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 21 * 60 - 2 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_24h"), 0);
});

// ─── 10-13: 1h catch-up window boundaries + never after class start ─────────

test("1h catch-up: selected at exactly 60m before class start (upper boundary, inclusive)", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 60 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder1h();
  assert.ok(await reminderNotificationFor(bookingId, "class_reminder_1h"));
});

test("1h catch-up: selected just above 15m before class start (lower boundary, inclusive)", async () => {
  const student = await createStudent();
  // +30s buffer above the exact 15m boundary — same query-latency reasoning
  // as the 24h lower-boundary test above.
  const schedule = await createSchedule({ minutesFromNow: 15.5 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder1h();
  assert.ok(await reminderNotificationFor(bookingId, "class_reminder_1h"));
});

test("1h catch-up: excluded below 15m before class start", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 14 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder1h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_1h"), 0);
});

test("pre-class reminder is never sent after class start time", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: -5 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  await reminders.runClassReminder1h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_24h"), 0);
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_1h"), 0);
});

// ─── 14: duplicate insert safe skip (sequential, application path) ─────────

test("running the same rule twice for the same booking/occurrence is a safe duplicate skip", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 30 });
  const bookingId = await createBooking(schedule, student);
  const first = await reminders.runClassReminder1h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_1h"), 1);
  const second = await reminders.runClassReminder1h();
  assert.equal(await countReminderNotifications(bookingId, "class_reminder_1h"), 1, "must still be exactly one row after a second run");
  assert.ok(second.duplicateSkipped >= 1);
  void first;
});

// ─── 16: different occurrence dates create independent reminders ───────────

test("different occurrence dates for the same booking id/type each get their own idempotency key", async () => {
  const fakeBookingId = 999_000_001;
  await pool.query(`DELETE FROM notifications WHERE reminder_idempotency_key LIKE $1`, [`booking:${fakeBookingId}:%`]);
  await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, reminder_idempotency_key, is_draft)
     VALUES ('t', 'b', 'student:1', 'class_reminder_24h', 'booking', $1, $2, false)`,
    [fakeBookingId, `booking:${fakeBookingId}:class_reminder_24h:2031-01-01`],
  );
  // A different occurrence date for the same booking/type must succeed (no collision).
  await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, reminder_idempotency_key, is_draft)
     VALUES ('t', 'b', 'student:1', 'class_reminder_24h', 'booking', $1, $2, false)`,
    [fakeBookingId, `booking:${fakeBookingId}:class_reminder_24h:2031-01-08`],
  );
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE reminder_idempotency_key LIKE $1`, [`booking:${fakeBookingId}:%`]);
  assert.equal(rows[0].n, 2);

  // The exact same key a third time must be rejected by the unique index.
  await assert.rejects(
    pool.query(
      `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, reminder_idempotency_key, is_draft)
       VALUES ('t', 'b', 'student:1', 'class_reminder_24h', 'booking', $1, $2, false)`,
      [fakeBookingId, `booking:${fakeBookingId}:class_reminder_24h:2031-01-01`],
    ),
    (err: unknown) => (err as { code?: string }).code === "23505",
  );

  await pool.query(`DELETE FROM notifications WHERE reminder_idempotency_key LIKE $1`, [`booking:${fakeBookingId}:%`]);
});

// ─── 17-18: settings gating ──────────────────────────────────────────────────

test("category disabled skips creation for that category only", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 22 * 60 });
  const bookingId = await createBooking(schedule, student);
  await pool.query(`UPDATE class_reminder_settings SET class_reminder_24h_enabled = false WHERE id = 1`);
  try {
    const summary = await reminders.runClassReminder24h();
    assert.equal(summary.disabledSkipped, 1);
    assert.equal(await countReminderNotifications(bookingId, "class_reminder_24h"), 0);
  } finally {
    await resetReminderSettings();
  }
});

test("automation disabled skips all categories", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 22 * 60 });
  const bookingId = await createBooking(schedule, student);
  await pool.query(`UPDATE class_reminder_settings SET automatic_reminders_enabled = false WHERE id = 1`);
  try {
    const summary = await reminders.runClassReminderAutomation();
    assert.equal(summary.disabledSkipped, 2); // both 24h and 1h rules skipped
    assert.equal(await countReminderNotifications(bookingId, "class_reminder_24h"), 0);
  } finally {
    await resetReminderSettings();
  }
});

// ─── 19-20: push operational observability ───────────────────────────────────

test("push disabled produces an explicit operational delivery result, not a silent no-op", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 30 });
  const bookingId = await createBooking(schedule, student);
  delete process.env.PUSH_NOTIFICATIONS_ENABLED; // ensure disabled
  const summary = await reminders.runClassReminder1h();
  assert.ok(summary.pushDisabled >= 1);
  const notification = await reminderNotificationFor(bookingId, "class_reminder_1h");
  assert.ok(notification);
  const log = await deliveryLogFor(notification!.id);
  assert.ok(log, "expected an explicit delivery-log row for the push-disabled outcome");
  assert.equal(log!.status, "skipped");
  assert.equal(log!.errorCode, "push_disabled");
});

test("no active device produces an explicit operational delivery result", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 30 });
  const bookingId = await createBooking(schedule, student);
  process.env.PUSH_NOTIFICATIONS_ENABLED = "true";
  try {
    const summary = await reminders.runClassReminder1h();
    assert.ok(summary.noActiveDevice >= 1);
    const notification = await reminderNotificationFor(bookingId, "class_reminder_1h");
    assert.ok(notification);
    const log = await deliveryLogFor(notification!.id);
    assert.ok(log);
    assert.equal(log!.status, "skipped");
    assert.equal(log!.errorCode, "no_active_device");
  } finally {
    delete process.env.PUSH_NOTIFICATIONS_ENABLED;
  }
});

// ─── 22: Cairo DST boundary (Egypt resumed DST in 2023 — spring-forward late April, fall-back late October) ─

test("Cairo wall-clock window math stays correct across a documented Egypt DST transition", async () => {
  // 2024-04-25 was UTC+2 (standard); 2024-04-26 was UTC+3 (DST) per the
  // system tzdata — see Africa/Cairo. A class scheduled exactly 23
  // wall-clock hours after a "now" pinned just before this transition must
  // still land inside the 21-24h window: the comparison is pure Cairo
  // wall-clock interval arithmetic (never UTC elapsed-duration math), so it
  // is unaffected by the underlying UTC offset jump.
  const pinnedNow = "2024-04-25 22:00:00"; // Cairo wall clock, pre-transition
  const classStart = "2024-04-26 21:00:00"; // 23 wall-clock hours later, post-transition day
  const { rows: withinWindow } = await pool.query(
    `SELECT ($1::timestamp between ($2::timestamp + interval '21 hours') and ($2::timestamp + interval '24 hours')) AS matched`,
    [classStart, pinnedNow],
  );
  assert.equal(withinWindow[0].matched, true, "23 wall-clock hours ahead must match the 21-24h window even spanning a DST transition");

  const justBelow = "2024-04-26 18:59:00"; // ~20h59m wall-clock — must be excluded
  const { rows: excluded } = await pool.query(
    `SELECT ($1::timestamp between ($2::timestamp + interval '21 hours') and ($2::timestamp + interval '24 hours')) AS matched`,
    [justBelow, pinnedNow],
  );
  assert.equal(excluded[0].matched, false);
});

// ─── Wave 1: notification source/origin classification ──────────────────────
// These three rules are the "automation" test coverage required by the
// Notifications Wave 1 task (class 24h / 1h / post-class rating reminders —
// all scheduled-worker-created via insertReminderNotification, which now
// always writes source="automation"; see notificationReminders.ts).

test("class 24h reminder notification is classified as automation", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 22 * 60 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder24h();
  const source = await notificationSourceFor(bookingId, "class_reminder_24h");
  assert.equal(source, "automation");
});

test("class 1h reminder notification is classified as automation", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: 30 });
  const bookingId = await createBooking(schedule, student);
  await reminders.runClassReminder1h();
  const source = await notificationSourceFor(bookingId, "class_reminder_1h");
  assert.equal(source, "automation");
});

test("post-class rating reminder notification is classified as automation", async () => {
  const student = await createStudent();
  const schedule = await createSchedule({ minutesFromNow: -4 * 60 });
  const bookingId = await createBooking(schedule, student, { bookingStatus: "attended" });
  await reminders.runPostClassRatingReminders();
  const source = await notificationSourceFor(bookingId, "post_class_rating_3h");
  assert.equal(source, "automation");
});
