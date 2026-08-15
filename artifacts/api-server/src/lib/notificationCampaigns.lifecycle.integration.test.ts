/**
 * Notifications Wave 2 — campaign lifecycle, immutability, archive, and
 * security coverage. Real DB integration tests against a disposable local
 * Postgres (same convention as notificationSourceClassification.integration
 * .test.ts). Mounts the actual ../routes/notificationCampaigns router with
 * ../routes/adminAuth mocked out — but unlike Wave 1's classification
 * tests, this mock actually ENFORCES per-action permissions (via an
 * X-Test-Admin-Actions header) rather than blanket-allowing everything, so
 * the RBAC/spoofing tests exercise real gating, not a rubber stamp.
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

const FULL_ACCESS = "notifications:view,notifications:create,notifications:send,notifications:delete";

let pool: import("pg").Pool;
let app: import("express").Express;
let server: import("node:http").Server;
let port: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

/** actions=null means "no admin auth at all" (401), matching an unauthenticated caller. */
function adminHeaders(actions: string | null = FULL_ACCESS): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (actions !== null) headers["x-test-admin-actions"] = actions;
  return headers;
}

before(async () => {
  mock.module("../routes/adminAuth", {
    namedExports: {
      requireAdminAuth: (req: any, res: any, next: any) => {
        const actionsHeader = req.headers["x-test-admin-actions"];
        if (typeof actionsHeader !== "string") {
          res.status(401).json({ error: "Admin authentication required" });
          return;
        }
        req.adminUser = {
          sub: 1,
          id: 1,
          isSuperAdmin: actionsHeader === "*",
          username: "test-admin",
          fullName: "Test Admin",
          email: "admin@test.invalid",
          _grantedActions: actionsHeader.split(","),
        };
        next();
      },
      requireAdminPermission: (moduleKey: string, actionKey: string) => (req: any, res: any, next: any) => {
        const admin = req.adminUser;
        if (!admin) {
          res.status(401).json({ error: "Admin authentication required" });
          return;
        }
        if (admin.isSuperAdmin || (admin._grantedActions as string[]).includes(`${moduleKey}:${actionKey}`)) {
          next();
          return;
        }
        res.status(403).json({ error: "Permission denied", requiredPermission: { module: moduleKey, action: actionKey } });
      },
    },
  });

  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const expressModule = await import("express");
  const express = expressModule.default;
  const campaignsRouter = (await import("../routes/notificationCampaigns")).default;
  // Mounted alongside the campaigns router (same requireAdminAuth mock
  // target) so Part 1's legacy-endpoint-bypass tests can hit the real
  // PATCH/DELETE /api/notifications/:id handlers, not a re-implementation.
  const legacyNotificationsRouter = (await import("../routes/notifications")).default;

  app = express();
  app.use(express.json());
  app.use("/api", campaignsRouter);
  app.use("/api", legacyNotificationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'Lifecycle Verify%'`);
  // Deleting a campaign row doesn't cascade-delete its linked notification
  // (FK is notification_campaigns.notification_id -> notifications, SET
  // NULL direction only) — clean those up explicitly too.
  await pool.query(`DELETE FROM notifications WHERE title LIKE 'Lifecycle Verify%'`);
  // The "archiving retains history" test seeds one student directly (not
  // via a campaign) — must be cleaned up too, since other test FILES in
  // this suite run "all"-audience sends against the same disposable DB and
  // would otherwise pick up this leftover account as a stray extra recipient.
  await pool.query(`DELETE FROM students WHERE email LIKE 'archive-retain-%'`);
  await pool.end();
});

async function createDraft(body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(apiUrl("/api/notification-campaigns"), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Lifecycle Verify Draft", body: "draft body", audienceType: "all", ...body }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

// ─── 1: create draft ──────────────────────────────────────────────────────────

test("create draft campaign", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify Create" });
  assert.equal(campaign.status, "draft");
  assert.equal(campaign.title, "Lifecycle Verify Create");
  assert.equal(campaign.audienceType, "all");
  assert.equal(campaign.notificationId, null);
});

// ─── 2: edit draft ────────────────────────────────────────────────────────────

test("edit draft campaign content", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify Edit" });
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}`), {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Lifecycle Verify Edit (changed)", body: "changed body" }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json() as any;
  assert.equal(updated.title, "Lifecycle Verify Edit (changed)");
  assert.equal(updated.body, "changed body");
  assert.equal(updated.status, "draft");
});

// ─── 3: draft delete ──────────────────────────────────────────────────────────

test("draft campaign can be hard-deleted", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify DraftDelete" });
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}`), { method: "DELETE", headers: adminHeaders() });
  assert.equal(res.status, 204);
  const { rows } = await pool.query(`SELECT id FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  assert.equal(rows.length, 0);
});

