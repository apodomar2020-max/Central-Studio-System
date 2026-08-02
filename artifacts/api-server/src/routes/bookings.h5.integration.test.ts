import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_H5_ATTENDANCE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_h5_attendance";

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
  return jwtSign({ sub: superAdminId, username: `h5-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

function studentToken(studentId: number, email: string): string {
  const secret = process.env.STUDENT_JWT_SECRET ?? "dev-student-secret-change-in-production";
  return jwtSign({ sub: studentId, email, type: "student", emailVerified: true }, secret);
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(),
      ...(init.headers || {}),
    },
  });
}

async function asStudent(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
}

async function jsonBody(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

async function makeStudent(phoneSuffix: string, accountType: "student" | "parent" = "student"): Promise<{ id: number; name: string; email: string; phone: string }> {
  const name = `H5 Student ${phoneSuffix}`;
  const email = `h5_${phoneSuffix}_${Date.now()}@example.com`;
  const phone = `+2010${phoneSuffix.padStart(8, "0")}`;
  const res = await pool.query<{ id: number }>(
    `INSERT INTO students (name, email, phone, email_verified, account_type, password_hash, date_of_birth)
     VALUES ($1, $2, $3, true, $4, 'hash', '1995-05-15')
     RETURNING id`,
    [name, email, phone, accountType],
  );
  return { id: res.rows[0].id, name, email, phone };
}

async function makeChild(parentId: number, name: string): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO children (parent_id, full_name, date_of_birth)
     VALUES ($1, $2, '2015-05-15')
     RETURNING id`,
    [parentId, name],
  );
  return res.rows[0].id;
}

async function makeClassAndSchedule(): Promise<{ classId: number; scheduleId: number; branchId: number; roomId: number; today: string }> {
  const todayRes = await pool.query<{ today: string; start_time: string }>(
    `SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text as today,
            to_char((now() AT TIME ZONE 'Africa/Cairo') + interval '5 minutes', 'HH24:MI') as start_time`,
  );
  const today = todayRes.rows[0].today;
  const startTime = todayRes.rows[0].start_time;
  const clsRes = await pool.query<{ id: number }>(
    `INSERT INTO classes (title, category, is_active, allow_all_ages) VALUES ('H5 Ballet Class', 'Ballet', true, true) RETURNING id`,
  );
  const classId = clsRes.rows[0].id;
  const branch = await pool.query<{ id: number }>(
    `INSERT INTO studio_branches (name) VALUES ($1) RETURNING id`,
    [`H5 Branch ${Date.now()}-${Math.random()}`],
  );
  const room = await pool.query<{ id: number }>(
    `INSERT INTO studio_rooms (branch_id, name) VALUES ($1, $2) RETURNING id`,
    [branch.rows[0].id, `H5 Room ${Date.now()}-${Math.random()}`],
  );
  const schedRes = await pool.query<{ id: number }>(
    `INSERT INTO schedules (class_id, branch_id, room_id, day_of_week, start_time, end_time, price_egp, status, type)
     VALUES ($1, $2, $3, extract(dow from $4::date)::int, $5, '23:59', 200, 'active', 'weekly') RETURNING id`,
    [classId, branch.rows[0].id, room.rows[0].id, today, startTime],
  );
  return { classId, scheduleId: schedRes.rows[0].id, branchId: branch.rows[0].id, roomId: room.rows[0].id, today };
}

