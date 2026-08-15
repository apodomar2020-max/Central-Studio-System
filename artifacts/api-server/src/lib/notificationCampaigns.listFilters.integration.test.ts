/**
 * Notifications Wave 4 — minimal API support added for the Manual Push
 * Notifications Admin UI: campaign list filters (status, audienceType,
 * search, date range, includeArchived) and the createdByAdminName LEFT
 * JOIN (list + detail). Real DB integration test, same HTTP-mounted-router
 * convention as notificationCampaigns.lifecycle.integration.test.ts.
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

const FULL_ACCESS = "notifications:view,notifications:create,notifications:send,notifications:delete";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let pool: import("pg").Pool;
let app: import("express").Express;
let server: import("node:http").Server;
let port: number;
let adminId: number;

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
        if (typeof actionsHeader !== "string") {
          res.status(401).json({ error: "Admin authentication required" });
          return;
        }
        req.adminUser = { sub: adminId, id: adminId, isSuperAdmin: actionsHeader === "*", username: "test-admin", fullName: "Test Admin", email: "admin@test.invalid", _grantedActions: actionsHeader.split(",") };
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

  const { rows } = await pool.query(
    `INSERT INTO system_users (username, email, full_name, password_hash) VALUES ($1, $2, 'List Filters Verify Admin', 'x') RETURNING id`,
    [`w4-listfilters-${RUN}`, `w4-listfilters-${RUN}@example.invalid`],
  );
  adminId = rows[0].id;

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
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'ListFilters Verify%'`);
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'ListFilters Verify%'`);
  await pool.query(`DELETE FROM system_users WHERE username LIKE $1`, [`w4-listfilters-${RUN}%`]);
  await pool.end();
});

async function createDraft(title: string, audienceType = "all_members"): Promise<{ id: number }> {
  const res = await fetch(apiUrl("/api/notification-campaigns"), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ title, body: "list filters test body", audienceType, audienceConfig: {} }),
  });
  return res.json() as any;
}

test("list filters by status", async () => {
  const draft = await createDraft("ListFilters Verify Status");
  const res = await fetch(apiUrl(`/api/notification-campaigns?status=draft&search=${encodeURIComponent("ListFilters Verify Status")}`), { headers: adminHeaders() });
  const body = await res.json() as any;
  assert.equal(res.status, 200);
  assert.ok(body.data.some((c: any) => c.id === draft.id));
  assert.ok(body.data.every((c: any) => c.status === "draft"));
});

test("list filters by audienceType", async () => {
  await createDraft("ListFilters Verify AudienceA", "students");
  await createDraft("ListFilters Verify AudienceB", "parents");
  const res = await fetch(apiUrl(`/api/notification-campaigns?audienceType=students&search=${encodeURIComponent("ListFilters Verify Audience")}`), { headers: adminHeaders() });
  const body = await res.json() as any;
  assert.ok(body.data.length >= 1);
  assert.ok(body.data.every((c: any) => c.audienceType === "students"));
});

test("list filters by title search", async () => {
  await createDraft("ListFilters Verify UniqueSearchTerm12345");
  const res = await fetch(apiUrl(`/api/notification-campaigns?search=UniqueSearchTerm12345`), { headers: adminHeaders() });
  const body = await res.json() as any;
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].title, "ListFilters Verify UniqueSearchTerm12345");
});

test("archived campaigns are excluded from the default list but included with includeArchived=true or an explicit status=archived filter", async () => {
  const draft = await createDraft("ListFilters Verify ArchiveMe");
  await fetch(apiUrl(`/api/notification-campaigns/${draft.id}/archive`), { method: "POST", headers: adminHeaders() });

  const defaultRes = await fetch(apiUrl(`/api/notification-campaigns?search=${encodeURIComponent("ListFilters Verify ArchiveMe")}`), { headers: adminHeaders() });
  const defaultBody = await defaultRes.json() as any;
  assert.equal(defaultBody.data.length, 0, "archived campaign must not appear in the default view");

  const includeRes = await fetch(apiUrl(`/api/notification-campaigns?includeArchived=true&search=${encodeURIComponent("ListFilters Verify ArchiveMe")}`), { headers: adminHeaders() });
  const includeBody = await includeRes.json() as any;
  assert.equal(includeBody.data.length, 1, "includeArchived=true must surface it");

  const statusRes = await fetch(apiUrl(`/api/notification-campaigns?status=archived&search=${encodeURIComponent("ListFilters Verify ArchiveMe")}`), { headers: adminHeaders() });
  const statusBody = await statusRes.json() as any;
  assert.equal(statusBody.data.length, 1, "an explicit status=archived filter must surface it regardless of includeArchived");
});

test("createdByAdminName resolves via the system_users join on both list and detail", async () => {
  const draft = await createDraft("ListFilters Verify CreatorName");
  const listRes = await fetch(apiUrl(`/api/notification-campaigns?search=${encodeURIComponent("ListFilters Verify CreatorName")}`), { headers: adminHeaders() });
  const listBody = await listRes.json() as any;
  assert.equal(listBody.data[0].createdByAdminName, "List Filters Verify Admin");

  const detailRes = await fetch(apiUrl(`/api/notification-campaigns/${draft.id}`), { headers: adminHeaders() });
  const detailBody = await detailRes.json() as any;
  assert.equal(detailBody.createdByAdminName, "List Filters Verify Admin");
});

test("a deleted admin's campaigns show createdByAdminName=null (safe fallback, not a broken join)", async () => {
  const { rows } = await pool.query(
    `INSERT INTO system_users (username, email, full_name, password_hash) VALUES ($1, $2, 'Soon Deleted Admin', 'x') RETURNING id`,
    [`w4-listfilters-deleted-${RUN}`, `w4-listfilters-deleted-${RUN}@example.invalid`],
  );
  const deletedAdminId = rows[0].id;
  const { rows: campaignRows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status, created_by_admin_id) VALUES ($1, 'body', 'all_members', 'draft', $2) RETURNING id`,
    ["ListFilters Verify DeletedCreator", deletedAdminId],
  );
  await pool.query(`DELETE FROM system_users WHERE id = $1`, [deletedAdminId]); // ON DELETE SET NULL on created_by_admin_id

  const res = await fetch(apiUrl(`/api/notification-campaigns/${campaignRows[0].id}`), { headers: adminHeaders() });
  const body = await res.json() as any;
  assert.equal(body.createdByAdminId, null);
  assert.equal(body.createdByAdminName, null);
});