// ─── 4-6: sent campaign immutability / archive (via direct DB send simulation) ─
// These use a raw DB status flip to "completed" rather than a real send —
// the actual send pipeline is covered end-to-end in
// notificationCampaigns.send.integration.test.ts. Here we're proving the
// PATCH/DELETE/archive endpoints enforce status correctly, independent of
// how that status was reached.

async function createAndMarkSent(titleSuffix: string): Promise<any> {
  const campaign = await createDraft({ title: `Lifecycle Verify ${titleSuffix}` });
  await pool.query(`UPDATE notification_campaigns SET status = 'completed', sent_at = now() WHERE id = $1`, [campaign.id]);
  const { rows } = await pool.query(`SELECT * FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  return rows[0];
}

test("sent campaign content cannot be edited", async () => {
  const campaign = await createAndMarkSent("SentEdit");
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}`), {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Attempted post-send edit" }),
  });
  assert.equal(res.status, 409);
  const { rows } = await pool.query(`SELECT title FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  assert.equal(rows[0].title, `Lifecycle Verify SentEdit`);
});

test("sent campaign cannot be hard-deleted", async () => {
  const campaign = await createAndMarkSent("SentDelete");
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}`), { method: "DELETE", headers: adminHeaders() });
  assert.equal(res.status, 409);
  const { rows } = await pool.query(`SELECT id FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  assert.equal(rows.length, 1, "campaign row must still exist");
});

test("sent campaign can be archived", async () => {
  const campaign = await createAndMarkSent("SentArchive");
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}/archive`), { method: "POST", headers: adminHeaders() });
  assert.equal(res.status, 200);
  const archived = await res.json() as any;
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
});

// ─── 7: archived campaign retains notification/read/delivery history ────────

test("archiving a campaign does not remove its notification row, delivery logs, or read receipts", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify ArchiveRetain" });
  const notifRes = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ('Archive Retain Notif', 'body', $1, 'manual_campaign', 'notification_campaign', $2, 'manual_admin', false, now()) RETURNING id`,
    [`campaign:${campaign.id}`, campaign.id],
  );
  const notificationId = notifRes.rows[0].id;
  await pool.query(`UPDATE notification_campaigns SET status = 'completed', notification_id = $1, sent_at = now() WHERE id = $2`, [notificationId, campaign.id]);

  const studentRes = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ('Archive Retain Student', $1, 'student', true) RETURNING id`,
    [`archive-retain-${Date.now()}@example.invalid`],
  );
  const studentId = studentRes.rows[0].id;
  await pool.query(`INSERT INTO notification_campaign_recipients (campaign_id, student_id, status) VALUES ($1, $2, 'sent')`, [campaign.id, studentId]);
  await pool.query(`INSERT INTO notification_delivery_logs (notification_id, student_id, channel, provider, status) VALUES ($1, $2, 'push', 'expo', 'sent')`, [notificationId, studentId]);
  await pool.query(`INSERT INTO notification_read_receipts (notification_id, student_id) VALUES ($1, $2)`, [notificationId, studentId]);

  const archiveRes = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}/archive`), { method: "POST", headers: adminHeaders() });
  assert.equal(archiveRes.status, 200);

  const [notifRow, deliveryRows, readRows, recipientRows] = await Promise.all([
    pool.query(`SELECT id FROM notifications WHERE id = $1`, [notificationId]),
    pool.query(`SELECT id FROM notification_delivery_logs WHERE notification_id = $1`, [notificationId]),
    pool.query(`SELECT id FROM notification_read_receipts WHERE notification_id = $1`, [notificationId]),
    pool.query(`SELECT id FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaign.id]),
  ]);
  assert.equal(notifRow.rows.length, 1, "notification row must survive archive");
  assert.equal(deliveryRows.rows.length, 1, "delivery log must survive archive");
  assert.equal(readRows.rows.length, 1, "read receipt must survive archive");
  assert.equal(recipientRows.rows.length, 1, "recipient snapshot must survive archive");

  const detailRes = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}`), { headers: adminHeaders() });
  const detail = await detailRes.json() as any;
  assert.equal(detail.aggregate.reads, 1, "reads remain aggregatable after archive");
});

// ─── 9: preview does not freeze ──────────────────────────────────────────────

test("previewing a campaign's audience does not create any recipient snapshot rows", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify PreviewNoFreeze" });
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}/preview`), { method: "POST", headers: adminHeaders() });
  assert.equal(res.status, 200);
  const preview = await res.json() as any;
  assert.ok(typeof preview.matchedAccounts === "number");
  assert.ok(typeof preview.pushEnabledAccounts === "number");
  assert.ok(typeof preview.activeDevices === "number");
  assert.ok(typeof preview.noActiveDeviceAccounts === "number");

  const { rows } = await pool.query(`SELECT id FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaign.id]);
  assert.equal(rows.length, 0, "preview must never write to notification_campaign_recipients");

  const { rows: campaignRows } = await pool.query(`SELECT status, previewed_at AS "previewedAt" FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  assert.equal(campaignRows[0].status, "draft", "preview must not change campaign status");
  assert.ok(campaignRows[0].previewedAt, "previewedAt is recorded");
});