async function makePackage(studentId: number, participantType: "self" | "child", participantChildId: number | null = null, credits = 5): Promise<number> {
  const pkgRes = await pool.query<{ id: number }>(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status, participant_type, participant_child_id)
     VALUES ('H5 Pack Owner', 'pkg@example.com', $1, 1, 'H5 Pack', $2, $2, 'active', $3, $4)
     RETURNING id`,
    [studentId, credits, participantType, participantChildId],
  );
  const packageOrderId = pkgRes.rows[0].id;

  const activation = await pool.query<{ id: number }>(
    `INSERT INTO credit_transactions (package_order_id, student_id, type, delta, balance_before, balance_after, participant_type, participant_child_id)
     VALUES ($1, $2, 'package_activated', $3, 0, $3, $4, $5) RETURNING id`,
    [packageOrderId, studentId, credits, participantType, participantChildId],
  );
  await pool.query(
    `INSERT INTO package_credit_lots
       (package_order_id, source_type, credits_issued, credits_remaining, total_value_minor, value_basis, issuing_credit_transaction_id, created_by)
     VALUES ($1, 'purchased', $2, $2, $3, 'recorded_purchase_price', $4, 'test')`,
    [packageOrderId, credits, credits * 10_000, activation.rows[0].id],
  );
  return packageOrderId;
}

before(async () => {
  const express = (await import("express")).default;
  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  const jsonwebtoken = await import("jsonwebtoken");
  jwtSign = (jsonwebtoken.default as any)?.sign || jsonwebtoken.sign;

  const { requireAuth } = await import("../middlewares/auth");
  const bookingsRouter = await import("./bookings");
  const adminGateway = await import("./adminAttendanceGateway");

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", bookingsRouter.default);
  app.use("/api", adminGateway.default);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as any).port;
      resolve();
    });
  });

  const adminRes = await pool.query<{ id: number }>(
    `INSERT INTO system_users (full_name, email, password_hash, username, is_super_admin)
     VALUES ('H5 Super Admin', 'h5admin@example.com', 'hash', 'h5admin', true)
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

// ─── 1. Booking Creation H5 Policy ──────────────────────────────────────────

test("H5 Policy: Package booking creation deducts ZERO credits and creates ZERO credit transactions", async () => {
  const student = await makeStudent("5000000001");
  const token = studentToken(student.id, student.email);
  const { classId, scheduleId } = await makeClassAndSchedule();
  const packageOrderId = await makePackage(student.id, "self", null, 5);

  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.name,
      studentEmail: student.email,
      participantType: "self",
      classId,
      scheduleId,
      paymentMode: "package_credit",
      packageOrderId,
    }),
  });

  assert.equal(res.status, 201);
  const data = await jsonBody(res);
  assert.ok(data.id > 0);
  assert.equal(data.paymentMode, "package_credit");

  // Verify ZERO credit deduction occurred on package_orders
  const orderRes = await pool.query<{ remaining_credits: number }>(
    `SELECT remaining_credits FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(orderRes.rows[0].remaining_credits, 5, "Package balance MUST remain 5 after booking creation");

  // Verify ZERO booking_deduction credit_transactions exist for this package
  const txRes = await pool.query(
    `SELECT * FROM credit_transactions WHERE package_order_id = $1 AND type = 'booking_deduction'`,
    [packageOrderId],
  );
  assert.equal(txRes.rows.length, 0, "ZERO credit transactions must be created at booking time");

  // Verify ZERO attendance records created
  const attRes = await pool.query(`SELECT * FROM attendance WHERE booking_id = $1`, [data.id]);
  assert.equal(attRes.rows.length, 0);

  // Verify ZERO payment_records created
  const payRes = await pool.query(`SELECT * FROM payment_records WHERE booking_id = $1`, [data.id]);
  assert.equal(payRes.rows.length, 0);
});

test("H5 Policy: Child package booking creation deducts ZERO credits", async () => {
  const parent = await makeStudent("5000000002", "parent");
  const childId = await makeChild(parent.id, "H5 Child");
  const token = studentToken(parent.id, parent.email);
  const { classId, scheduleId } = await makeClassAndSchedule();
  const packageOrderId = await makePackage(parent.id, "child", childId, 4);

  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: "H5 Child",
      studentEmail: parent.email,
      participantType: "child",
      participantChildId: childId,
      classId,
      scheduleId,
      paymentMode: "package_credit",
      packageOrderId,
    }),
  });

  assert.equal(res.status, 201);
  const data = await jsonBody(res);
  assert.equal(data.participantType, "child");
  assert.equal(data.participantChildId, childId);

  const orderRes = await pool.query<{ remaining_credits: number }>(
    `SELECT remaining_credits FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(orderRes.rows[0].remaining_credits, 4, "Child package balance remains 4");
});

// ─── 2. Successful Booking-Backed Attendance ──────────────────────────────────

