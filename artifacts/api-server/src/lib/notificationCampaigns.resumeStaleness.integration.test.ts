/**
 * Notifications Wave 4 review fix — `canResume` is now a server-computed
 * field on both the campaign list and detail responses (isCampaignStaleSending,
 * notificationCampaigns.ts), reusing the exact same threshold/semantics
 * resumeCampaign()'s own atomic claim uses. The Admin client reads this
 * field directly and no longer reproduces the configurable
 * NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES business rule itself — see
 * artifacts/admin/src/lib/notificationCampaigns.ts's doc comment (no local
 * isCampaignSafeToResume helper exists there anymore; grep-verified).
 *
 * Real DB integration test, same HTTP-mounted-router convention as
 * notificationCampaigns.lifecycle.integration.test.ts.
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
delete process.env.PUSH_NOTIFICATIONS_ENABLED;
delete process.env.NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES;

const FULL_ACCESS = "notifications:view,notifications:create,notifications:send,notifications:delete";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let pool: import("pg").Pool;
let app: import("express").Express;
let server: import("node:http").Server;
let port: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

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
  const campaignsRouter = (await import("../routes/notificationCampaigns")).default;
  app = express();
  app.use(express.json());
  app.use("/api", campaignsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

beforeEach(async () => {
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'ResumeStaleness Verify%'`);
  delete process.env.NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES;
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'ResumeStaleness Verify%'`);
  await pool.end();
});

async function seedCampaign(title: string, opts: { status: string; heartbeatMinutesAgo: number | null }): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status, notification_id) VALUES ($1, 'body', 'all_members', $2, NULL) RETURNING id`,
    [title, opts.status],
  );
  const heartbeatExpr = opts.heartbeatMinutesAgo == null ? "null" : `now() - interval '${opts.heartbeatMinutesAgo} minutes'`;
  await pool.query(`UPDATE notification_campaigns SET last_send_heartbeat_at = ${heartbeatExpr} WHERE id = $1`, [rows[0].id]);
  return rows[0].id;
}

async function fetchDetail(id: number): Promise<any> {
  const res = await fetch(apiUrl(`/api/notification-campaigns/${id}`), { headers: adminHeaders() });
  return res.json() as any;
}

async function fetchListRow(id: number, search: string): Promise<any> {
  const res = await fetch(apiUrl(`/api/notification-campaigns?search=${encodeURIComponent(search)}`), { headers: adminHeaders() });
  const body = await res.json() as any;
  return body.data.find((c: any) => c.id === id);
}

test("1: an actively sending campaign (recent heartbeat) → canResume false", async () => {
  const id = await seedCampaign("ResumeStaleness Verify Active", { status: "sending", heartbeatMinutesAgo: 0 });
  const detail = await fetchDetail(id);
  assert.equal(detail.canResume, false);
  const listRow = await fetchListRow(id, "ResumeStaleness Verify Active");
  assert.equal(listRow.canResume, false);
});

test("2: a stale sending campaign (heartbeat past the default threshold) → canResume true", async () => {
  const id = await seedCampaign("ResumeStaleness Verify Stale", { status: "sending", heartbeatMinutesAgo: 10 });
  const detail = await fetchDetail(id);
  assert.equal(detail.canResume, true);
  const listRow = await fetchListRow(id, "ResumeStaleness Verify Stale");
  assert.equal(listRow.canResume, true);
});

test("3: a completed campaign → canResume false regardless of heartbeat age", async () => {
  const id = await seedCampaign("ResumeStaleness Verify Completed", { status: "completed", heartbeatMinutesAgo: 30 });
  const detail = await fetchDetail(id);
  assert.equal(detail.canResume, false);
});

test("4: an archived campaign → canResume false regardless of heartbeat age", async () => {
  const id = await seedCampaign("ResumeStaleness Verify Archived", { status: "archived", heartbeatMinutesAgo: 30 });
  const detail = await fetchDetail(id);
  assert.equal(detail.canResume, false);
});

test("5: a custom NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES threshold is honored by canResume, not just the default", async () => {
  process.env.NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES = "20";
  try {
    // 10 minutes old: stale under the DEFAULT (5 min) but NOT stale under this custom 20-minute threshold.
    const id = await seedCampaign("ResumeStaleness Verify CustomThreshold", { status: "sending", heartbeatMinutesAgo: 10 });
    const detail = await fetchDetail(id);
    assert.equal(detail.canResume, false, "10 minutes old must not be stale under a 20-minute configured threshold");
  } finally {
    delete process.env.NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES;
  }
});

test("a sending campaign that never received a heartbeat at all (crashed before the first page) → canResume true", async () => {
  const id = await seedCampaign("ResumeStaleness Verify NoHeartbeat", { status: "sending", heartbeatMinutesAgo: null });
  const detail = await fetchDetail(id);
  assert.equal(detail.canResume, true);
});

test("6: the Admin client source contains no hardcoded stale-sending-minutes business-rule comparison — it reads campaign.canResume from the server instead", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const adminLibPath = path.resolve(import.meta.dirname, "../../../admin/src/lib/notificationCampaigns.ts");
  const adminDetailDialogPath = path.resolve(import.meta.dirname, "../../../admin/src/components/admin/campaign-detail-dialog.tsx");
  const libSource = fs.readFileSync(adminLibPath, "utf8");
  const detailSource = fs.readFileSync(adminDetailDialogPath, "utf8");

  // No client-side minute-threshold CONSTANT or arithmetic against a
  // heartbeat anywhere in these files. Mentioning the backend's env var
  // name in prose (explaining what the client deliberately does NOT do) is
  // fine and expected — what must never reappear is an actual local
  // constant definition, a re-implemented isCampaignSafeToResume, or
  // millisecond/minute arithmetic against lastSendHeartbeatAt.
  assert.ok(!/const\s+\w*STALE_SENDING_MINUTES\w*\s*=/.test(libSource), "admin lib must not define its own stale-minutes constant");
  assert.ok(!/function isCampaignSafeToResume/.test(libSource), "the removed client-side staleness function must not have been reintroduced (mentioning its removal in a comment is fine)");
  assert.ok(!/heartbeatAge/i.test(libSource) && !/\* 60 \* 1000/.test(libSource), "no client-side millisecond/minute threshold arithmetic against lastSendHeartbeatAt");
  assert.ok(detailSource.includes("campaign.canResume"), "the detail dialog must read the server-computed canResume field");
});