// ─── 24: source/origin cannot be spoofed ─────────────────────────────────────

test("campaign notification source cannot be spoofed via the create/send request body", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify SpoofSource", source: "system", audienceType: "all" });
  // "source" isn't part of CreateCampaignBody's schema — it's silently
  // dropped, never reaching the insert. The campaign entity itself has no
  // source column (see the schema file's doc comment on why); what matters
  // is the eventual notifications.source value at send time, which is
  // hardcoded server-side in sendCampaign() — covered end-to-end in
  // notificationCampaigns.send.integration.test.ts's "manual_admin" test.
  assert.equal(campaign.audienceType, "all");
  const { rows } = await pool.query(`SELECT * FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  assert.equal(rows[0].source, undefined, "notification_campaigns has no source column to spoof in the first place");
});

// ─── 25: non-admin cannot create/send ────────────────────────────────────────

test("an unauthenticated caller cannot create a campaign", async () => {
  const res = await fetch(apiUrl("/api/notification-campaigns"), {
    method: "POST",
    headers: adminHeaders(null),
    body: JSON.stringify({ title: "Should not be created", body: "b", audienceType: "all" }),
  });
  assert.equal(res.status, 401);
});

test("an admin without notifications:create cannot create a campaign", async () => {
  const res = await fetch(apiUrl("/api/notification-campaigns"), {
    method: "POST",
    headers: adminHeaders("notifications:view"),
    body: JSON.stringify({ title: "Should not be created", body: "b", audienceType: "all" }),
  });
  assert.equal(res.status, 403);
});

// ─── 26: broad send still requires notifications:send ───────────────────────

test("an admin with notifications:create but not notifications:send cannot send a campaign", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify NoSendPerm" });
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}/send`), {
    method: "POST",
    headers: adminHeaders("notifications:view,notifications:create"),
  });
  assert.equal(res.status, 403);
  const { rows } = await pool.query(`SELECT status FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  assert.equal(rows[0].status, "draft", "campaign must remain unsent");
});

test("archiving requires notifications:delete", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify ArchivePerm" });
  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaign.id}/archive`), {
    method: "POST",
    headers: adminHeaders("notifications:view,notifications:create,notifications:send"),
  });
  assert.equal(res.status, 403);
});

// ─── Integrity review Part 1: legacy /notifications endpoint bypass ─────────
// A sent campaign's canonical notifications row must be immune to the
// legacy PATCH/DELETE /api/notifications/:id endpoints, not just to the
// campaign API's own PATCH/DELETE (already covered above). Without the
// findOwningCampaignId() guard added to routes/notifications.ts, an admin
// holding the exact same "notifications:*" permission the legacy composer
// already requires could edit or hard-delete campaign content directly.