test("H5 Policy: Attendance check-in deducts exactly 1 credit atomically", async () => {
  const student = await makeStudent("5000000003");
  const token = studentToken(student.id, student.email);
  const { classId, scheduleId, branchId, roomId, today } = await makeClassAndSchedule();
  const packageOrderId = await makePackage(student.id, "self", null, 3);

  // Create booking (0 credit deduction)
  const bookRes = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.name,
      studentEmail: student.email,
      participantType: "self",
      classId,
      scheduleId,
      occurrenceDate: today,
      paymentMode: "package_credit",
      packageOrderId,
    }),
  });
  assert.equal(bookRes.status, 201);
  const booking = await jsonBody(bookRes);

  // Check-in via Admin Attendance Gateway
  const resolveRes = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: student.phone }),
  });
  assert.equal(resolveRes.status, 200);
  const resolveData = await jsonBody(resolveRes);
  const cand = (resolveData.accounts as Array<any>)[0]?.candidates?.find((c: any) => c.bookingId === booking.id);
  assert.ok(cand, "Candidate found for booking");

  const confirmRes = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: cand.candidateKey,
      program: "studio",
      accountId: student.id,
      source: "phone",
      bookingId: booking.id,
    }),
  });
  assert.ok([200, 201].includes(confirmRes.status), `confirm must return 200 or 201, got ${confirmRes.status}`);
  const confirmData = await jsonBody(confirmRes);
  assert.equal(confirmData.attendance.remainingCredits, 2);

  // Verify DB updates: package remaining_credits is now 2
  const orderRes = await pool.query<{ remaining_credits: number }>(
    `SELECT remaining_credits FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(orderRes.rows[0].remaining_credits, 2);

  // Verify attendance_deduction transaction created
  const txRes = await pool.query(
    `SELECT * FROM credit_transactions WHERE package_order_id = $1 AND type = 'attendance_deduction'`,
    [packageOrderId],
  );
  assert.equal(txRes.rows.length, 1);
  assert.equal(txRes.rows[0].delta, -1);
  assert.equal(txRes.rows[0].booking_id, booking.id);

  const allocation = await pool.query(
    `SELECT * FROM package_credit_allocations WHERE credit_transaction_id = $1`,
    [txRes.rows[0].id],
  );
  assert.equal(allocation.rowCount, 1);
  assert.equal(allocation.rows[0].attendance_id, confirmData.attendance.attendanceId);
  assert.equal(allocation.rows[0].booking_id, booking.id);
  assert.equal(allocation.rows[0].schedule_id, scheduleId);
  assert.equal(allocation.rows[0].branch_id, branchId);
  assert.equal(allocation.rows[0].room_id, roomId);
  assert.equal(allocation.rows[0].total_value_minor, 10_000);

  // Verify booking status transitioned to attended
  const bkRes = await pool.query<{ status: string; booking_status: string }>(
    `SELECT status, booking_status FROM bookings WHERE id = $1`,
    [booking.id],
  );
  assert.equal(bkRes.rows[0].status, "attended");
  assert.equal(bkRes.rows[0].booking_status, "attended");
});

// ─── 3. Legacy Pre-H5 Booking Compatibility ────────────────────────────────────

test("Legacy Compatibility: Pre-H5 booking with historical booking_deduction checks in with 0 additional deduction", async () => {
  const student = await makeStudent("5000000004");
  const token = studentToken(student.id, student.email);
  const { classId, scheduleId, today } = await makeClassAndSchedule();
  const packageOrderId = await makePackage(student.id, "self", null, 5);

  // Insert a booking
  const bookRes = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.name,
      studentEmail: student.email,
      participantType: "self",
      classId,
      scheduleId,
      occurrenceDate: today,
      paymentMode: "package_credit",
      packageOrderId,
    }),
  });
  const booking = await jsonBody(bookRes);

  // Simulate pre-H5 historical booking_deduction transaction & balance decrement to 4
  await pool.query(`UPDATE package_orders SET remaining_credits = 4 WHERE id = $1`, [packageOrderId]);
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, student_id, type, delta, balance_before, balance_after, booking_id, reference_id, reference_type, participant_type)
     VALUES ($1, $2, 'booking_deduction', -1, 5, 4, $3, $3, 'booking', 'self')`,
    [packageOrderId, student.id, booking.id],
  );

  // Check-in via Admin Attendance Gateway
  const resolveRes = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: student.phone }),
  });
  const resolveData = await jsonBody(resolveRes);
  const cand = (resolveData.accounts as Array<any>)[0]?.candidates?.find((c: any) => c.bookingId === booking.id);

  const confirmRes = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: cand.candidateKey,
      program: "studio",
      accountId: student.id,
      source: "phone",
      bookingId: booking.id,
    }),
  });
  assert.ok([200, 201].includes(confirmRes.status), `confirm must return 200 or 201, got ${confirmRes.status}`);

  // Verify remaining_credits is STILL 4 (0 additional deduction)
  const orderRes = await pool.query<{ remaining_credits: number }>(
    `SELECT remaining_credits FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(orderRes.rows[0].remaining_credits, 4, "Historical booking must NOT lose a second credit on check-in");

  // Verify only 1 deduction exists in credit_transactions
  const txRes = await pool.query(
    `SELECT * FROM credit_transactions WHERE package_order_id = $1 AND type IN ('booking_deduction', 'attendance_deduction')`,
    [packageOrderId],
  );
  assert.equal(txRes.rows.length, 1);
  assert.equal(txRes.rows[0].type, "booking_deduction");
});

// ─── 4. Booking Cancellation ──────────────────────────────────────────────────

test("H5 Policy: Cancellation of new H5 booking creates ZERO credit restoration and leaves balance unchanged", async () => {
  const student = await makeStudent("5000000005");
  const token = studentToken(student.id, student.email);
  const { classId, scheduleId } = await makeClassAndSchedule();
  const packageOrderId = await makePackage(student.id, "self", null, 5);

  const bookRes = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.name,
      studentEmail: student.email,
      participantType: "self",
      classId,
      scheduleId,
      paymentMode: "package_credit",
      packageOrderId,
    }),
  });
  const booking = await jsonBody(bookRes);

  // Cancel booking
  const cancelRes = await asStudent(token, `/api/bookings/${booking.id}/cancel`, {
    method: "PATCH",
  });
  assert.equal(cancelRes.status, 200);

  // Verify remaining_credits is STILL 5
  const orderRes = await pool.query<{ remaining_credits: number }>(
    `SELECT remaining_credits FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(orderRes.rows[0].remaining_credits, 5, "Cancellation of new booking restores 0 credits");

  // Verify 0 restoration transactions
  const txRes = await pool.query(
    `SELECT * FROM credit_transactions WHERE package_order_id = $1 AND type = 'booking_restoration'`,
    [packageOrderId],
  );
  assert.equal(txRes.rows.length, 0);
});

