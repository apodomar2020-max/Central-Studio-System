import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_H4_ATTENDANCE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_h4_attendance";

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
process.env.STUDENT_JWT_SECRET = "test-student-secret";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `h4-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

let studentCounter = 0;
async function makeStudent(phone: string): Promise<{ id: number; email: string; name: string }> {
  studentCounter += 1;
  const email = `h4-student-${Date.now()}-${studentCounter}@example.com`;
  const name = `H4 Student ${studentCounter}`;
  const res = await pool.query<{ id: number }>(
    `INSERT INTO students (email, password_hash, name, phone, email_verified, date_of_birth, account_type)
     VALUES ($1, 'hash', $2, $3, true, '1995-05-15', 'parent')
     RETURNING id`,
    [email, name, phone],
  );
  return { id: res.rows[0].id, email, name };
}

async function makeChild(parentId: number, fullName: string, dob: string): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO children (parent_id, full_name, date_of_birth)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [parentId, fullName, dob],
  );
  return res.rows[0].id;
}

before(async () => {
  const express = (await import("express")).default;
  const jwtMod = await import("jsonwebtoken");
  jwtSign = (jwtMod.default as any)?.sign || jwtMod.sign;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const adminGateway = await import("./adminAttendanceGateway");

  app = express();
  app.use(express.json());
  app.use("/api", adminGateway.default);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });

  const adminRes = await pool.query<{ id: number }>(
    `INSERT INTO system_users (email, password_hash, username, full_name, is_super_admin)
     VALUES ('h4-admin@example.com', 'hash', 'h4admin', 'H4 Admin', true)
     RETURNING id`,
  );
  superAdminId = adminRes.rows[0].id;
});

after(async () => {
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
});

// ─── 1. Confirm-only Package Walk-in ──────────────────────────────────────────

test("Package Walk-in resolve performs zero writes; confirmation deducts exactly 1 credit atomically", async () => {
  const parent = await makeStudent("+201009990001");
  const childId = await makeChild(parent.id, "Walkin Child A", "2015-06-10");

  const classRes = await pool.query<{ id: number }>(
    `INSERT INTO classes (title, category, allow_all_ages) VALUES ('H4 Walkin Class', 'Hip-Hop', true) RETURNING id`,
  );
  const classId = classRes.rows[0].id;

  const todayRes = await pool.query<{ today: string }>(`SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text as today`);
  const today = todayRes.rows[0].today;

  const schedRes = await pool.query<{ id: number }>(
    `INSERT INTO schedules (class_id, day_of_week, start_time, end_time, price_egp, status, type, package_eligible)
     VALUES ($1, extract(dow from $2::date)::int, '00:00', '23:59', 250, 'active', 'weekly', true)
     RETURNING id`,
    [classId, today],
  );
  const scheduleId = schedRes.rows[0].id;

  const pkgRes = await pool.query<{ id: number }>(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status, participant_type, participant_child_id)
     VALUES ($1, $2, $3, 1, 'Walkin Pack', 5, 5, 'active', 'child', $4)
     RETURNING id`,
    [parent.name, parent.email, parent.id, childId],
  );
  const packageOrderId = pkgRes.rows[0].id;

  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, student_id, type, delta, balance_before, balance_after, participant_type, participant_child_id)
     VALUES ($1, $2, 'package_activated', 5, 0, 5, 'child', $3)`,
    [packageOrderId, parent.id, childId],
  );

  // Step 1: Resolve candidates (Zero writes)
  const resolveRes = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: "+201009990001" }),
  });
  assert.equal(resolveRes.status, 200);
  const resolveData = await jsonBody(resolveRes);
  const accounts = (resolveData.accounts as Array<any>) ?? [];
  assert.equal(accounts.length, 1);

  // Check balance before confirmation: must still be 5
  const balanceBefore = await pool.query<{ remaining_credits: number }>(
    `SELECT remaining_credits FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(balanceBefore.rows[0].remaining_credits, 5);

  const candidate = accounts[0].candidates.find((c: any) => c.walkinChildId === childId);
  assert.ok(candidate);
  assert.equal(candidate.hasPackageCredit, true);

  // Step 2: Confirm Attendance (Package Credit)
  const confirmRes = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey,
      program: "studio",
      accountId: parent.id,
      source: "phone",
      paymentMode: "package_credit",
      packageOrderId,
      scheduleId,
      childId,
    }),
  });
  if (confirmRes.status !== 201) {
    const errBody = await confirmRes.text();
    console.error("Test 1 Confirm Failed:", confirmRes.status, errBody);
  }
  assert.equal(confirmRes.status, 201);
  const confirmData = await jsonBody(confirmRes);
  assert.equal((confirmData.attendance as any).creditDeducted, true);
  assert.equal((confirmData.attendance as any).remainingCredits, 4);

  // Check balance after confirmation: must be 4, with 1 credit_transactions row
  const balanceAfter = await pool.query<{ remaining_credits: number }>(
    `SELECT remaining_credits FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(balanceAfter.rows[0].remaining_credits, 4);

  const txs = await pool.query(`SELECT * FROM credit_transactions WHERE package_order_id = $1 AND type = 'attendance_deduction'`, [packageOrderId]);
  assert.equal(txs.rows.length, 1);
  assert.equal(txs.rows[0].type, "attendance_deduction");
  assert.equal(txs.rows[0].delta, -1);
});

// ─── 2. Window-State Precedence & Ended Occurrence Protection ─────────────────

test("discovery evaluates windowState precedence: ended occurrence returns eligibility: ended", async () => {
  const parent = await makeStudent("+201009990002");
  const childId = await makeChild(parent.id, "H4 Child B", "2016-01-01");

  const classRes = await pool.query<{ id: number }>(
    `INSERT INTO classes (title, category, allow_all_ages) VALUES ('H4 Past Class', 'Kids Hip-Hop', true) RETURNING id`,
  );
  const classId = classRes.rows[0].id;

  const todayRes = await pool.query<{ today: string }>(`SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text as today`);
  const today = todayRes.rows[0].today;

  // Create an ended schedule earlier today (01:00 AM to 02:00 AM)
  const endedSchedRes = await pool.query<{ id: number }>(
    `INSERT INTO schedules (class_id, day_of_week, start_time, end_time, price_egp, status, type)
     VALUES ($1, extract(dow from $2::date)::int, '01:00', '02:00', 200, 'active', 'weekly')
     RETURNING id`,
    [classId, today],
  );
  const endedScheduleId = endedSchedRes.rows[0].id;

  // Create a pending package booking for the ended schedule
  const bookingRes = await pool.query<{ id: number }>(
    `INSERT INTO bookings (student_name, student_email, student_phone, participant_type, participant_child_id, class_id, schedule_id, occurrence_date, status, booking_status, payment_mode, account_owner_student_id)
     VALUES ($1, $2, '+201009990002', 'child', $3, $4, $5, $6, 'pending', 'pending', 'package_credit', $7)
     RETURNING id`,
    ["H4 Child B", parent.email, childId, classId, endedScheduleId, today, parent.id],
  );

  const resolveRes = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: "+201009990002" }),
  });
  assert.equal(resolveRes.status, 200);
  const resolveData = await jsonBody(resolveRes);
  const accounts = (resolveData.accounts as Array<any>) ?? [];
  const candidate = accounts[0]?.candidates.find((c: any) => c.bookingId === bookingRes.rows[0].id);

  assert.ok(candidate);
  // PRECEDENCE FIX VERIFICATION: Must be marked "ended" (Check-in closed), NOT "eligible"
  assert.equal(candidate.eligibility, "ended");
  assert.match(candidate.reason, /Check-in closed when the class ended/i);
});

// ─── 3. Duplicate Adult Bookings + Unrelated Child Booking Isolation ────────

test("duplicate adult bookings produce ambiguous status for adult but do not block unrelated valid child candidate", async () => {
  const parent = await makeStudent("+201009990003");
  const childId = await makeChild(parent.id, "H4 Child C", "2017-03-20");

  const classRes = await pool.query<{ id: number }>(
    `INSERT INTO classes (title, category, allow_all_ages) VALUES ('H4 Multi Booking Class', 'Adult Hip-Hop', true) RETURNING id`,
  );
  const classId = classRes.rows[0].id;

  const todayRes = await pool.query<{ today: string }>(`SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text as today`);
  const today = todayRes.rows[0].today;

  const schedRes = await pool.query<{ id: number }>(
    `INSERT INTO schedules (class_id, day_of_week, start_time, end_time, price_egp, status, type)
     VALUES ($1, extract(dow from $2::date)::int, '00:00', '23:59', 200, 'active', 'weekly')
     RETURNING id`,
    [classId, today],
  );
  const scheduleId = schedRes.rows[0].id;

  // Insert 2 active bookings for the ADULT (self) on the same schedule & occurrence date:
  // one with account_owner_student_id = parent.id and one legacy row with account_owner_student_id = null.
  // The DB unique index allows NULL as distinct, but buildStudioCandidates matches on student_email
  // and flags ambiguous_active_bookings.
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, student_phone, participant_type, participant_child_id, class_id, schedule_id, occurrence_date, status, booking_status, payment_mode, account_owner_student_id)
     VALUES ($1, $2, '+201009990003', 'self', null, $3, $4, $5, 'confirmed', 'confirmed', 'pay_at_studio', $6),
            ($1, $2, '+201009990003', 'self', null, $3, $4, $5, 'confirmed', 'confirmed', 'pay_at_studio', null)`,
    [parent.name, parent.email, classId, scheduleId, today, parent.id],
  );

  // Insert 1 valid booking for the CHILD on schedule 1
  const childBookingRes = await pool.query<{ id: number }>(
    `INSERT INTO bookings (student_name, student_email, student_phone, participant_type, participant_child_id, class_id, schedule_id, occurrence_date, status, booking_status, payment_mode, account_owner_student_id)
     VALUES ($1, $2, '+201009990003', 'child', $3, $4, $5, $6, 'confirmed', 'confirmed', 'pay_at_studio', $7)
     RETURNING id`,
    ["H4 Child C", parent.email, childId, classId, scheduleId, today, parent.id],
  );
  const childBookingId = childBookingRes.rows[0].id;

  const resolveRes = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: "+201009990003" }),
  });
  assert.equal(resolveRes.status, 200);
  const resolveData = await jsonBody(resolveRes);
  const candidates = (resolveData.accounts as Array<any>)[0]?.candidates ?? [];

  const adultBookingCandidates = candidates.filter((c: any) => c.participantType === "account" && c.bookingId != null);
  const childCandidates = candidates.filter((c: any) => c.participantType === "child" && c.bookingId != null);

  // Adult booking candidates show ambiguous_active_bookings
  assert.ok(adultBookingCandidates.length > 0);
  assert.ok(adultBookingCandidates.every((c: any) => c.eligibility === "ambiguous_active_bookings"));

  // Child candidate is eligible and distinct
  assert.equal(childCandidates.length, 1);
  const childCand = childCandidates[0];
  assert.equal(childCand.bookingId, childBookingId);
  assert.equal(childCand.eligibility, "eligible");

  // Confirming child candidate succeeds without cross-binding
  const confirmRes = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: childCand.candidateKey,
      program: "studio",
      accountId: parent.id,
      source: "phone",
      bookingId: childBookingId,
    }),
  });
  assert.equal(confirmRes.status, 201);
});

