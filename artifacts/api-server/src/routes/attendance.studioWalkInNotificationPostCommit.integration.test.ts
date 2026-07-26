/**
 * Deterministic proof that the push-notification dispatch triggered by a
 * paid Studio walk-in (POST /attendance, paid:true) cannot start before the
 * creating transaction has committed — same pattern established and
 * reviewed in Phase 2B-1/2B-2.
 *
 * Uses node:test's mock.module to replace `../lib/pushNotifications`'s
 * sendPushNotification with a spy that, on each invocation, checks out a
 * fresh, dedicated observer connection via the repository-supported
 * `pool.connect()` (never a deep node_modules import), queries the
 * notification row through it, then releases it.
 *
 * Requires --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_STUDIO_WALKIN_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_studio_walkin";

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

type PushCall = { studentId: number; notificationId: number; visibleAtCallTime: boolean };
const pushCalls: PushCall[] = [];
let forceNextPushRejection = false;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let classId: number;
let scheduleId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `walkin-postcommit-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

let studentCounter = 0;
async function makeStudent(): Promise<{ id: number; email: string; name: string }> {
  studentCounter += 1;
  const email = `walkin-postcommit-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Walk-in Post Commit ${studentCounter}`, email],
  );
  return { id: result.rows[0].id as number, email, name: `Walk-in Post Commit ${studentCounter}` };
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
          const result = await observerClient.query(`SELECT 1 FROM notifications WHERE id = $1`, [input.notificationId]);
          pushCalls.push({
            studentId: input.studentId,
            notificationId: input.notificationId!,
            visibleAtCallTime: (result.rowCount ?? 0) > 0,
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
  const attendanceRouter = (await import("./attendance")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", attendanceRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id as number;
  } else {
    const superAdmin = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Walk-in Post Commit Super', true) RETURNING id`,
      [`walkin-postcommit-super-${run}`, `walkin-postcommit-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Walk-in Post Commit Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Walk-in Post Commit Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 5, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("the push dispatch for a paid walk-in is invoked only after the creating transaction has committed", async () => {
  const student = await makeStudent();
  const beforeCallCount = pushCalls.length;
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true }),
  });
  assert.equal(res.status, 201);
  await waitForPushCalls(beforeCallCount + 1);

  assert.equal(pushCalls.length, beforeCallCount + 1);
  const call = pushCalls[pushCalls.length - 1];
  assert.equal(call.studentId, student.id);
  assert.equal(call.visibleAtCallTime, true, "the notification row must already be visible over the observer connection at push time");
});

test("a rejected post-commit push does not roll back the committed walk-in, and the route still returns the historic success response", async () => {
  const student = await makeStudent();

  let sawUnhandledRejection = false;
  const onUnhandledRejection = () => { sawUnhandledRejection = true; };
  process.on("unhandledRejection", onUnhandledRejection);

  forceNextPushRejection = true;
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true }),
  });
  const body = await res.json() as Record<string, unknown>;

  await new Promise((resolve) => setTimeout(resolve, 50));
  process.off("unhandledRejection", onUnhandledRejection);

  assert.equal(res.status, 201, "the route must still return the historic success status even though the post-commit push rejected");
  assert.equal(body.paid, true);
  assert.equal(sawUnhandledRejection, false, "a rejected post-commit push must never surface as an unhandled promise rejection");

  const record = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [body.bookingId]);
  assert.equal(record.rows[0].n, 1, "the walk-in must remain committed exactly once despite the push failure");
});
