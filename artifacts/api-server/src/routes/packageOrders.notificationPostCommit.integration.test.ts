/**
 * Deterministic proof that the push-notification dispatch triggered by
 * POST /api/package-orders cannot start before the creating transaction
 * (package_orders + payment_records + payment_events + the notification
 * row + promotion redemption) has committed.
 *
 * This is NOT a timing/repeated-runs test. It uses node:test's mock.module
 * to replace `../lib/pushNotifications`'s sendPushNotification with a spy
 * that, the instant it is invoked, checks out a fresh, dedicated observer
 * connection via `pool.connect()` (the repository-supported @workspace/db
 * pool, never a deep node_modules import), queries the notification row
 * through it, then releases it. A pg.Pool checked-out client is exclusive —
 * it is never handed to two concurrent callers — so this observer client is
 * always distinct from whatever client db.transaction() is using for that
 * same request. Postgres's MVCC/read-committed guarantee means an
 * uncommitted row is categorically invisible to any other connection — not
 * "usually invisible", never visible under any timing. So if the observer's
 * independent connection can see the row, the transaction had already
 * committed at the exact moment the push was scheduled, every single run,
 * by construction — not by luck of timing.
 *
 * Uses the repository-supported `pool` export from `@workspace/db` (a
 * standard pg.Pool) rather than any deep node_modules import.
 *
 * Requires --experimental-test-module-mocks (see the npm script this file
 * is invoked from).
 */
import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_CAPTURE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_capture";

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
let packageId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function makeStudent(run: string): Promise<{ id: number; email: string }> {
  const email = `pkg-postcommit-${run}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified) VALUES ('Post Commit Test', $1, '0100000000', 'student', '2000-01-01', true) RETURNING id`,
    [email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

// sendPushNotification is invoked fire-and-forget (never awaited by the
// route, matching the pre-existing contract) — this only waits for the
// mock's own async body (query via observerClient) to finish recording, it
// does not wait to see whether the push races the commit. Bounded by
// design: polls a real completion signal (pushCalls.length), not a fixed
// guess.
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

  // Registered before the router (and therefore before packageOrders.ts's
  // own `import { sendPushNotification } from "../lib/pushNotifications"`)
  // is ever imported, so the router receives the mocked binding.
  mock.module("../lib/pushNotifications", {
    namedExports: {
      sendPushNotification: async (input: { studentId: number; notificationId?: number | null }) => {
        if (forceNextPushRejection) {
          forceNextPushRejection = false;
          throw new Error("injected test push failure");
        }
        // A fresh, dedicated observer connection — the repository-supported
        // pattern: pool.connect() / try / finally release(). Exclusive by
        // pg.Pool's own contract: never the same client db.transaction()
        // used for this request, since a checked-out client is never
        // handed to a second caller until released.
        const observerClient = await pool.connect();
        try {
          const poolTotalCountAtCallTime = pool.totalCount;
          // Sequential on this one client — a single pg connection cannot
          // run two queries concurrently.
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
  const packageOrdersRouter = (await import("./packageOrders")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", packageOrdersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ($1, 'per_class', 500, 8, 6, true) RETURNING id`,
    [`Post Commit Test Package ${run}`],
  );
  packageId = pkg.rows[0].id as number;
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("the push dispatch is invoked only after the creating transaction has committed", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run);
  const token = studentToken(student.id, student.email);

  const beforeCallCount = pushCalls.length;
  const res = await fetch(apiUrl("/api/package-orders"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 201);
  await waitForPushCalls(beforeCallCount + 1);

  assert.equal(pushCalls.length, beforeCallCount + 1, "exactly one push dispatch must occur for this order");
  const call = pushCalls[pushCalls.length - 1];
  assert.equal(call.studentId, student.id);
  assert.equal(
    call.visibleAtCallTime,
    true,
    "the notification row must already be visible over the independent observer connection at the moment sendPushNotification was invoked — proof the transaction had already committed, not a timing coincidence",
  );
  assert.ok(
    Number.isInteger(call.observerBackendPid) && call.observerBackendPid > 0,
    "the observer must have its own real Postgres backend pid",
  );
  assert.ok(
    call.poolTotalCountAtCallTime >= 1,
    `the pool must report at least the observer's own connection — saw ${call.poolTotalCountAtCallTime}`,
  );
});

test("ten concurrent package-order creations each dispatch their push only after their own transaction commits", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const students = await Promise.all(Array.from({ length: 10 }, (_, i) => makeStudent(`${run}-${i}`)));

  const beforeCallCount = pushCalls.length;
  const responses = await Promise.all(students.map((s) => fetch(apiUrl("/api/package-orders"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${studentToken(s.id, s.email)}` },
    body: JSON.stringify({ packageId }),
  })));
  for (const res of responses) assert.equal(res.status, 201);
  await waitForPushCalls(beforeCallCount + 10);

  const newCalls = pushCalls.slice(beforeCallCount);
  assert.equal(newCalls.length, 10, "exactly one push dispatch per order, even under concurrency");
  for (const call of newCalls) {
    assert.equal(call.visibleAtCallTime, true, `push for notification ${call.notificationId} fired before its transaction's row was visible to the observer connection`);
  }
});

test("a rejected post-commit push does not roll back the committed purchase, and the route still returns the historic success response", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run);
  const token = studentToken(student.id, student.email);

  let sawUnhandledRejection = false;
  const onUnhandledRejection = () => { sawUnhandledRejection = true; };
  process.on("unhandledRejection", onUnhandledRejection);

  const before = await pool.query(`SELECT count(*)::int AS n FROM package_orders WHERE student_id = $1`, [student.id]);

  forceNextPushRejection = true;
  const res = await fetch(apiUrl("/api/package-orders"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ packageId }),
  });
  const body = await res.json() as Record<string, unknown>;

  // Give the rejected, unawaited push promise's .catch() a tick to run
  // before asserting no unhandled rejection was raised.
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.off("unhandledRejection", onUnhandledRejection);

  assert.equal(res.status, 201, "the route must still return the historic success status even though the post-commit push rejected");
  assert.equal(typeof body.id, "number");
  assert.equal(body.status, "pendingPayment");
  assert.equal(sawUnhandledRejection, false, "a rejected post-commit push must never surface as an unhandled promise rejection");

  const after = await pool.query(`SELECT count(*)::int AS n FROM package_orders WHERE student_id = $1`, [student.id]);
  assert.equal(after.rows[0].n, before.rows[0].n + 1, "the package purchase must remain committed exactly once despite the push failure");

  const record = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE student_id = $1`, [student.id]);
  assert.equal(record.rows[0].n, 1, "payment_records must remain committed exactly once");
  const events = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe JOIN payment_records pr ON pr.id = pe.payment_record_id WHERE pr.student_id = $1`,
    [student.id],
  );
  assert.equal(events.rows[0].n, 1, "payment_events must remain committed exactly once");
  const notifications = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE target = $1 AND type = 'package_created'`,
    [`student:${student.id}`],
  );
  assert.equal(notifications.rows[0].n, 1, "the notification row must remain committed exactly once — only the push delivery failed, not the row insert");
});
