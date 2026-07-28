/**
 * Finance Roles & Permissions integration — real-route coverage for the new
 * finance.view / finance.exports gates on GET /finance/overview,
 * /finance/transactions, and /finance/export.
 *
 * Same boot/auth/safety-gate conventions as bookings.financeConfirmation /
 * packageOrders.financeConfirmation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATABASE_URL = process.env.DISPOSABLE_HOTFIX_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_hotfix";

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

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

// Boots the real built server (dist/index.mjs) as a subprocess rather than
// importing routes/finance.ts directly, because finance.ts's static
// `import { Workbook } from "exceljs"` doesn't resolve as a named export
// under node:test's raw ESM loader (a tsx-loader/exceljs interop quirk —
// esbuild's bundler, used for the real dist build, handles it fine, which
// is why the built artifact is what's exercised here).
let child: ChildProcess;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

let superAdminId: number;
let noFinanceAdminId: number;
let viewOnlyAdminId: number;
let viewPlusExportsAdminId: number;
let exportsOnlyAdminId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function tokenFor(adminId: number, isSuperAdmin = false): string {
  return jwtSign({ sub: adminId, username: `finance-roles-${adminId}`, isSuperAdmin, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, adminId: number, isSuperAdmin = false): Promise<Response> {
  return fetch(apiUrl(path), {
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": tokenFor(adminId, isSuperAdmin),
    },
  });
}

function waitForHealthy(baseUrl: string, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/healthz`);
        if (res.ok) { resolve(); return; }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) { reject(new Error("Server did not become healthy in time")); return; }
      setTimeout(attempt, 200);
    };
    void attempt();
  });
}

before(async () => {
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const here = dirname(fileURLToPath(import.meta.url));
  const entry = join(here, "..", "..", "dist", "index.mjs");
  port = 20000 + Math.floor(Math.random() * 10000);
  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(port),
      API_SECRET_KEY: "test-api-secret-key",
      NODE_ENV: "test",
    },
    stdio: "pipe",
  });
  await waitForHealthy(`http://127.0.0.1:${port}`, Date.now() + 15000);

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  superAdminId = existingSuper.rows.length > 0
    ? (existingSuper.rows[0].id as number)
    : (await pool.query(
        `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin) VALUES ($1, $2, 'x', 'Finance Roles Super', true) RETURNING id`,
        [`finance-roles-super-${run}`, `finance-roles-super-${run}@example.com`],
      )).rows[0].id as number;

  async function makeAdmin(label: string, permissions: Record<string, unknown>): Promise<number> {
    const role = await pool.query(
      `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
      [`Finance Roles ${label} ${run}`, JSON.stringify(permissions)],
    );
    const user = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id) VALUES ($1, $2, 'x', $3, false, $4) RETURNING id`,
      [`finance-roles-${label}-${run}`, `finance-roles-${label}-${run}@example.com`, `Finance Roles ${label}`, role.rows[0].id],
    );
    return user.rows[0].id as number;
  }

  // Rich, realistic non-Finance grants — proves finance.view is required
  // even for an admin who can already see dashboard/bookings/packages/etc.
  const richOperationalPermissions = {
    dashboard: { view: true },
    bookings: { view: true },
    packageOrders: { view: true },
    attendance: { view: true },
    "ballet.payments": { view: true },
    promotions: { view: true },
    credits: { history: true },
    reports: { view: true, exportExcel: true, exportPdf: true },
  };

  noFinanceAdminId = await makeAdmin("no-finance", richOperationalPermissions);
  viewOnlyAdminId = await makeAdmin("view-only", { ...richOperationalPermissions, finance: { view: true } });
  viewPlusExportsAdminId = await makeAdmin("view-plus-exports", { ...richOperationalPermissions, finance: { view: true, exports: true } });
  exportsOnlyAdminId = await makeAdmin("exports-only", { ...richOperationalPermissions, finance: { exports: true } });
});

after(async () => {
  child.kill();
  await pool.end();
});

// ─── finance.view gates ordinary Finance reads ───────────────────────────────

test("an admin without finance.view gets 403 on /finance/overview, even with rich operational permissions", async () => {
  const res = await asAdmin("/api/finance/overview", noFinanceAdminId);
  assert.equal(res.status, 403);
});

test("an admin without finance.view gets 403 on /finance/transactions", async () => {
  const res = await asAdmin("/api/finance/transactions", noFinanceAdminId);
  assert.equal(res.status, 403);
});

test("an admin with finance.view can open /finance/overview", async () => {
  const res = await asAdmin("/api/finance/overview", viewOnlyAdminId);
  assert.equal(res.status, 200);
});

test("an admin with finance.view can open /finance/transactions", async () => {
  const res = await asAdmin("/api/finance/transactions", viewOnlyAdminId);
  assert.equal(res.status, 200);
});

// ─── finance.exports requires BOTH finance.view AND finance.exports ─────────

test("finance.view without finance.exports returns 403 on export, no file generated", async () => {
  const res = await asAdmin("/api/finance/export?format=json", viewOnlyAdminId);
  assert.equal(res.status, 403);
});

test("finance.exports without finance.view returns 403 on export, no file generated", async () => {
  const res = await asAdmin("/api/finance/export?format=json", exportsOnlyAdminId);
  assert.equal(res.status, 403);
});

test("neither finance.view nor finance.exports returns 403 on export", async () => {
  const res = await asAdmin("/api/finance/export?format=json", noFinanceAdminId);
  assert.equal(res.status, 403);
});

test("Dashboard response omits every financial amount for all roles", async () => {
  const financialKeys = [
    "totalRevenue", "grossGenericBookingRevenueEgp", "grossGenericPackageRevenueEgp",
    "grossBalletRevenueEgp", "balletCompletedRefundsEgp",
    "balletPendingRefundExposureEgp", "balletNetRevenueEgp",
    "totalGrossRevenueEgp", "totalNetRevenueEgp",
    "balletPayAtStudioRevenueEgp", "balletOnlineRevenueEgp",
    "balletLegacyBankTransferRevenueEgp", "approvedProcessingRefundExposureEgp",
  ];
  for (const [label, adminId, isSuperAdmin] of [
    ["no Finance", noFinanceAdminId, false],
    ["finance.view", viewOnlyAdminId, false],
    ["Super Admin", superAdminId, true],
  ] as const) {
    const res = await asAdmin("/api/dashboard", adminId, isSuperAdmin);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(typeof body.totalBookings, "number", `${label} keeps operational metrics`);
    for (const key of financialKeys) {
      assert.equal(key in body, false, `${key} must be absent for ${label}`);
    }
  }
});

test("finance.view AND finance.exports together succeed on export", async () => {
  const res = await asAdmin("/api/finance/export?format=json", viewPlusExportsAdminId);
  assert.equal(res.status, 200);
});

// ─── Super Admin ──────────────────────────────────────────────────────────────

test("Super Admin retains full Finance access with no finance.* grants at all", async () => {
  const overview = await asAdmin("/api/finance/overview", superAdminId, true);
  assert.equal(overview.status, 200);
  const transactions = await asAdmin("/api/finance/transactions", superAdminId, true);
  assert.equal(transactions.status, 200);
  const exportRes = await asAdmin("/api/finance/export?format=json", superAdminId, true);
  assert.equal(exportRes.status, 200);
});

// ─── Unauthenticated ──────────────────────────────────────────────────────────

test("an unauthenticated request to /finance/overview follows existing authentication behavior (401)", async () => {
  const res = await fetch(apiUrl("/api/finance/overview"), {
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key" },
  });
  assert.equal(res.status, 401);
});