// ─── 5. Concurrency & Final Credit ─────────────────────────────────────────────

test("H5 Policy: Concurrent check-ins competing for the last credit produce 1 winner, 1 deduction, and 1 clean error", async () => {
  const student = await makeStudent("5000000006");
  const token = studentToken(student.id, student.email);

  // Create 2 schedules & classes
  const cs1 = await makeClassAndSchedule();
  const cs2 = await makeClassAndSchedule();

  // Package with EXACTLY 1 remaining credit
  const packageOrderId = await makePackage(student.id, "self", null, 1);

  // Create 2 bookings for the same participant using the package (both succeed with 0 credit deduction)
  const b1Res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.name,
      studentEmail: student.email,
      participantType: "self",
      classId: cs1.classId,
      scheduleId: cs1.scheduleId,
      occurrenceDate: cs1.today,
      paymentMode: "package_credit",
      packageOrderId,
    }),
  });
  assert.equal(b1Res.status, 201);
  const booking1 = await jsonBody(b1Res);

  const b2Res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.name,
      studentEmail: student.email,
      participantType: "self",
      classId: cs2.classId,
      scheduleId: cs2.scheduleId,
      occurrenceDate: cs2.today,
      paymentMode: "package_credit",
      packageOrderId,
    }),
  });
  assert.equal(b2Res.status, 201);
  const booking2 = await jsonBody(b2Res);

  // Resolve candidates for both classes
  const r1 = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: student.phone }),
  });
  const c1 = ((await jsonBody(r1)).accounts as Array<any>)[0]?.candidates?.find((c: any) => c.bookingId === booking1.id);

  const r2 = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: student.phone }),
  });
  const c2 = ((await jsonBody(r2)).accounts as Array<any>)[0]?.candidates?.find((c: any) => c.bookingId === booking2.id);

  // Run concurrent check-in requests
  const [res1, res2] = await Promise.all([
    asAdmin("/api/admin/attendance/confirm", {
      method: "POST",
      body: JSON.stringify({
        candidateKey: c1.candidateKey,
        program: "studio",
        accountId: student.id,
        source: "phone",
        bookingId: booking1.id,
      }),
    }),
    asAdmin("/api/admin/attendance/confirm", {
      method: "POST",
      body: JSON.stringify({
        candidateKey: c2.candidateKey,
        program: "studio",
        accountId: student.id,
        source: "phone",
        bookingId: booking2.id,
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status];
  assert.ok(statuses.includes(200) || statuses.includes(201), "One check-in must succeed");
  assert.ok(statuses.includes(409), "The other check-in must be rejected with 409");

  // Verify package balance never dropped below 0
  const orderRes = await pool.query<{ remaining_credits: number; status: string }>(
    `SELECT remaining_credits, status FROM package_orders WHERE id = $1`,
    [packageOrderId],
  );
  assert.equal(orderRes.rows[0].remaining_credits, 0);
  assert.equal(orderRes.rows[0].status, "fullyUsed");

  // Verify EXACTLY 1 attendance_deduction credit transaction exists
  const txRes = await pool.query(
    `SELECT * FROM credit_transactions WHERE package_order_id = $1 AND type = 'attendance_deduction'`,
    [packageOrderId],
  );
  assert.equal(txRes.rows.length, 1);
});
