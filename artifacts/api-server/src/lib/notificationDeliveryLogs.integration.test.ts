/**
 * Notifications Wave 5 — Notification Delivery Logs API integration tests.
 *
 * Real DB integration tests against a disposable local Postgres, same
 * HTTP-mounted-router convention as notificationCampaigns.*.integration.test.ts
 * (requireAdminAuth / requireAdminPermission mocked via a synthetic
 * x-test-admin-actions header so RBAC scenarios can be driven directly).
 *
 * Requires --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test, mock } from "node:test";

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

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

let pool: import("pg").Pool;
let app: import("express").Express;
let server: import("node:http").Server;
let port: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function headers(actions: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (actions !== null) h["x-test-admin-actions"] = actions;
  return h;
}

const FULL_ACCESS = "auditLogs:view,notifications:view";

before(async () => {
  mock.module("../routes/adminAuth", {
    namedExports: {
      requireAdminAuth: (req: any, res: any, next: any) => {
        const actionsHeader = req.headers["x-test-admin-actions"];
        if (typeof actionsHeader !== "string") { res.status(401).json({ error: "Admin authentication required" }); return; }
        req.adminUser = { sub: 1, id: 1, isSuperAdmin: actionsHeader === "*", username: "test-admin", fullName: "Test Admin", email: "admin@test.invalid", _grantedActions: actionsHeader.split(",") };
        next();
      },
      requireAdminPermission: (moduleKey: string, actionKey: string) => (req: any, res: any, next: any) => {
        const admin = req.adminUser;
        if (!admin) { res.status(401).json({ error: "Admin authentication required" }); return; }
        if (admin.isSuperAdmin || (admin._grantedActions as string[]).includes(`${moduleKey}:${actionKey}`)) { next(); return; }
        res.status(403).json({ error: "Permission denied" });
      },
    },
  });

  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const expressModule = await import("express");
  const express = expressModule.default;
  const deliveryRouter = (await import("../routes/notificationDeliveryLogs")).default;
  const activityRouter = (await import("../routes/adminActivityLogs")).default;
  app = express();
  app.use(express.json());
  app.use("/api", deliveryRouter);
  app.use("/api", activityRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

beforeEach(async () => {
  await cleanupAll();
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await cleanupAll();
  await pool.end();
});

// ─── Seed helpers ───────────────────────────────────────────────────────────

async function seedStudent(opts: { name?: string; email?: string } = {}): Promise<{ id: number; email: string }> {
  seq += 1;
  const email = opts.email ?? `w5-${RUN}-${seq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email) VALUES ($1, $2) RETURNING id`,
    [opts.name ?? `W5 Student ${seq}`, email],
  );
  return { id: rows[0].id, email };
}

async function seedDevice(studentId: number, opts: { platform?: string; isActive?: boolean } = {}): Promise<{ id: number }> {
  const pushToken = `ExponentPushToken[w5-${RUN}-${studentId}-${Math.random().toString(36).slice(2, 8)}]`;
  const { rows } = await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active, unregister_secret_hash)
     VALUES ($1, $2, 'expo', $3, $4, 'w5-fixture-secret-hash-should-never-appear') RETURNING id`,
    [studentId, pushToken, opts.platform ?? "ios", opts.isActive ?? true],
  );
  return { id: rows[0].id };
}

async function seedNotification(opts: {
  title?: string;
  type?: string | null;
  source?: string | null;
  target?: string;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
}): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, source, related_entity_type, related_entity_id, is_draft, sent_at)
     VALUES ($1, 'W5 test body', $2, $3, $4, $5, $6, false, now()) RETURNING id`,
    [
      opts.title ?? `W5 Verify Notification ${RUN}-${seq}`,
      opts.target ?? "all",
      opts.type ?? null,
      opts.source ?? null,
      opts.relatedEntityType ?? null,
      opts.relatedEntityId ?? null,
    ],
  );
  return { id: rows[0].id };
}

async function seedDeliveryLog(opts: {
  notificationId: number;
  studentId?: number | null;
  deviceId?: number | null;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
}): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO notification_delivery_logs (notification_id, student_id, device_id, channel, provider, status, error_code, error_message, sent_at, created_at)
     VALUES ($1, $2, $3, 'push', 'expo', $4, $5, $6, $7, coalesce($8, now())) RETURNING id`,
    [
      opts.notificationId,
      opts.studentId ?? null,
      opts.deviceId ?? null,
      opts.status,
      opts.errorCode ?? null,
      opts.errorMessage ?? null,
      opts.status === "sent" ? new Date().toISOString() : null,
      opts.createdAt ?? null,
    ],
  );
  return { id: rows[0].id };
}

async function seedCampaign(notificationId: number, title: string): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status, notification_id) VALUES ($1, 'body', 'all_members', 'completed', $2) RETURNING id`,
    [title, notificationId],
  );
  return { id: rows[0].id };
}

async function cleanupAll(): Promise<void> {
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE $1`, [`W5 Verify%`]);
  await pool.query(`DELETE FROM notification_delivery_logs WHERE notification_id IN (SELECT id FROM notifications WHERE title LIKE $1)`, [`W5 Verify%`]);
  await pool.query(`DELETE FROM notification_devices WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`w5-${RUN}-%`]);
  await pool.query(`DELETE FROM notifications WHERE title LIKE $1`, [`W5 Verify%`]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`w5-${RUN}-%`]);
}

async function fetchList(params: Record<string, string>, actions: string | null = FULL_ACCESS): Promise<any> {
  const res = await fetch(apiUrl(`/api/admin/logs/notification-delivery?${new URLSearchParams(params)}`), { headers: headers(actions) });
  return { status: res.status, body: await res.json() };
}

async function fetchDetail(id: string, actions: string | null = FULL_ACCESS): Promise<any> {
  const res = await fetch(apiUrl(`/api/admin/logs/notification-delivery/${encodeURIComponent(id)}`), { headers: headers(actions) });
  return { status: res.status, body: await res.json() };
}

// ─── 1-3: status outcomes appear ────────────────────────────────────────────

test("1: a sent delivery appears with status=sent", async () => {
  const student = await seedStudent();
  const device = await seedDevice(student.id);
  const notif = await seedNotification({ title: `W5 Verify Sent ${RUN}` });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, deviceId: device.id, status: "sent" });

  const { body } = await fetchList({ search: `W5 Verify Sent ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].status, "sent");
});

test("2: a failed delivery appears with status=failed and errorCode", async () => {
  const student = await seedStudent();
  const device = await seedDevice(student.id);
  const notif = await seedNotification({ title: `W5 Verify Failed ${RUN}` });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, deviceId: device.id, status: "failed", errorCode: "DeviceNotRegistered" });

  const { body } = await fetchList({ search: `W5 Verify Failed ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].status, "failed");
  assert.equal(body.data[0].errorCode, "DeviceNotRegistered");
});

test("3: a skipped/no-device delivery appears with status=skipped and errorCode=no_active_device", async () => {
  const student = await seedStudent();
  const notif = await seedNotification({ title: `W5 Verify Skipped ${RUN}` });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, deviceId: null, status: "skipped", errorCode: "no_active_device" });

  const { body } = await fetchList({ search: `W5 Verify Skipped ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].status, "skipped");
  assert.equal(body.data[0].errorCode, "no_active_device");
});

test("3b: a notification with zero delivery_logs rows still surfaces as status=no_delivery_record, never fabricated", async () => {
  const notif = await seedNotification({ title: `W5 Verify NoAttempt ${RUN}`, target: "all" });
  void notif;
  const { body } = await fetchList({ search: `W5 Verify NoAttempt ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].status, "no_delivery_record");
});

// ─── 4-7: source filter + legacy display ────────────────────────────────────

test("4: source=system filter returns only system-sourced notifications", async () => {
  await seedNotification({ title: `W5 Verify SrcSystem ${RUN}`, source: "system" });
  await seedNotification({ title: `W5 Verify SrcSystemOther ${RUN}`, source: "automation" });
  const { body } = await fetchList({ source: "system", search: `W5 Verify SrcSystem ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].source, "system");
});

test("5: source=automation filter returns only automation-sourced notifications", async () => {
  await seedNotification({ title: `W5 Verify SrcAuto ${RUN}`, source: "automation" });
  const { body } = await fetchList({ source: "automation", search: `W5 Verify SrcAuto ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].source, "automation");
});

test("6: source=manual_admin filter returns only manual campaign notifications, with campaign reference attached", async () => {
  const notif = await seedNotification({ title: `W5 Verify SrcManual ${RUN}`, source: "manual_admin" });
  const campaign = await seedCampaign(notif.id, `W5 Verify Campaign ${RUN}`);
  const { body } = await fetchList({ source: "manual_admin", search: `W5 Verify SrcManual ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].source, "manual_admin");
  assert.equal(body.data[0].campaign?.id, campaign.id);
});

test("7: a notification with source=NULL (legacy) is returned by source=legacy filter and never given a fabricated source", async () => {
  await seedNotification({ title: `W5 Verify Legacy ${RUN}`, source: null });
  const { body } = await fetchList({ source: "legacy", search: `W5 Verify Legacy ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].source, null);
});

// ─── 8-11: status/type/platform/date filters ───────────────────────────────

test("8: status filter narrows to the exact delivery status", async () => {
  const student = await seedStudent();
  const notifSent = await seedNotification({ title: `W5 Verify StatusSent ${RUN}` });
  await seedDeliveryLog({ notificationId: notifSent.id, studentId: student.id, status: "sent" });
  const notifFailed = await seedNotification({ title: `W5 Verify StatusFailed ${RUN}` });
  await seedDeliveryLog({ notificationId: notifFailed.id, studentId: student.id, status: "failed", errorCode: "MessageTooBig" });

  // `search` narrowed to just the RUN token (unique per test-file
  // execution; cleanupAll() runs before every test so only this test's two
  // rows exist) combined with status=sent to isolate the single sent row.
  const result = await fetchList({ status: "sent", search: RUN });
  assert.equal(result.body.data.length, 1);
  assert.equal(result.body.data[0].status, "sent");
});

test("9: notification type filter narrows results", async () => {
  await seedNotification({ title: `W5 Verify TypeA ${RUN}`, type: `w5_type_a_${RUN}` });
  await seedNotification({ title: `W5 Verify TypeB ${RUN}`, type: `w5_type_b_${RUN}` });
  const { body } = await fetchList({ type: `w5_type_a_${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].type, `w5_type_a_${RUN}`);
});

test("10: platform filter narrows to deliveries on that device platform", async () => {
  const student = await seedStudent();
  const iosDevice = await seedDevice(student.id, { platform: "ios" });
  const androidDevice = await seedDevice(student.id, { platform: "android" });
  const notif = await seedNotification({ title: `W5 Verify Platform ${RUN}` });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, deviceId: iosDevice.id, status: "sent" });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, deviceId: androidDevice.id, status: "sent" });

  const { body } = await fetchList({ platform: "android", search: `W5 Verify Platform ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].platform, "android");
});

test("11: date range (from/to) filters by the delivery/notification 'when' timestamp", async () => {
  const notif = await seedNotification({ title: `W5 Verify DateRange ${RUN}` });
  const student = await seedStudent();
  await seedDeliveryLog({
    notificationId: notif.id, studentId: student.id, status: "sent",
    createdAt: "2020-01-01T00:00:00.000Z",
  });

  const outOfRange = await fetchList({ search: `W5 Verify DateRange ${RUN}`, from: "2021-01-01", to: "2021-12-31" });
  assert.equal(outOfRange.body.data.length, 0);

  const inRange = await fetchList({ search: `W5 Verify DateRange ${RUN}`, from: "2019-12-01", to: "2020-02-01" });
  assert.equal(inRange.body.data.length, 1);
});

// ─── 12-13: search ──────────────────────────────────────────────────────────

test("12: title search matches notification title", async () => {
  await seedNotification({ title: `W5 Verify UniqueTitleXyz ${RUN}` });
  const { body } = await fetchList({ search: `UniqueTitleXyz ${RUN}` });
  assert.equal(body.data.length, 1);
});

test("13: recipient search matches recipient name/email for an authorized caller", async () => {
  const student = await seedStudent({ name: `W5 SearchableRecipient ${RUN}` });
  const notif = await seedNotification({ title: `W5 Verify RecipientSearch ${RUN}` });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, status: "sent" });

  const { body } = await fetchList({ search: `W5 SearchableRecipient ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].recipient?.studentId, student.id);
});

// ─── 14-15: pagination + ordering ──────────────────────────────────────────

test("14: pagination returns the requested page size and totalPages", async () => {
  const student = await seedStudent();
  for (let i = 0; i < 3; i += 1) {
    const notif = await seedNotification({ title: `W5 Verify PagePush ${RUN}-${i}` });
    await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, status: "sent" });
  }
  const page1 = await fetchList({ search: `W5 Verify PagePush ${RUN}`, limit: "2", page: "1" });
  assert.equal(page1.body.data.length, 2);
  assert.equal(page1.body.total, 3);
  assert.equal(page1.body.totalPages, 2);
  const page2 = await fetchList({ search: `W5 Verify PagePush ${RUN}`, limit: "2", page: "2" });
  assert.equal(page2.body.data.length, 1);
});

test("15: results are ordered newest-first", async () => {
  const student = await seedStudent();
  const notifOld = await seedNotification({ title: `W5 Verify OrderOld ${RUN}` });
  await seedDeliveryLog({ notificationId: notifOld.id, studentId: student.id, status: "sent", createdAt: "2020-01-01T00:00:00.000Z" });
  const notifNew = await seedNotification({ title: `W5 Verify OrderNew ${RUN}` });
  await seedDeliveryLog({ notificationId: notifNew.id, studentId: student.id, status: "sent", createdAt: "2024-01-01T00:00:00.000Z" });

  const { body } = await fetchList({ search: RUN });
  const titles = body.data.map((r: any) => r.title);
  const idxNew = titles.indexOf(`W5 Verify OrderNew ${RUN}`);
  const idxOld = titles.indexOf(`W5 Verify OrderOld ${RUN}`);
  assert.ok(idxNew !== -1 && idxOld !== -1 && idxNew < idxOld, "newest-first ordering expected");
});

// ─── 16-17: recipient fallback + related entity ────────────────────────────

test("16: a deleted recipient (FK set null) is shown as a safe fallback, never a broken row", async () => {
  const student = await seedStudent();
  const notif = await seedNotification({ title: `W5 Verify DeletedRecipient ${RUN}` });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, status: "sent" });
  await pool.query(`DELETE FROM students WHERE id = $1`, [student.id]);

  const { body } = await fetchList({ search: `W5 Verify DeletedRecipient ${RUN}` });
  assert.equal(body.data.length, 1);
  // student_id survives (ON DELETE SET NULL is on notification_devices/
  // notification_delivery_logs.student_id per the schema) — this asserts
  // the row is never dropped/broken even if the FK were null in some path.
  assert.ok(body.data[0].recipient === null || body.data[0].recipient.name == null);
});

test("17: a notification with a related entity surfaces relatedEntityType/relatedEntityId", async () => {
  const notif = await seedNotification({ title: `W5 Verify RelatedEntity ${RUN}`, relatedEntityType: "booking", relatedEntityId: 999999 });
  const { body } = await fetchList({ search: `W5 Verify RelatedEntity ${RUN}` });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].relatedEntityType, "booking");
  assert.equal(body.data[0].relatedEntityId, 999999);
  void notif;
});

// ─── 18-19: no sensitive data in response ──────────────────────────────────

test("18-19: the list response never contains a push token or unregister secret/hash anywhere in the payload", async () => {
  const student = await seedStudent();
  const device = await seedDevice(student.id);
  const notif = await seedNotification({ title: `W5 Verify NoSecrets ${RUN}` });
  await seedDeliveryLog({ notificationId: notif.id, studentId: student.id, deviceId: device.id, status: "sent" });

  const { body } = await fetchList({ search: `W5 Verify NoSecrets ${RUN}` });
  const raw = JSON.stringify(body);
  assert.ok(!/ExponentPushToken/.test(raw), "response must never contain a raw push token");
  assert.ok(!/w5-fixture-secret-hash-should-never-appear/.test(raw), "response must never contain the unregister secret hash");
  assert.ok(!/pushToken/i.test(raw), "response must never contain a pushToken field");
  assert.ok(!/unregisterSecret/i.test(raw), "response must never contain an unregisterSecretHash field");

  const detail = await fetchDetail(body.data[0].id);
  const rawDetail = JSON.stringify(detail.body);
  assert.ok(!/ExponentPushToken/.test(rawDetail));
  assert.ok(!/w5-fixture-secret-hash-should-never-appear/.test(rawDetail));
  assert.ok(!/pushToken/i.test(rawDetail));
  assert.ok(!/unregisterSecret/i.test(rawDetail));
});

// ─── 20-21: RBAC ────────────────────────────────────────────────────────────

test("20: permission denied without the required RBAC (neither, only auditLogs, only notifications)", async () => {
  const none = await fetchList({}, null);
  assert.equal(none.status, 401);

  const noPerms = await fetchList({}, "");
  assert.equal(noPerms.status, 403);

  const onlyAudit = await fetchList({}, "auditLogs:view");
  assert.equal(onlyAudit.status, 403);

  const onlyNotifications = await fetchList({}, "notifications:view");
  assert.equal(onlyNotifications.status, 403);
});

test("21: the correct combined permission grants access", async () => {
  const both = await fetchList({}, "auditLogs:view,notifications:view");
  assert.equal(both.status, 200);

  const superAdmin = await fetchList({}, "*");
  assert.equal(superAdmin.status, 200);
});

// ─── 22: Admin Activity Logs unaffected ────────────────────────────────────

test("22: Admin Activity Logs (GET /api/admin/logs) is unaffected by this router mounting alongside it", async () => {
  const res = await fetch(apiUrl(`/api/admin/logs?limit=1`), { headers: headers("auditLogs:view") });
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(Array.isArray(body.data));
  assert.ok(typeof body.total === "number");
});

// ─── filter-options endpoint ────────────────────────────────────────────────

test("filter-options returns bounded distinct type/relatedEntityType lists, gated by the same RBAC", async () => {
  await seedNotification({ title: `W5 Verify FilterOptType ${RUN}`, type: `w5_filter_option_${RUN}` });
  const denied = await fetch(apiUrl(`/api/admin/logs/notification-delivery/filter-options`), { headers: headers("notifications:view") });
  assert.equal(denied.status, 403);

  const allowed = await fetch(apiUrl(`/api/admin/logs/notification-delivery/filter-options`), { headers: headers(FULL_ACCESS) });
  assert.equal(allowed.status, 200);
  const body = await allowed.json() as any;
  assert.ok(body.types.includes(`w5_filter_option_${RUN}`));
});
