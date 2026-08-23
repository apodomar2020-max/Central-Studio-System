/**
 * Phase B1D Step 1 — Student /overview response now exposes accountStatus
 * and deactivatedAt (read-only), needed by the Admin lifecycle UI.
 *
 * Real disposable Postgres, real in-process Express app, same harness
 * pattern as students.accountLifecycle.integration.test.ts. Never
 * references student id 34 or any hardcoded production id.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_STUDENT_OVERVIEW_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_student_lifecycle";

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
process.env.ADMIN_JWT_SECRET = "test-admin-secret";
process.env.OTP_PEPPER = "test-overview-otp-pepper".padEnd(64, "0");
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY;
process.env.IDENTITY_PROVENANCE_PEPPER = "test-regression-identity-provenance-pepper".padEnd(64, "0");

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }
type ApiResult = { status: number; json: any };
async function post(path: string, body: unknown, token?: string, adminToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token ?? process.env.API_SECRET_KEY}`,
  };
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(path: string, adminToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${process.env.API_SECRET_KEY}` };
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(apiUrl(path), { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const authRouter = (await import("./auth")).default;
  const studentsRouter = (await import("./students")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", authRouter);
  app.use("/api", studentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `ov-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string) {
  const email = freshEmail(tag);
  const reg = await post("/api/auth/register", { name: "Overview Test User", email, password: "OriginalPass123" });
  assert.equal(reg.status, 201);
  return reg.json.student.id as number;
}

let adminSeq = 0;
async function makeAdmin(): Promise<string> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`overview-role-${Date.now()}-${adminSeq}`, JSON.stringify({ students: { view: true, edit: true } })],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, false, true, $5) RETURNING id`,
    [
      `overview-admin-${Date.now()}-${adminSeq}`,
      `overview-admin-${Date.now()}-${adminSeq}@example.com`,
      "x",
      `Overview Admin ${adminSeq}`,
      roleId,
    ],
  );
  const id = user.rows[0].id as number;
  return jwtSign({ sub: id, username: `overview-admin-${adminSeq}`, isSuperAdmin: false, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
}

// 1. active student overview returns accountStatus = active
test("1: active student overview returns accountStatus = active", async () => {
  const studentId = await makeStudent("active");
  const admin = await makeAdmin();
  const res = await get(`/api/students/${studentId}/overview`, admin);
  assert.equal(res.status, 200);
  assert.equal(res.json.user.accountStatus, "active");
});

// 2/3. deactivated fixture overview returns accountStatus = deactivated, deactivatedAt returned
test("2/3: deactivated student overview returns accountStatus = deactivated and a real deactivatedAt", async () => {
  const studentId = await makeStudent("deact");
  const admin = await makeAdmin();
  const dz = await post(`/api/students/${studentId}/deactivate`, {}, undefined, admin);
  assert.equal(dz.status, 200);

  const res = await get(`/api/students/${studentId}/overview`, admin);
  assert.equal(res.status, 200);
  assert.equal(res.json.user.accountStatus, "deactivated");
  assert.ok(res.json.user.deactivatedAt, "deactivatedAt must be a real timestamp string");
  assert.ok(!Number.isNaN(Date.parse(res.json.user.deactivatedAt)), "deactivatedAt must be parseable");
});

// 4. null deactivatedAt handled correctly for active accounts
test("4: active student overview returns deactivatedAt = null (not undefined, not a stale value)", async () => {
  const studentId = await makeStudent("null-deact-at");
  const admin = await makeAdmin();
  const res = await get(`/api/students/${studentId}/overview`, admin);
  assert.equal(res.status, 200);
  assert.equal(res.json.user.deactivatedAt, null);
});

// 5/6. no PII/Finance/Booking behavior change, existing overview fields unchanged
test("5/6: overview response's pre-existing fields are unaffected by the new lifecycle fields", async () => {
  const studentId = await makeStudent("unaffected");
  const admin = await makeAdmin();
  const res = await get(`/api/students/${studentId}/overview`, admin);
  assert.equal(res.status, 200);
  // Pre-existing fields must still be present and correctly shaped.
  assert.equal(typeof res.json.user.id, "number");
  assert.equal(typeof res.json.user.name, "string");
  assert.equal(typeof res.json.user.email, "string");
  assert.ok("nationality" in res.json.user);
  assert.ok("howDidYouHearAboutUs" in res.json.user);
  assert.ok("policiesAcceptedAt" in res.json.user);
  // qrToken/tokenVersion are deliberately present on this admin-only overview
  // endpoint (pre-existing, unrelated to this phase) — only the actual secret
  // (the bcrypt hash) must never appear.
  assert.equal("passwordHash" in res.json.user, false);
});
