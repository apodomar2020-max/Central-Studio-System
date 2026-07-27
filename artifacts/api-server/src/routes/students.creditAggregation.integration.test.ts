/**
 * Finance Final Closure Batch 1 — Part B1 regression coverage.
 *
 * Confirmed bug: GET /students/:id/overview's activePackagePromise used
 * `.limit(1)`, so a parent with more than one active package (e.g. an old
 * 3-credit package plus a newly activated 4-credit package) had its
 * `stats.remainingCredits` show only ONE package's balance, never the sum.
 *
 * This test proves the fix over real HTTP against a real Postgres row set:
 * 3 + 4 = 7, a deduction on one package brings the total to 6, and an
 * expired package's credits are excluded from the total.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_CREDIT_AGG_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_credit_agg";

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

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let packageId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `credit-agg-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

async function makeStudent(run: string, label: string): Promise<{ id: number; email: string }> {
  const email = `credit-agg-${run}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000000', 'parent') RETURNING id`,
    [`Credit Agg Test ${label}`, email],
  );
  return { id: result.rows[0].id as number, email };
}

async function makePackageOrder(
  student: { id: number; email: string },
  opts: { totalCredits: number; remainingCredits: number; status: string; expiresAt?: string | null },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status, activated_at, expires_at)
     VALUES ($1, $2, $3, $4, 'Credit Agg Test Package', $5, $6, $7, now(), $8)
     RETURNING id`,
    [
      "Credit Agg Test",
      student.email,
      student.id,
      packageId,
      opts.totalCredits,
      opts.remainingCredits,
      opts.status,
      opts.expiresAt ?? null,
    ],
  );
  return result.rows[0].id as number;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const studentsRouter = (await import("./students")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", studentsRouter);
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
       VALUES ($1, $2, 'x', 'Credit Agg Super', true) RETURNING id`,
      [`credit-agg-super-${run}`, `credit-agg-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months) VALUES ($1, 'per_class', 1000, 8, 6) RETURNING id`,
    [`Credit Agg Test Package ${run}`],
  );
  packageId = pkg.rows[0].id as number;
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

test("old package (3 credits) + newly activated package (4 credits) = 7 available credits, not one package's balance", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "sum");
  await makePackageOrder(student, { totalCredits: 3, remainingCredits: 3, status: "active" });
  await makePackageOrder(student, { totalCredits: 4, remainingCredits: 4, status: "active" });

  const res = await asAdmin(`/api/students/${student.id}/overview`);
  assert.equal(res.status, 200);
  const body = await res.json() as { stats: { remainingCredits: number; availableCredits: number; activePackages: Array<{ remainingCredits: number }> } };

  assert.equal(body.stats.remainingCredits, 7, "remainingCredits must be the SUM across both active packages, not one");
  assert.equal(body.stats.availableCredits, 7);
  assert.equal(body.stats.activePackages.length, 2, "contributing package list must include both active packages");
});

test("one valid deduction on a summed balance updates the total from 7 to 6", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "deduct");
  const olderOrderId = await makePackageOrder(student, { totalCredits: 3, remainingCredits: 3, status: "active" });
  await makePackageOrder(student, { totalCredits: 4, remainingCredits: 4, status: "active" });

  const before7 = await asAdmin(`/api/students/${student.id}/overview`);
  const body7 = await before7.json() as { stats: { remainingCredits: number } };
  assert.equal(body7.stats.remainingCredits, 7);

  // Simulate one attendance deduction against the older package (mirrors
  // checkInService.ts's UPDATE package_orders SET remaining_credits = remaining_credits - 1).
  await pool.query(`UPDATE package_orders SET remaining_credits = remaining_credits - 1 WHERE id = $1`, [olderOrderId]);

  const after6 = await asAdmin(`/api/students/${student.id}/overview`);
  const body6 = await after6.json() as { stats: { remainingCredits: number } };
  assert.equal(body6.stats.remainingCredits, 6, "the aggregate total must reflect the deduction across all surfaces reading this endpoint");
});

test("expired package's credits are excluded from the available-credits total", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "expired");
  await makePackageOrder(student, { totalCredits: 4, remainingCredits: 4, status: "active" });
  // An "expired" package_orders row (a real operational status distinct from
  // "active") must not contribute to the available-credits total.
  await makePackageOrder(student, { totalCredits: 5, remainingCredits: 5, status: "expired" });

  const res = await asAdmin(`/api/students/${student.id}/overview`);
  const body = await res.json() as { stats: { remainingCredits: number; activePackages: unknown[] } };
  assert.equal(body.stats.remainingCredits, 4, "expired package's 5 credits must not be summed in");
  assert.equal(body.stats.activePackages.length, 1);
});

test("cancelled and fullyUsed packages are also excluded from the total", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "excluded-statuses");
  await makePackageOrder(student, { totalCredits: 4, remainingCredits: 4, status: "active" });
  await makePackageOrder(student, { totalCredits: 3, remainingCredits: 3, status: "cancelled" });
  await makePackageOrder(student, { totalCredits: 2, remainingCredits: 0, status: "fullyUsed" });

  const res = await asAdmin(`/api/students/${student.id}/overview`);
  const body = await res.json() as { stats: { remainingCredits: number } };
  assert.equal(body.stats.remainingCredits, 4);
});

test("a student with no active packages shows 0 available credits, not a single stale package value", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run, "none");

  const res = await asAdmin(`/api/students/${student.id}/overview`);
  const body = await res.json() as { stats: { remainingCredits: number; activePackages: unknown[] } };
  assert.equal(body.stats.remainingCredits, 0);
  assert.deepEqual(body.stats.activePackages, []);
});
