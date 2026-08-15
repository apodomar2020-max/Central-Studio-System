/**
 * Notifications Wave 1 — source/origin classification coverage.
 *
 * Real DB integration tests against a disposable local Postgres (same
 * convention as notificationReminders.integration.test.ts / pushNotifications
 * .test.ts). Covers the non-reminder items from the Wave 1 test matrix:
 *   1. Manual Admin create receives manual_admin (real POST /notifications).
 *   2. Booking notification receives system.
 *   3. Attendance notification receives system.
 *   4. Package lifecycle notification receives system.
 *   5. Ballet application status receives explicit non-null type + system.
 *   9. Client cannot spoof manual notification origin to system/automation.
 *  10. Historical NULL-origin rows remain readable.
 * (Class 24h/1h/post-class reminder -> automation coverage lives in
 * notificationReminders.integration.test.ts, reusing its existing helpers.)
 *
 * requireAdminAuth/requireAdminPermission are mocked out via node:test's
 * mock.module (same technique already used by
 * ../routes/bookings.notificationPostCommit.integration.test.ts to mock
 * ./pushNotifications) — this suite is about notification classification,
 * not admin RBAC, which is covered elsewhere.
 *
 * Requires --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ROUTES_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes";

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
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let pool: import("pg").Pool;
let app: import("express").Express;
let server: import("node:http").Server;
let port: number;
let db: typeof import("@workspace/db").db;
let createStudentNotification: typeof import("./notifications").createStudentNotification;
let getStatusNotification: typeof import("../routes/adminBallet").getStatusNotification;
let studentSeq = 0;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function createStudent(): Promise<{ id: number; email: string }> {
  studentSeq += 1;
  const email = `notif-source-${RUN}-${studentSeq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ($1, $2, 'student', true) RETURNING id`,
    [`Notif Source Verify ${studentSeq}`, email],
  );
  return { id: rows[0].id, email };
}

async function sourceOf(notificationId: number): Promise<string | null> {
  const { rows } = await pool.query(`SELECT source FROM notifications WHERE id = $1`, [notificationId]);
  return rows[0]?.source ?? null;
}

before(async () => {
  mock.module("../routes/adminAuth", {
    namedExports: {
      requireAdminAuth: (req: any, _res: any, next: any) => {
        req.adminUser = {
          sub: 1,
          id: 1,
          isSuperAdmin: true,
          username: "notif-source-test-admin",
          fullName: "Notif Source Test Admin",
          email: "notif-source-test-admin@example.invalid",
        };
        next();
      },
      requireAdminPermission: (_module: string, _action: string) => (_req: any, _res: any, next: any) => next(),
    },
  });

  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  db = dbModule.db;
  ({ createStudentNotification } = await import("./notifications"));
  ({ getStatusNotification } = await import("../routes/adminBallet"));

  const expressModule = await import("express");
  const express = expressModule.default;
  const notificationsRouter = (await import("../routes/notifications")).default;
  const balletRouter = (await import("../routes/adminBallet")).default;

  app = express();
  app.use(express.json());
  app.use("/api", notificationsRouter);
  app.use("/api", balletRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.query(`DELETE FROM notifications WHERE title LIKE $1 OR title IN ('Application Received', 'Follow-up Required')`, [`Notif Source Verify%`]);
  await pool.query(`DELETE FROM ballet_applications WHERE child_name LIKE $1`, [`Notif Source Ballet ${RUN}%`]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`notif-source-${RUN}-%`]);
  await pool.end();
});

// ─── 1: Manual Admin create receives manual_admin ────────────────────────────

test("manual Admin notification create is classified as manual_admin", async () => {
  const res = await fetch(apiUrl("/api/notifications"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Notif Source Verify Manual", body: "Manual broadcast body", target: "all", isDraft: true }),
  });
  assert.equal(res.status, 201);
  const row = await res.json() as { id: number };
  assert.equal(await sourceOf(row.id), "manual_admin");
});

// ─── 9: client cannot spoof manual notification origin ───────────────────────

test("Admin create endpoint ignores a client-supplied source field entirely", async () => {
  const res = await fetch(apiUrl("/api/notifications"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Notif Source Verify Spoof",
      body: "Attempted spoof",
      target: "all",
      isDraft: true,
      source: "system", // not part of CreateNotificationBody — must be stripped, never trusted
    }),
  });
  assert.equal(res.status, 201);
  const row = await res.json() as { id: number };
  // The server always writes "manual_admin" for its own composer/API,
  // regardless of anything the client sent in the body.
  assert.equal(await sourceOf(row.id), "manual_admin");
});

// ─── 2-4: shared system-domain-event helper ──────────────────────────────────

test("booking notification (via createStudentNotification) is classified as system", async () => {
  const student = await createStudent();
  const row = await createStudentNotification(db, {
    studentId: student.id,
    title: "Booking Confirmed",
    body: "Your booking has been confirmed.",
    type: "booking_confirmed",
    relatedEntityType: "booking",
    relatedEntityId: 999001,
    dispatchPush: false,
  });
  assert.ok(row);
  assert.equal(await sourceOf(row!.id), "system");
});

test("attendance notification (via createStudentNotification) is classified as system", async () => {
  const student = await createStudent();
  const row = await createStudentNotification(db, {
    studentId: student.id,
    title: "Checked in",
    body: "You have been checked in.",
    type: "attendance_checked_in",
    relatedEntityType: "attendance",
    relatedEntityId: 999002,
    dispatchPush: false,
  });
  assert.ok(row);
  assert.equal(await sourceOf(row!.id), "system");
});

test("package lifecycle notification (via createStudentNotification) is classified as system", async () => {
  const student = await createStudent();
  const row = await createStudentNotification(db, {
    studentId: student.id,
    title: "Package active",
    body: "Your package is now active.",
    type: "package_activated",
    relatedEntityType: "package_order",
    relatedEntityId: 999003,
    dispatchPush: false,
  });
  assert.ok(row);
  assert.equal(await sourceOf(row!.id), "system");
});

// ─── 5: Ballet application status — explicit non-null type + system ─────────

test("getStatusNotification returns a stable non-null type for every known status", () => {
  const cases: Array<[string, string]> = [
    ["pending", "ballet_application_pending"],
    ["needsFollowUp", "ballet_application_needs_follow_up"],
    ["accepted", "ballet_application_accepted"],
    ["assignedToLevel", "ballet_application_level_assigned"],
    ["active", "ballet_application_active"],
    ["rejected", "ballet_application_rejected"],
    ["cancelled", "ballet_application_cancelled"],
  ];
  for (const [status, expectedType] of cases) {
    const result = getStatusNotification(status, "Test Child");
    assert.equal(result.type, expectedType, `status "${status}"`);
    assert.ok(result.type, `status "${status}" must have a non-null/non-empty type`);
  }
  // Any status not explicitly enumerated (e.g. a future/unhandled value)
  // still gets a stable, non-null fallback type — never NULL.
  const fallback = getStatusNotification("withdrawn", "Test Child");
  assert.equal(fallback.type, "ballet_application_status_changed");
});

test("cancelled ballet application status reuses the existing ballet_application_cancelled type (same real-world event as the dedicated cancellation flow)", () => {
  const result = getStatusNotification("cancelled", "Test Child");
  assert.equal(result.type, "ballet_application_cancelled");
});

test("Ballet application status change end-to-end: notification row has explicit type and source=system", async () => {
  const student = await createStudent();
  const childName = `Notif Source Ballet ${RUN}`;
  const insertRes = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status)
     VALUES ($1, 'Notif Source Parent', '0100000000', $2, $3, 'pending') RETURNING id`,
    [student.id, student.email, childName],
  );
  const applicationId = insertRes.rows[0].id as number;

  // pending -> needsFollowUp is an allowed transition (BALLET_STATUS_TRANSITIONS)
  // that does not require the "active" activation gate.
  const res = await fetch(apiUrl(`/api/admin/ballet/applications/${applicationId}/status`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "needsFollowUp" }),
  });
  assert.equal(res.status, 200);

  const { rows } = await pool.query(
    `SELECT id, type, source, target, related_entity_type AS "relatedEntityType", related_entity_id AS "relatedEntityId"
     FROM notifications WHERE target = $1 ORDER BY id DESC LIMIT 1`,
    [`student:${student.id}`],
  );
  assert.ok(rows[0], "expected a notification row for the application's parent student");
  assert.equal(rows[0].type, "ballet_application_needs_follow_up");
  assert.equal(rows[0].source, "system");
  assert.equal(rows[0].relatedEntityType, "ballet_application");
  assert.equal(rows[0].relatedEntityId, applicationId);

  // Regression lock: this path has never dispatched Push (confirmed by
  // tracing the route — no sendPushNotification/dispatchPushForNotification
  // call exists here, before or after Wave 1). sendPushNotification always
  // writes a delivery log row, even for the "disabled"/"no device" cases —
  // so the total absence of any row (not even a "skipped" one) is
  // conclusive proof no push attempt was ever made from this insert, not
  // just that one happened to be skipped.
  const { rows: deliveryLogs } = await pool.query(
    `SELECT id FROM notification_delivery_logs WHERE notification_id = $1`,
    [rows[0].id],
  );
  assert.equal(deliveryLogs.length, 0, "Ballet application-status notifications must not dispatch Push — no delivery log of any kind should exist");
});

// ─── 10: historical NULL-origin rows remain readable ─────────────────────────

test("a historical row with no source (NULL) is still returned by the Admin list endpoint", async () => {
  const insertRes = await pool.query(
    `INSERT INTO notifications (title, body, target, is_draft, sent_at)
     VALUES ($1, 'Legacy row, no source column value ever set', 'all', false, now()) RETURNING id`,
    [`Notif Source Verify Legacy ${RUN}`],
  );
  const legacyId = insertRes.rows[0].id as number;
  assert.equal(await sourceOf(legacyId), null);

  const res = await fetch(apiUrl("/api/notifications"));
  assert.equal(res.status, 200);
  const rows = await res.json() as Array<{ id: number; source: string | null }>;
  const found = rows.find((r) => r.id === legacyId);
  assert.ok(found, "legacy NULL-source row must still appear in the Admin list");
  assert.equal(found!.source, null);
});
