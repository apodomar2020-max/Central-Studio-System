/**
 * Notifications Wave 2 — mobile visibility coverage: proves the new
 * `campaign:{id}` target pattern is visible ONLY to accounts in the
 * campaign's frozen recipient snapshot, through the real, unmocked
 * ../routes/notifications router (GET /notifications/my,
 * POST /notifications/:id/read) — the exact endpoints the mobile app
 * calls. No admin-auth mocking needed here; this only exercises the
 * student-JWT-gated endpoints, which are real end-to-end.
 *
 * Also proves existing "all" / "student:{id}" rows behave completely
 * unchanged (test #30 from the Wave 2 requirements).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

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
process.env.STUDENT_JWT_SECRET = "test-student-secret";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let pool: import("pg").Pool;
let app: import("express").Express;
let server: import("node:http").Server;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let studentSeq = 0;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function seedStudent(): Promise<{ id: number; email: string }> {
  studentSeq += 1;
  const email = `campaign-visibility-${RUN}-${studentSeq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ($1, $2, 'student', true) RETURNING id`,
    [`Campaign Visibility ${studentSeq}`, email],
  );
  return { id: rows[0].id, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

// requireAuth's extractToken() checks the X-Api-Key header BEFORE
// Authorization: Bearer — sending both would make it use the shared API key
// (never setting req.studentId) and silently ignore the student JWT. Only
// the Bearer header may be present on a student-authenticated request.
async function authedGet(path: string, studentId: number, email: string) {
  return fetch(apiUrl(path), { headers: { Authorization: `Bearer ${studentToken(studentId, email)}` } });
}

async function authedPost(path: string, studentId: number, email: string) {
  return fetch(apiUrl(path), { method: "POST", headers: { Authorization: `Bearer ${studentToken(studentId, email)}` } });
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const notificationsRouter = (await import("../routes/notifications")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", notificationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE campaign_id IN (SELECT id FROM notification_campaigns WHERE title LIKE 'Visibility Verify%')`);
  await pool.query(`DELETE FROM notifications WHERE id IN (SELECT notification_id FROM notification_campaigns WHERE title LIKE 'Visibility Verify%' AND notification_id IS NOT NULL)`);
  await pool.query(`DELETE FROM notifications WHERE title LIKE 'Visibility Verify%'`);
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'Visibility Verify%'`);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`campaign-visibility-${RUN}-%`]);
  await pool.end();
});

async function seedSentCampaignWithRecipients(title: string, recipientStudentIds: number[]): Promise<{ campaignId: number; notificationId: number }> {
  const { rows: campaignRows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status, sent_at) VALUES ($1, 'visibility body', 'all', 'completed', now()) RETURNING id`,
    [title],
  );
  const campaignId = campaignRows[0].id;
  const { rows: notifRows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ($1, 'visibility body', $2, 'manual_campaign', 'notification_campaign', $3, 'manual_admin', false, now()) RETURNING id`,
    [title, `campaign:${campaignId}`, campaignId],
  );
  const notificationId = notifRows[0].id;
  await pool.query(`UPDATE notification_campaigns SET notification_id = $1 WHERE id = $2`, [notificationId, campaignId]);
  for (const studentId of recipientStudentIds) {
    await pool.query(`INSERT INTO notification_campaign_recipients (campaign_id, student_id, status) VALUES ($1, $2, 'sent')`, [campaignId, studentId]);
  }
  return { campaignId, notificationId };
}

test("a student inside the frozen recipient snapshot sees the campaign notification in /notifications/my", async () => {
  const inSnapshot = await seedStudent();
  await seedSentCampaignWithRecipients("Visibility Verify InSnapshot", [inSnapshot.id]);

  const res = await authedGet("/api/notifications/my", inSnapshot.id, inSnapshot.email);
  assert.equal(res.status, 200);
  const rows = await res.json() as Array<{ title: string }>;
  assert.ok(rows.some((r) => r.title === "Visibility Verify InSnapshot"), "recipient must see the campaign notification");
});

test("a student outside the frozen recipient snapshot does NOT see the campaign notification, even though it exists", async () => {
  const inSnapshot = await seedStudent();
  const outsideSnapshot = await seedStudent();
  await seedSentCampaignWithRecipients("Visibility Verify OutsideSnapshot", [inSnapshot.id]);

  const res = await authedGet("/api/notifications/my", outsideSnapshot.id, outsideSnapshot.email);
  assert.equal(res.status, 200);
  const rows = await res.json() as Array<{ title: string }>;
  assert.ok(!rows.some((r) => r.title === "Visibility Verify OutsideSnapshot"), "a non-recipient must never see the campaign notification, proving visibility is scoped to the frozen snapshot, not to a live re-evaluation of the audience");
});

test("a student inside the snapshot can mark the campaign notification read; a student outside it gets 404", async () => {
  const inSnapshot = await seedStudent();
  const outsideSnapshot = await seedStudent();
  const { notificationId } = await seedSentCampaignWithRecipients("Visibility Verify ReadGate", [inSnapshot.id]);

  const insideRes = await authedPost(`/api/notifications/${notificationId}/read`, inSnapshot.id, inSnapshot.email);
  assert.equal(insideRes.status, 200);
  const insideBody = await insideRes.json() as any;
  assert.equal(insideBody.isRead, true);

  const outsideRes = await authedPost(`/api/notifications/${notificationId}/read`, outsideSnapshot.id, outsideSnapshot.email);
  assert.equal(outsideRes.status, 404, "a non-recipient must not be able to mark a campaign notification they cannot see as read");
});

test("legacy target='all' notifications remain visible to every student, unaffected by campaign visibility logic", async () => {
  const student = await seedStudent();
  const { rows } = await pool.query(
    `INSERT INTO notifications (title, body, target, source, is_draft, sent_at)
     VALUES ('Visibility Verify LegacyAll', 'legacy body', 'all', 'manual_admin', false, now()) RETURNING id`,
  );
  const legacyId = rows[0].id;
  try {
    const res = await authedGet("/api/notifications/my", student.id, student.email);
    assert.equal(res.status, 200);
    const notifRows = await res.json() as Array<{ title: string }>;
    assert.ok(notifRows.some((r) => r.title === "Visibility Verify LegacyAll"), "target='all' visibility must be completely unchanged by Wave 2");
  } finally {
    await pool.query(`DELETE FROM notifications WHERE id = $1`, [legacyId]);
  }
});

test("legacy target='student:{id}' notifications remain visible only to that student, unaffected by campaign visibility logic", async () => {
  const owner = await seedStudent();
  const other = await seedStudent();
  const { rows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, source, is_draft, sent_at)
     VALUES ('Visibility Verify LegacyStudent', 'legacy body', $1, 'booking_confirmed', 'system', false, now()) RETURNING id`,
    [`student:${owner.id}`],
  );
  const legacyId = rows[0].id;
  try {
    const ownerRes = await authedGet("/api/notifications/my", owner.id, owner.email);
    const ownerRows = await ownerRes.json() as Array<{ title: string }>;
    assert.ok(ownerRows.some((r) => r.title === "Visibility Verify LegacyStudent"));

    const otherRes = await authedGet("/api/notifications/my", other.id, other.email);
    const otherRows = await otherRes.json() as Array<{ title: string }>;
    assert.ok(!otherRows.some((r) => r.title === "Visibility Verify LegacyStudent"));
  } finally {
    await pool.query(`DELETE FROM notifications WHERE id = $1`, [legacyId]);
  }
});