async function createCampaignWithNotification(titleSuffix: string, status: string): Promise<{ campaignId: number; notificationId: number }> {
  const campaign = await createDraft({ title: `Lifecycle Verify ${titleSuffix}` });
  const { rows: notifRows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ($1, 'campaign body', $2, 'manual_campaign', 'notification_campaign', $3, 'manual_admin', false, now()) RETURNING id`,
    [`Lifecycle Verify ${titleSuffix}`, `campaign:${campaign.id}`, campaign.id],
  );
  const notificationId = notifRows[0].id;
  await pool.query(`UPDATE notification_campaigns SET status = $1, notification_id = $2, sent_at = now() WHERE id = $3`, [status, notificationId, campaign.id]);
  return { campaignId: campaign.id, notificationId };
}

test("1: a completed campaign's canonical notification cannot be PATCHed through the legacy /notifications endpoint", async () => {
  const { notificationId } = await createCampaignWithNotification("LegacyPatchBlock", "completed");
  const res = await fetch(apiUrl(`/api/notifications/${notificationId}`), {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Bypass attempt via legacy PATCH" }),
  });
  assert.equal(res.status, 409);
  const body = await res.json() as any;
  assert.equal(body.code, "CAMPAIGN_MANAGED_NOTIFICATION");
  const { rows } = await pool.query(`SELECT title FROM notifications WHERE id = $1`, [notificationId]);
  assert.equal(rows[0].title, "Lifecycle Verify LegacyPatchBlock", "notification content must be unchanged");
});

test("2: a completed campaign's canonical notification cannot be DELETEd through the legacy /notifications endpoint", async () => {
  const { notificationId, campaignId } = await createCampaignWithNotification("LegacyDeleteBlock", "completed");
  const res = await fetch(apiUrl(`/api/notifications/${notificationId}`), { method: "DELETE", headers: adminHeaders() });
  assert.equal(res.status, 409);
  const body = await res.json() as any;
  assert.equal(body.code, "CAMPAIGN_MANAGED_NOTIFICATION");

  const { rows: notifRows } = await pool.query(`SELECT id FROM notifications WHERE id = $1`, [notificationId]);
  assert.equal(notifRows.length, 1, "notification row must survive the bypass attempt");
  const { rows: campaignRows } = await pool.query(`SELECT notification_id AS "notificationId" FROM notification_campaigns WHERE id = $1`, [campaignId]);
  assert.equal(campaignRows[0].notificationId, notificationId, "campaign.notificationId must not have been silently nulled");
});

test("3: an archived campaign's canonical notification remains protected from legacy PATCH/DELETE", async () => {
  const { notificationId } = await createCampaignWithNotification("LegacyArchivedBlock", "archived");
  const patchRes = await fetch(apiUrl(`/api/notifications/${notificationId}`), {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Bypass attempt on archived campaign" }),
  });
  assert.equal(patchRes.status, 409);
  const deleteRes = await fetch(apiUrl(`/api/notifications/${notificationId}`), { method: "DELETE", headers: adminHeaders() });
  assert.equal(deleteRes.status, 409);
});

test("4: an ordinary legacy manual notification (no owning campaign) remains editable and deletable as before", async () => {
  const createRes = await fetch(apiUrl("/api/notifications"), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Lifecycle Verify OrdinaryLegacy", body: "b", target: "all", isDraft: true }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json() as any;

  const patchRes = await fetch(apiUrl(`/api/notifications/${created.id}`), {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ title: "Lifecycle Verify OrdinaryLegacy (edited)" }),
  });
  assert.equal(patchRes.status, 200, "an ordinary notification, not owned by any campaign, must still be editable");

  const deleteRes = await fetch(apiUrl(`/api/notifications/${created.id}`), { method: "DELETE", headers: adminHeaders() });
  assert.equal(deleteRes.status, 204, "an ordinary notification must still be hard-deletable");
});

test("5: a system-generated notification retains its existing (unprotected-by-this-rule) legacy PATCH/DELETE behavior", async () => {
  const { rows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, source, is_draft, sent_at)
     VALUES ('Lifecycle Verify SystemNotif', 'system body', 'student:1', 'booking_confirmed', 'system', false, now()) RETURNING id`,
  );
  const notificationId = rows[0].id;
  try {
    // No notification_campaigns row references this id, so
    // findOwningCampaignId() returns null and the legacy endpoint's
    // pre-existing behavior (unaffected by this Wave 2 fix) applies —
    // system notifications were always editable/deletable through the
    // legacy endpoint and Part 1 does not change that.
    const patchRes = await fetch(apiUrl(`/api/notifications/${notificationId}`), {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ title: "Lifecycle Verify SystemNotif (edited)" }),
    });
    assert.equal(patchRes.status, 200);
  } finally {
    await pool.query(`DELETE FROM notifications WHERE id = $1`, [notificationId]);
  }
});

test("a draft campaign (no canonical notification row yet) is unaffected by the legacy-endpoint guard", async () => {
  const campaign = await createDraft({ title: "Lifecycle Verify DraftNoNotification" });
  const { rows } = await pool.query(`SELECT notification_id AS "notificationId" FROM notification_campaigns WHERE id = $1`, [campaign.id]);
  assert.equal(rows[0].notificationId, null, "a draft campaign must not yet have a canonical notification row");
  // Nothing to protect — there's no notification id to even attempt a
  // legacy PATCH/DELETE against. This test documents that invariant rather
  // than exercising the guard itself.
});