// ─── 4. Tampered Candidate Key Rejection ─────────────────────────────────────

test("tampered candidate key produces candidate_key_mismatch and 0 writes", async () => {
  const parent = await makeStudent("+201009990004");

  const classRes = await pool.query<{ id: number }>(
    `INSERT INTO classes (title, category, allow_all_ages) VALUES ('H4 Tamper Class', 'Contemporary', true) RETURNING id`,
  );
  const classId = classRes.rows[0].id;

  const todayRes = await pool.query<{ today: string }>(`SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text as today`);
  const today = todayRes.rows[0].today;

  const schedRes = await pool.query<{ id: number }>(
    `INSERT INTO schedules (class_id, day_of_week, start_time, end_time, price_egp, status, type)
     VALUES ($1, extract(dow from $2::date)::int, '00:00', '23:59', 200, 'active', 'weekly')
     RETURNING id`,
    [classId, today],
  );
  const scheduleId = schedRes.rows[0].id;

  const bookingRes = await pool.query<{ id: number }>(
    `INSERT INTO bookings (student_name, student_email, student_phone, participant_type, class_id, schedule_id, occurrence_date, status, booking_status, payment_mode, account_owner_student_id)
     VALUES ($1, $2, '+201009990004', 'self', $3, $4, $5, 'confirmed', 'confirmed', 'pay_at_studio', $6)
     RETURNING id`,
    [parent.name, parent.email, classId, scheduleId, today, parent.id],
  );

  // Submit with a tampered candidateKey
  const confirmRes = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: "studio:999999:999999:2099-01-01",
      program: "studio",
      accountId: parent.id,
      source: "phone",
      bookingId: bookingRes.rows[0].id,
    }),
  });
  assert.equal(confirmRes.status, 409);
  const body = await jsonBody(confirmRes);
  assert.equal(body.error, "candidate_key_mismatch");

  // Verify zero attendance records created
  const attCount = await pool.query(`SELECT count(*)::int as count FROM attendance WHERE student_id = $1`, [parent.id]);
  assert.equal(attCount.rows[0].count, 0);
});

