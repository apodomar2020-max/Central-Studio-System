/**
 * Deterministic proof that the push-notification dispatch triggered by
 * POST /api/bookings cannot start before the creating transaction
 * (bookings + payment_records + payment_events + the notification row) has
 * committed — same pattern established and reviewed in Phase 2B-1
 * (packageOrders.notificationPostCommit.integration.test.ts).
 *
 * Uses node:test's mock.module to replace `../lib/pushNotifications`'s
 * sendPushNotification with a spy that, on each invocation, checks out a
 * fresh, dedicated observer connection via the repository-supported
 * `pool.connect()` (never a deep node_modules import), queries the
 * notification row through it, then releases it. A pg.Pool checked-out
 * client is exclusive, so this observer is always distinct from whatever
 * client db.transaction() used for that request. Postgres's MVCC guarantee
 * means an uncommitted row is categorically invisible to any other
 * connection — so a passing `visibleAtCallTime: true` is structural proof,
 * not a timing coincidence.
 *
 * Requires --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_SINGLE_CLASS_BOOKING_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_single_class_booking";

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

type PushCall = {
  studentId: number;
  notificationId: number;
  visibleAtCallTime: boolean;
  observerBackendPid: number;
  poolTotalCountAtCallTime: number;
};
const pushCalls: PushCall[] = [];
let forceNextPushRejection = false;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let classId: number;
let scheduleId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

let studentCounter = 0;
async function makeStudent(): Promise<{ id: number; email: string }> {
  studentCounter += 1;
  const email = `booking-postcommit-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ('Post Commit Test', $1, '0100000000', 'student', true) RETURNING id`,
    [email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

async function waitForPushCalls(expected: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pushCalls.length >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  mock.module("../lib/pushNotifications", {
    namedExports: {
      sendPushNotification: async (input: { studentId: number; notificationId?: number | null }) => {
        if (forceNextPushRejection) {
          forceNextPushRejection = false;
          throw new Error("injected test push failure");
        }
        const observerClient = await pool.connect();
        try {
          const poolTotalCountAtCallTime = pool.totalCount;
          const pidResult = await observerClient.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`);
          const result = await observerClient.query(`SELECT 1 FROM notifications WHERE id = $1`, [input.notificationId]);
          pushCalls.push({
            studentId: input.studentId,
            notificationId: input.notificationId!,
            visibleAtCallTime: (result.rowCount ?? 0) > 0,
            observerBackendPid: pidResult.rows[0].pid,
            poolTotalCountAtCallTime,
          });
        } finally {
          observerClient.release();
        }
        return { sent: 0, failed: 0, skipped: true, reason: "push_disabled" };
      },
      sendBroadcastPushNotification: async () => ({ sent: 0, failed: 0 }),
    },
  });

  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const bookingsRouter = (await import("./bookings")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", bookingsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Post Commit Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Post Commit Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 3, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("the push dispatch for a booking is invoked only after the creating transaction has committed", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);

  const beforeCallCount = pushCalls.length;
  const res = await fetch(apiUrl("/api/bookings"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
  });
  assert.equal(res.status, 201);
  await waitForPushCalls(beforeCallCount + 1);

  assert.equal(pushCalls.length, beforeCallCount + 1, "exactly one push dispatch must occur for this booking");
  const call = pushCalls[pushCalls.length - 1];
  assert.equal(call.studentId, student.id);
  assert.equal(call.visibleAtCallTime, true, "the notification row must already be visible over the independent observer connection at push time");
  assert.ok(Number.isInteger(call.observerBackendPid) && call.observerBackendPid > 0);
  assert.ok(call.poolTotalCountAtCallTime >= 1);
});

test("ten concurrent booking creations each dispatch their push only after their own transaction commits", async () => {
  const students = await Promise.all(Array.from({ length: 10 }, () => makeStudent()));

  const beforeCallCount = pushCalls.length;
  const responses = await Promise.all(students.map((s) => fetch(apiUrl("/api/bookings"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${studentToken(s.id, s.email)}` },
    body: JSON.stringify({ studentName: s.email, studentEmail: s.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
  })));
  for (const res of responses) assert.equal(res.status, 201);
  await waitForPushCalls(beforeCallCount + 10);

  const newCalls = pushCalls.slice(beforeCallCount);
  assert.equal(newCalls.length, 10);
  for (const call of newCalls) {
    assert.equal(call.visibleAtCallTime, true, `push for notification ${call.notificationId} fired before its transaction's row was visible`);
  }
});

test("a rejected post-commit push does not roll back the committed booking, and the route still returns the historic success response", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);

  let sawUnhandledRejection = false;
  const onUnhandledRejection = () => { sawUnhandledRejection = true; };
  process.on("unhandledRejection", onUnhandledRejection);

  const before = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE student_email = $1`, [student.email]);

  forceNextPushRejection = true;
  const res = await fetch(apiUrl("/api/bookings"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
  });
  const body = await res.json() as Record<string, unknown>;

  await new Promise((resolve) => setTimeout(resolve, 50));
  process.off("unhandledRejection", onUnhandledRejection);

  assert.equal(res.status, 201, "the route must still return the historic success status even though the post-commit push rejected");
  assert.equal(typeof body.id, "number");
  assert.equal(sawUnhandledRejection, false, "a rejected post-commit push must never surface as an unhandled promise rejection");

  const after = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE student_email = $1`, [student.email]);
  assert.equal(after.rows[0].n, before.rows[0].n + 1, "the booking must remain committed exactly once despite the push failure");

  const record = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [body.id]);
  assert.equal(record.rows[0].n, 1, "payment_records must remain committed exactly once");
  const events = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe JOIN payment_records pr ON pr.id = pe.payment_record_id WHERE pr.booking_id = $1`,
    [body.id],
  );
  assert.equal(events.rows[0].n, 1, "payment_events must remain committed exactly once");
});
