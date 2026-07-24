/**
 * Real-database integration tests for the Studio Walk-in write engine
 * (studioWalkIn.ts). Covers the required proofs from the consolidation
 * spec: Package Credit reuses the existing lock/ledger, Paid at Studio
 * derives price from the canonical source and lands in Booking (the table
 * Dashboard revenue already reads — see financialAggregates.ts), Not Paid
 * is a true no-op, duplicate/ownership/window/active-Schedule validation,
 * and concurrent-confirmation safety via the advisory lock.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { eq, and } from "drizzle-orm";

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
let attendanceTable: typeof import("@workspace/db").attendanceTable;
let creditTransactionsTable: typeof import("@workspace/db").creditTransactionsTable;
let adminActivityLogsTable: typeof import("@workspace/db").adminActivityLogsTable;
let listStudioWalkInOptions: typeof import("./studioWalkIn.ts").listStudioWalkInOptions;
let performStudioWalkInCheckIn: typeof import("./studioWalkIn.ts").performStudioWalkInCheckIn;
let computeStudioWalkInCandidateKey: typeof import("./studioWalkIn.ts").computeStudioWalkInCandidateKey;
let isCheckInError: typeof import("./studioWalkIn.ts").isCheckInError;
let cairoDateTimeToUtcMs: typeof import("./occurrence.ts").cairoDateTimeToUtcMs;

function cairoAt(dateOnly: string, time: string): Date {
  return new Date(cairoDateTimeToUtcMs(dateOnly, time));
}

const OCCURRENCE_DATE = "2026-08-10";
const testActor = { actorId: 1, actorName: "Test Admin", actorEmail: "test-admin@example.com", ipAddress: null, userAgent: null };

let run: string;
let accountId: number;
let accountEmail: string;
let childId: number;
let otherAccountId: number;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  db = dbModule.db;
  bookingsTable = dbModule.bookingsTable;
  attendanceTable = dbModule.attendanceTable;
  creditTransactionsTable = dbModule.creditTransactionsTable;
  adminActivityLogsTable = dbModule.adminActivityLogsTable;
  const svc = await import("./studioWalkIn.ts");
  listStudioWalkInOptions = svc.listStudioWalkInOptions;
  performStudioWalkInCheckIn = svc.performStudioWalkInCheckIn;
  computeStudioWalkInCandidateKey = svc.computeStudioWalkInCandidateKey;
  isCheckInError = svc.isCheckInError;
  const occurrenceModule = await import("./occurrence.ts");
  cairoDateTimeToUtcMs = occurrenceModule.cairoDateTimeToUtcMs;

  run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  accountEmail = `walkin-${run}@example.com`;
  const account = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Walk-in Test Account', $1, '0100000098', 'parent') RETURNING id`,
    [accountEmail],
  );
  accountId = account.rows[0].id;

  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name) VALUES ($1, 'Walk-in Test Child') RETURNING id`,
    [accountId],
  );
  childId = child.rows[0].id;

  const other = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Other Account', $1, '0100000097', 'parent') RETURNING id`,
    [`walkin-other-${run}@example.com`],
  );
  otherAccountId = other.rows[0].id;

  await pool.query(`UPDATE class_pricing_settings SET single_class_price_egp = 250 WHERE id = 1`);
});

after(async () => {
  await pool.end();
});

async function makeClassAndSchedule(opts: {
  startTime: string;
  endTime: string;
  priceEgp?: number | null;
  classIsActive?: boolean;
  scheduleStatus?: string;
  instructorIsActive?: boolean;
  packageEligible?: boolean;
  date?: string;
}): Promise<{ classId: number; scheduleId: number }> {
  const instructor = await pool.query(
    `INSERT INTO instructors (name, is_active) VALUES ('Walk-in Instructor', $1) RETURNING id`,
    [opts.instructorIsActive ?? true],
  );
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ('Walk-in Class', 'general', $1, $2) RETURNING id`,
    [instructor.rows[0].id, opts.classIsActive ?? true],
  );
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time, price_egp, package_eligible)
     VALUES ($1, 'one_time', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      klass.rows[0].id,
      opts.scheduleStatus ?? "active",
      opts.date ?? OCCURRENCE_DATE,
      opts.startTime,
      opts.endTime,
      opts.priceEgp ?? null,
      opts.packageEligible ?? true,
    ],
  );
  return { classId: klass.rows[0].id, scheduleId: schedule.rows[0].id };
}

async function makeActivePackage(studentEmail: string, remainingCredits: number): Promise<number> {
  const pkg = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, package_name, total_credits, remaining_credits, status)
     VALUES ('Walk-in Test', $1, 'Walk-in Package', 10, $2, 'active') RETURNING id`,
    [studentEmail, remainingCredits],
  );
  return pkg.rows[0].id;
}

test("listStudioWalkInOptions surfaces an open Schedule and excludes it once Attendance exists", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "12:00", endTime: "13:00" });
  const now = cairoAt(OCCURRENCE_DATE, "12:30");
  const options = await listStudioWalkInOptions(accountId, null, now);
  assert.ok(options.some((o) => o.scheduleId === scheduleId));

  const result = await performStudioWalkInCheckIn({
    accountId,
    participantChildId: null,
    classId,
    scheduleId,
    occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" },
    actor: testActor,
    now,
  });
  assert.ok(!("notPaid" in result));

  const after = await listStudioWalkInOptions(accountId, null, now);
  assert.ok(!after.some((o) => o.scheduleId === scheduleId));
});

test("Package Credit path deducts one credit via the existing ledger and creates no Paid-at-Studio booking", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "14:00", endTime: "15:00" });
  const packageOrderId = await makeActivePackage(accountEmail, 5);
  const now = cairoAt(OCCURRENCE_DATE, "14:10");

  const result = await performStudioWalkInCheckIn({
    accountId,
    participantChildId: null,
    classId,
    scheduleId,
    occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "package_credit", packageOrderId },
    actor: testActor,
    now,
  });
  assert.ok(!("notPaid" in result));
  if ("notPaid" in result) throw new Error("unreachable");
  assert.equal(result.paymentSource, "package_credit");
  assert.equal(result.creditDeducted, true);
  assert.equal(result.remainingCredits, 4);

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, result.bookingId));
  assert.equal(booking.paymentMode, "package_credit");
  assert.equal(booking.paymentStatus, "not_required");
  assert.equal(booking.bookingStatus, "attended");

  const [ledgerRow] = await db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.packageOrderId, packageOrderId));
  assert.equal(ledgerRow.delta, -1);
  assert.equal(ledgerRow.balanceAfter, 4);

  const remaining = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(remaining.rows[0].remaining_credits, 4);
});

test("Paid at Studio path derives the canonical price, marks the Booking paid, and never deducts a Credit", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "16:00", endTime: "17:00", priceEgp: 400 });
  const now = cairoAt(OCCURRENCE_DATE, "16:05");

  const result = await performStudioWalkInCheckIn({
    accountId,
    participantChildId: null,
    classId,
    scheduleId,
    occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" },
    actor: testActor,
    now,
  });
  if ("notPaid" in result) throw new Error("unreachable");
  assert.equal(result.paymentSource, "pay_at_studio");
  assert.equal(result.priceEgp, 400);
  assert.equal(result.creditDeducted, false);

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, result.bookingId));
  assert.equal(booking.paymentStatus, "paid");
  assert.equal(booking.paymentMode, "pay_at_studio");

  // Exactly the query financialAggregates.ts uses for grossGenericBookingRevenueEgp.
  const revenue = await pool.query(
    `select coalesce(sum(coalesce(s.price_egp, cps.single_class_price_egp)), 0)::int as total
     from bookings b
     join schedules s on s.id = b.schedule_id
     cross join class_pricing_settings cps
     where cps.id = 1 and b.id = $1 and b.payment_status = 'paid' and b.payment_mode in ('pay_at_studio','online_payment')`,
    [booking.id],
  );
  assert.equal(revenue.rows[0].total, 400);
});

test("Paid at Studio falls back to the global single-Class price when the Schedule has none", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "18:00", endTime: "19:00", priceEgp: null });
  const now = cairoAt(OCCURRENCE_DATE, "18:05");
  const result = await performStudioWalkInCheckIn({
    accountId,
    participantChildId: null,
    classId,
    scheduleId,
    occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" },
    actor: testActor,
    now,
  });
  if ("notPaid" in result) throw new Error("unreachable");
  assert.equal(result.priceEgp, 250);
});

test("Not Paid is a pure no-op — no Attendance, Booking, Payment, or Credit mutation of any kind", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "20:00", endTime: "21:00" });
  const now = cairoAt(OCCURRENCE_DATE, "20:05");

  const bookingCountBeforeResult = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE class_id = $1`, [classId]);
  const attendanceCountBeforeResult = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE class_id = $1`, [classId]);
  const [bookingCountBefore] = bookingCountBeforeResult.rows;
  const [attendanceCountBefore] = attendanceCountBeforeResult.rows;

  const result = await performStudioWalkInCheckIn({
    accountId,
    participantChildId: null,
    classId,
    scheduleId,
    occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "not_paid" },
    actor: testActor,
    now,
  });
  assert.deepEqual(result, { notPaid: true });

  const bookingCountAfterResult = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE class_id = $1`, [classId]);
  const attendanceCountAfterResult = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE class_id = $1`, [classId]);
  const [bookingCountAfter] = bookingCountAfterResult.rows;
  const [attendanceCountAfter] = attendanceCountAfterResult.rows;
  assert.equal(bookingCountAfter.n, bookingCountBefore.n);
  assert.equal(attendanceCountAfter.n, attendanceCountBefore.n);
});

test("duplicate Walk-in for the same participant + Schedule + occurrence is rejected", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "09:00", endTime: "10:00" });
  const now = cairoAt(OCCURRENCE_DATE, "09:10");
  await performStudioWalkInCheckIn({
    accountId, participantChildId: null, classId, scheduleId, occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" }, actor: testActor, now,
  });
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId, participantChildId: null, classId, scheduleId, occurrenceDate: OCCURRENCE_DATE,
      payment: { type: "paid_at_studio" }, actor: testActor, now,
    }),
    (err: unknown) => isCheckInError(err) && err.code === "duplicate_attendance",
  );
});

test("a child not belonging to the resolved account is rejected — no cross-account write", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "11:00", endTime: "12:00" });
  const now = cairoAt(OCCURRENCE_DATE, "11:10");
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId: otherAccountId, participantChildId: childId, classId, scheduleId, occurrenceDate: OCCURRENCE_DATE,
      payment: { type: "paid_at_studio" }, actor: testActor, now,
    }),
    (err: unknown) => isCheckInError(err) && err.code === "booking_mismatch",
  );
});

test("too-early and ended windows are rejected; the exact open boundary succeeds", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "17:00", endTime: "18:00" });
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId, participantChildId: null, classId, scheduleId, occurrenceDate: OCCURRENCE_DATE,
      payment: { type: "paid_at_studio" }, actor: testActor, now: cairoAt(OCCURRENCE_DATE, "14:59"),
    }),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_too_early",
  );

  const { scheduleId: scheduleId2, classId: classId2 } = await makeClassAndSchedule({ startTime: "17:00", endTime: "18:00" });
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId, participantChildId: null, classId: classId2, scheduleId: scheduleId2, occurrenceDate: OCCURRENCE_DATE,
      payment: { type: "paid_at_studio" }, actor: testActor, now: cairoAt(OCCURRENCE_DATE, "18:00"),
    }),
    (err: unknown) => isCheckInError(err) && err.code === "check_in_closed",
  );

  const { scheduleId: scheduleId3, classId: classId3 } = await makeClassAndSchedule({ startTime: "17:00", endTime: "18:00" });
  const result = await performStudioWalkInCheckIn({
    accountId, participantChildId: null, classId: classId3, scheduleId: scheduleId3, occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" }, actor: testActor, now: cairoAt(OCCURRENCE_DATE, "15:00"),
  });
  if ("notPaid" in result) throw new Error("unreachable");
  assert.ok(result.attendanceId > 0);
});

test("an inactive Class or cancelled Schedule is rejected, and never listed as a Walk-in option", async () => {
  const { classId: inactiveClassId, scheduleId: sched1 } = await makeClassAndSchedule({ startTime: "08:00", endTime: "09:00", classIsActive: false });
  const now1 = cairoAt(OCCURRENCE_DATE, "08:10");
  const options1 = await listStudioWalkInOptions(accountId, null, now1);
  assert.ok(!options1.some((o) => o.scheduleId === sched1));
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId, participantChildId: null, classId: inactiveClassId, scheduleId: sched1, occurrenceDate: OCCURRENCE_DATE,
      payment: { type: "paid_at_studio" }, actor: testActor, now: now1,
    }),
    (err: unknown) => isCheckInError(err) && err.code === "booking_not_actionable",
  );

  const { classId: cancelledClassId, scheduleId: sched2 } = await makeClassAndSchedule({ startTime: "08:00", endTime: "09:00", scheduleStatus: "cancelled" });
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId, participantChildId: null, classId: cancelledClassId, scheduleId: sched2, occurrenceDate: OCCURRENCE_DATE,
      payment: { type: "paid_at_studio" }, actor: testActor, now: cairoAt(OCCURRENCE_DATE, "08:10"),
    }),
    (err: unknown) => isCheckInError(err) && err.code === "booking_not_actionable",
  );
});

test("a candidateKey identity that no longer matches the re-derived occurrence is rejected (server never trusts the client date)", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "10:00", endTime: "11:00" });
  const staleKey = computeStudioWalkInCandidateKey(accountId, null, classId, scheduleId, "2020-01-01");
  assert.notEqual(staleKey, computeStudioWalkInCandidateKey(accountId, null, classId, scheduleId, OCCURRENCE_DATE));
  // performStudioWalkInCheckIn itself re-derives occurrenceDate server-side —
  // the route layer is what actually compares candidateKey; this proves the
  // service rejects a client-supplied occurrenceDate that no longer matches
  // what the Schedule authoritatively resolves to right now.
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId, participantChildId: null, classId, scheduleId, occurrenceDate: "2020-01-01",
      payment: { type: "paid_at_studio" }, actor: testActor, now: cairoAt(OCCURRENCE_DATE, "10:10"),
    }),
    (err: unknown) => isCheckInError(err) && err.code === "candidate_key_mismatch",
  );
});

test("two concurrent Walk-in confirmations for the identical identity produce exactly one Attendance row", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "13:00", endTime: "14:00" });
  const now = cairoAt(OCCURRENCE_DATE, "13:10");
  const attempt = () => performStudioWalkInCheckIn({
    accountId, participantChildId: null, classId, scheduleId, occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" }, actor: testActor, now,
  }).then((r) => ({ ok: true as const, r })).catch((err: unknown) => ({ ok: false as const, err }));

  const [a, b] = await Promise.all([attempt(), attempt()]);
  const successes = [a, b].filter((x) => x.ok);
  const failures = [a, b].filter((x) => !x.ok);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  if (!failures[0].ok) assert.ok(isCheckInError(failures[0].err) && failures[0].err.code === "duplicate_attendance");

  const rows = await db.select().from(attendanceTable).where(and(eq(attendanceTable.classId, classId), eq(attendanceTable.status, "checked_in")));
  assert.equal(rows.length, 1);
});

test("a participant with a Booking for Class A can still Walk-in to a different Schedule B", async () => {
  const { classId: classIdA, scheduleId: scheduleIdA } = await makeClassAndSchedule({ startTime: "07:00", endTime: "08:00" });
  const { classId: classIdB, scheduleId: scheduleIdB } = await makeClassAndSchedule({ startTime: "07:30", endTime: "08:30" });
  const now = cairoAt(OCCURRENCE_DATE, "07:35");

  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_child_id, booking_scope, schedule_id, class_id, occurrence_date, status, booking_status, payment_status, payment_mode)
     VALUES ('Walk-in Test Account', $1, $2, NULL, 'self', $3, $4, $5, 'confirmed', 'confirmed', 'paid', 'pay_at_studio')`,
    [accountEmail, accountId, scheduleIdA, classIdA, OCCURRENCE_DATE],
  );

  // Schedule B (no Booking for this participant) must still be a valid Walk-in option.
  const options = await listStudioWalkInOptions(accountId, null, now);
  assert.ok(options.some((o) => o.scheduleId === scheduleIdB));

  const result = await performStudioWalkInCheckIn({
    accountId, participantChildId: null, classId: classIdB, scheduleId: scheduleIdB, occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" }, actor: testActor, now,
  });
  assert.ok(!("notPaid" in result));
});

test("a participant cannot Walk-in to the exact occurrence already covered by an eligible Booking", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "06:00", endTime: "07:00" });
  const now = cairoAt(OCCURRENCE_DATE, "06:10");

  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_child_id, booking_scope, schedule_id, class_id, occurrence_date, status, booking_status, payment_status, payment_mode)
     VALUES ('Walk-in Test Account', $1, $2, NULL, 'self', $3, $4, $5, 'confirmed', 'confirmed', 'paid', 'pay_at_studio')`,
    [accountEmail, accountId, scheduleId, classId, OCCURRENCE_DATE],
  );

  // The already-booked occurrence must never appear as a Walk-in option...
  const options = await listStudioWalkInOptions(accountId, null, now);
  assert.ok(!options.some((o) => o.scheduleId === scheduleId));

  // ...and a direct confirm attempt (bypassing the options list) is rejected server-side.
  await assert.rejects(
    performStudioWalkInCheckIn({
      accountId, participantChildId: null, classId, scheduleId, occurrenceDate: OCCURRENCE_DATE,
      payment: { type: "paid_at_studio" }, actor: testActor, now,
    }),
    (err: unknown) => isCheckInError(err) && err.code === "booking_exists_use_normal_checkin",
  );
});

test("one child can have a Booking while a sibling independently uses Walk-in", async () => {
  const { classId: classIdA, scheduleId: scheduleIdA } = await makeClassAndSchedule({ startTime: "05:00", endTime: "06:00" });
  const { classId: classIdB, scheduleId: scheduleIdB } = await makeClassAndSchedule({ startTime: "05:00", endTime: "06:00" });
  const now = cairoAt(OCCURRENCE_DATE, "05:10");

  const sibling = await pool.query(
    `INSERT INTO children (parent_id, full_name) VALUES ($1, 'Walk-in Sibling Child') RETURNING id`,
    [accountId],
  );
  const siblingChildId = sibling.rows[0].id;

  // childId (the primary test child) has a Booking for Schedule A.
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_child_id, booking_scope, schedule_id, class_id, occurrence_date, status, booking_status, payment_status, payment_mode)
     VALUES ('Walk-in Test Child', $1, $2, $3, 'child', $4, $5, $6, 'confirmed', 'confirmed', 'paid', 'pay_at_studio')`,
    [accountEmail, accountId, childId, scheduleIdA, classIdA, OCCURRENCE_DATE],
  );

  // The sibling has no Booking at all — Walk-in to Schedule B must be unaffected.
  const siblingOptions = await listStudioWalkInOptions(accountId, siblingChildId, now);
  assert.ok(siblingOptions.some((o) => o.scheduleId === scheduleIdB));

  const result = await performStudioWalkInCheckIn({
    accountId, participantChildId: siblingChildId, classId: classIdB, scheduleId: scheduleIdB, occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" }, actor: testActor, now,
  });
  assert.ok(!("notPaid" in result));

  // And childId's own Schedule A stays excluded (still routed through the normal Booking).
  const childOptions = await listStudioWalkInOptions(accountId, childId, now);
  assert.ok(!childOptions.some((o) => o.scheduleId === scheduleIdA));
});

test("the strict audit record is written for a successful Walk-in and links back to the Attendance row", async () => {
  const { classId, scheduleId } = await makeClassAndSchedule({ startTime: "19:00", endTime: "20:00" });
  const now = cairoAt(OCCURRENCE_DATE, "19:10");
  const result = await performStudioWalkInCheckIn({
    accountId, participantChildId: null, classId, scheduleId, occurrenceDate: OCCURRENCE_DATE,
    payment: { type: "paid_at_studio" }, actor: testActor, now,
  });
  if ("notPaid" in result) throw new Error("unreachable");

  const [log] = await db
    .select()
    .from(adminActivityLogsTable)
    .where(and(eq(adminActivityLogsTable.entityType, "attendance"), eq(adminActivityLogsTable.entityId, String(result.attendanceId))));
  assert.ok(log);
  assert.equal(log.action, "checkIn");
  assert.equal((log.after as Record<string, unknown>).source, "unified_gateway_walk_in");
  assert.equal((log.after as Record<string, unknown>).paymentSource, "pay_at_studio");
});