// ─── 5. Cairo Timezone Boundaries ───────────────────────────────────────────

test("checkInWindowState calculates Cairo timezone boundaries correctly", async () => {
  const { checkInWindowState } = await import("../lib/occurrence");

  const schedule = { startTime: "14:00", endTime: "16:00" };
  const date = "2026-07-30";

  // 121 minutes before class start (11:58:59 Cairo = 08:58:59 UTC) -> too_early
  const tooEarlyDate = new Date("2026-07-30T08:58:59.000Z"); // 11:58:59 Cairo (121m1s before 14:00)
  assert.equal(checkInWindowState(schedule, date, tooEarlyDate), "too_early");

  // Exactly 120 minutes before class start (12:00 Cairo) -> open
  const openDate = new Date("2026-07-30T09:00:00.000Z"); // 12:00 Cairo
  assert.equal(checkInWindowState(schedule, date, openDate), "open");

  // Class end time (16:00 Cairo = 13:00 UTC) -> ended
  const endedDate = new Date("2026-07-30T13:00:00.000Z"); // 16:00 Cairo
  assert.equal(checkInWindowState(schedule, date, endedDate), "ended");

  // 1 minute after class end (16:01 Cairo = 13:01 UTC) -> ended
  const afterEndDate = new Date("2026-07-30T13:01:00.000Z"); // 16:01 Cairo
  assert.equal(checkInWindowState(schedule, date, afterEndDate), "ended");
});
