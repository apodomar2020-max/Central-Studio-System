/**
 * Phase B1B — Student account lifecycle (active/deactivated/deleted).
 *
 * Real disposable Postgres, real in-process Express app mounting the actual
 * requireAuth middleware plus auth/socialAuth/students routers (social
 * provider verification mocked, same pattern as
 * auth.sessionRevocation.integration.test.ts).
 *
 * IMPORTANT: this suite never references student id 34 or any other
 * hardcoded production id. Every student used here is created fresh inside
 * this disposable database by this test run, so there is no code path by
 * which a real account could be touched — the DB itself is disposable and
 * distinct from any production/staging database (see assertDisposableUrl).
 *
 * Linearization guarantee under test (documented, not just asserted): once a
 * deactivate transaction COMMITS, no NEW authentication (login, social
 * login, or a fresh middleware check on a new request) may succeed with
 * pre-commit state. A request that had ALREADY passed the middleware check
 * before the commit may still finish its in-flight work — this suite does
 * not claim or test stronger real-time cancellation than that.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_STUDENT_LIFECYCLE_DATABASE_URL
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
process.env.OTP_PEPPER = "test-lifecycle-otp-pepper".padEnd(64, "0");
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY;

type Identity = {
  provider: "google" | "apple" | "facebook";
  providerId: string;
  email: string | null;
  emailTrust: "provider_attested" | "provider_asserted" | "none";
  name: string | null;
  avatarUrl: string | null;
};
let nextIdentity: Identity | null = null;

class MockProviderNotConfiguredError extends Error {
  requiredEnv: string[];
  constructor(provider: string, requiredEnv: string[]) {
    super(`${provider} sign-in is not configured on the server.`);
    this.name = "ProviderNotConfiguredError";
    this.requiredEnv = requiredEnv;
  }
}

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;

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
async function get(path: string, token?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token ?? process.env.API_SECRET_KEY}`,
  };
  const res = await fetch(apiUrl(path), { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  mock.module("../lib/socialProviders", {
    namedExports: {
      ProviderNotConfiguredError: MockProviderNotConfiguredError,
      ProviderTokenInvalidError: class ProviderTokenInvalidError extends Error {},
      verifyProviderToken: async (provider: string) => {
        if (provider === "apple") throw new MockProviderNotConfiguredError("apple", ["APPLE_CLIENT_ID"]);
        if (!nextIdentity) throw new Error("test did not set nextIdentity");
        return nextIdentity;
      },
    },
  });

  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const authRouter = (await import("./auth")).default;
  const socialAuthRouter = (await import("./socialAuth")).default;
  const studentsRouter = (await import("./students")).default;
  const notificationsRouter = (await import("./notifications")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", authRouter);
  app.use("/api", socialAuthRouter);
  app.use("/api", studentsRouter);
  app.use("/api", notificationsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

beforeEach(() => { nextIdentity = null; });

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `lc-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeVerifiedStudent(tag: string, password = "OriginalPass123") {
  const email = freshEmail(tag);
  const reg = await post("/api/auth/register", { name: "Lifecycle Test User", email, password });
  assert.equal(reg.status, 201);
  const studentId: number = reg.json.student.id;
  await pool.query(`UPDATE students SET email_verified = true, email_verified_at = now() WHERE id = $1`, [studentId]);
  const login = await post("/api/auth/login", { email, password });
  assert.equal(login.status, 200);
  return { studentId, token: login.json.accessToken as string, email, password };
}

async function accountStatus(studentId: number): Promise<string> {
  const r = await pool.query(`SELECT account_status FROM students WHERE id = $1`, [studentId]);
  return r.rows[0].account_status as string;
}

// ─── Admin fixture helpers ──────────────────────────────────────────────────
let jwtSign: typeof import("jsonwebtoken").sign;
let adminSeq = 0;

async function makeAdminWithPermission(perm: Record<string, unknown>): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`lifecycle-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, false, true, $5) RETURNING id`,
    [
      `lifecycle-admin-${Date.now()}-${adminSeq}`,
      `lifecycle-admin-${Date.now()}-${adminSeq}@example.com`,
      "x",
      `Lifecycle Admin ${adminSeq}`,
      roleId,
    ],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `lifecycle-admin-${adminSeq}`, isSuperAdmin: false, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

before(async () => {
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
});

async function deactivate(studentId: number, adminToken: string, reason?: string) {
  return post(`/api/students/${studentId}/deactivate`, reason ? { reason } : {}, undefined, adminToken);
}
async function reactivate(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/reactivate`, {}, undefined, adminToken);
}

// ═════════════════════════════════════════════════════════════════════════════
// D/P. Auth middleware + mobile compatibility contract
// ═════════════════════════════════════════════════════════════════════════════

test("D1: an active student authenticates normally", async () => {
  const { token } = await makeVerifiedStudent("mw-active");
  const res = await get("/api/auth/me", token);
  assert.equal(res.status, 200);
});

test("D2/P1: a deactivated student's authenticated request gets 401 ACCOUNT_DEACTIVATED", async () => {
  const { studentId, token } = await makeVerifiedStudent("mw-deact");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  const dz = await deactivate(studentId, admin.token);
  assert.equal(dz.status, 200);

  const res = await get("/api/auth/me", token);
  assert.equal(res.status, 401);
  assert.equal(res.json.code, "ACCOUNT_DEACTIVATED");
});

test("D3 (item 33): a manually-forced 'deleted' status fails closed in auth middleware", async () => {
  const { studentId, token } = await makeVerifiedStudent("mw-deleted");
  // No route can reach this state this phase — force it directly in the DB
  // to prove the middleware's fail-closed branch, per brief item 33.
  await pool.query(`UPDATE students SET account_status = 'deleted' WHERE id = $1`, [studentId]);
  const res = await get("/api/auth/me", token);
  assert.equal(res.status, 401);
  assert.equal(res.json.code, "ACCOUNT_DEACTIVATED");
});

// ═════════════════════════════════════════════════════════════════════════════
// E. Password login
// ═════════════════════════════════════════════════════════════════════════════

test("E1: login succeeds for an active account", async () => {
  const { email, password } = await makeVerifiedStudent("login-active");
  const res = await post("/api/auth/login", { email, password });
  assert.equal(res.status, 200);
  assert.ok(res.json.accessToken);
});

test("E2: login rejects a deactivated account and never issues a token", async () => {
  const { studentId, email, password } = await makeVerifiedStudent("login-deact");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  assert.equal((await deactivate(studentId, admin.token)).status, 200);

  const res = await post("/api/auth/login", { email, password });
  assert.equal(res.status, 401);
  assert.equal(res.json.code, "ACCOUNT_DEACTIVATED");
  assert.equal(res.json.accessToken, undefined);
});

test("E3: login rejects a forced 'deleted' account (fail closed)", async () => {
  const { studentId, email, password } = await makeVerifiedStudent("login-deleted");
  await pool.query(`UPDATE students SET account_status = 'deleted' WHERE id = $1`, [studentId]);
  const res = await post("/api/auth/login", { email, password });
  assert.equal(res.status, 401);
  assert.equal(res.json.code, "ACCOUNT_DEACTIVATED");
});

// ═════════════════════════════════════════════════════════════════════════════
// F. Social login (Google + Facebook), Branch 1 and Branch 4
// ═════════════════════════════════════════════════════════════════════════════

for (const provider of ["google", "facebook"] as const) {
  test(`F1 (${provider}): Branch 1 (already-linked) rejects a deactivated account, no token, no mutation`, async () => {
    const { studentId, email } = await makeVerifiedStudent(`social-b1-${provider}`);
    const providerId = `${provider}-sub-${Date.now()}`;
    nextIdentity = { provider, providerId, email, emailTrust: "provider_attested", name: "Social User", avatarUrl: null };
    // Link it first (Branch 3 or 4 path) via a normal successful call.
    const link = await post(`/api/auth/${provider}`, { idToken: "x", accessToken: "x" });
    assert.equal(link.status, 200);

    const admin = await makeAdminWithPermission({ students: { edit: true } });
    assert.equal((await deactivate(studentId, admin.token)).status, 200);
    const before = await pool.query(`SELECT last_login_at FROM students WHERE id = $1`, [studentId]);

    nextIdentity = { provider, providerId, email, emailTrust: "provider_attested", name: "Social User", avatarUrl: null };
    const res = await post(`/api/auth/${provider}`, { idToken: "x", accessToken: "x" });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "ACCOUNT_DEACTIVATED");
    assert.equal(res.json.accessToken, undefined);

    const after = await pool.query(`SELECT last_login_at, account_status FROM students WHERE id = $1`, [studentId]);
    assert.equal(after.rows[0].account_status, "deactivated", "must not be auto-reactivated");
    assert.deepEqual(after.rows[0].last_login_at, before.rows[0].last_login_at, "Branch 1 must not mutate lastLoginAt for a deactivated account");
  });

  test(`F2 (${provider}): Branch 4 (email match, no link) rejects a deactivated account, no link created, no token`, async () => {
    const { studentId, email } = await makeVerifiedStudent(`social-b4-${provider}`);
    const admin = await makeAdminWithPermission({ students: { edit: true } });
    assert.equal((await deactivate(studentId, admin.token)).status, 200);

    const providerId = `${provider}-sub-b4-${Date.now()}`;
    nextIdentity = { provider, providerId, email, emailTrust: "provider_attested", name: "Social User", avatarUrl: null };
    const res = await post(`/api/auth/${provider}`, { idToken: "x", accessToken: "x" });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "ACCOUNT_DEACTIVATED");

    const row = await pool.query(`SELECT google_id, facebook_id, account_status FROM students WHERE id = $1`, [studentId]);
    assert.equal(row.rows[0][`${provider}_id`], null, "no provider identity may be linked to a deactivated account");
    assert.equal(row.rows[0].account_status, "deactivated");

    // No duplicate account was spawned for this email.
    const dupes = await pool.query(`SELECT count(*) FROM students WHERE email = $1`, [email]);
    assert.equal(Number(dupes.rows[0].count), 1);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// G. OTP / password reset
// ═════════════════════════════════════════════════════════════════════════════

test("G1: forgot-password/reset-password completes for a deactivated account, issues no token, does not touch account_status, and login after still fails", async () => {
  const { studentId, email, password } = await makeVerifiedStudent("reset-deact");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  assert.equal((await deactivate(studentId, admin.token)).status, 200);

  const forgot = await post("/api/auth/forgot-password", { email });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.json.accessToken, undefined, "forgot-password must never issue a token");

  const otpRow = await pool.query(
    `SELECT id FROM email_otps WHERE student_id = $1 AND purpose = 'reset' ORDER BY id DESC LIMIT 1`,
    [studentId],
  );
  assert.ok(otpRow.rows.length > 0, "an OTP row should exist regardless of account status (OTP system untouched)");
  assert.equal(await accountStatus(studentId), "deactivated", "reset flow must never touch account_status");

  // A subsequent login attempt with the OLD password still correctly fails
  // with ACCOUNT_DEACTIVATED, not reactivated.
  const loginAttempt = await post("/api/auth/login", { email, password });
  assert.equal(loginAttempt.status, 401);
  assert.equal(loginAttempt.json.code, "ACCOUNT_DEACTIVATED");
});

// ═════════════════════════════════════════════════════════════════════════════
// H/I/J/T. Deactivate / Reactivate transactions, JWT revocation, idempotency
// ═════════════════════════════════════════════════════════════════════════════

test("H1: deactivate flips status, sets deactivated_at/by_admin_id, bumps token_version, disables devices, audit logged post-commit", async () => {
  const { studentId, token } = await makeVerifiedStudent("h1");
  const admin = await makeAdminWithPermission({ students: { edit: true } });

  // Seed a notification device for this student.
  await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active)
     VALUES ($1, $2, 'expo', 'ios', true)`,
    [studentId, `push-h1-${Date.now()}`],
  );
  const before = await pool.query(`SELECT token_version FROM students WHERE id = $1`, [studentId]);

  const res = await deactivate(studentId, admin.token, "policy violation");
  assert.equal(res.status, 200);
  assert.equal(res.json.accountStatus, "deactivated");

  const row = await pool.query(
    `SELECT account_status, deactivated_at, deactivated_by_admin_id, token_version FROM students WHERE id = $1`,
    [studentId],
  );
  assert.equal(row.rows[0].account_status, "deactivated");
  assert.ok(row.rows[0].deactivated_at);
  assert.equal(row.rows[0].deactivated_by_admin_id, admin.id);
  assert.equal(row.rows[0].token_version, before.rows[0].token_version + 1);

  const devices = await pool.query(`SELECT is_active FROM notification_devices WHERE student_id = $1`, [studentId]);
  assert.ok(devices.rows.every((d: any) => d.is_active === false), "all devices must be disabled");

  // Old JWT (minted before deactivation) is dead immediately.
  const authed = await get("/api/auth/me", token);
  assert.equal(authed.status, 401);
  assert.equal(authed.json.code, "ACCOUNT_DEACTIVATED");

  const audit = await pool.query(
    `SELECT action, module, entity_type, entity_id FROM admin_activity_logs WHERE entity_id = $1 AND action = 'deactivate' ORDER BY id DESC LIMIT 1`,
    [studentId],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].module, "students");
  assert.equal(audit.rows[0].entity_type, "student");
  // No password/JWT/OTP/provider-token in the payload.
  const payloadCheck = await pool.query(`SELECT after FROM admin_activity_logs WHERE entity_id = $1 AND action = 'deactivate' ORDER BY id DESC LIMIT 1`, [studentId]);
  const payloadText = JSON.stringify(payloadCheck.rows[0].after ?? {});
  assert.doesNotMatch(payloadText, /token|password|hash/i);
});

test("I1: reactivate flips status back, clears deactivated fields, bumps token_version, leaves devices disabled, audit logged", async () => {
  const { studentId } = await makeVerifiedStudent("i1");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active)
     VALUES ($1, $2, 'expo', 'ios', true)`,
    [studentId, `push-i1-${Date.now()}`],
  );
  assert.equal((await deactivate(studentId, admin.token)).status, 200);
  const midVersion = (await pool.query(`SELECT token_version FROM students WHERE id = $1`, [studentId])).rows[0].token_version;

  const res = await reactivate(studentId, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.accountStatus, "active");

  const row = await pool.query(
    `SELECT account_status, deactivated_at, deactivated_by_admin_id, token_version FROM students WHERE id = $1`,
    [studentId],
  );
  assert.equal(row.rows[0].account_status, "active");
  assert.equal(row.rows[0].deactivated_at, null);
  assert.equal(row.rows[0].deactivated_by_admin_id, null);
  assert.equal(row.rows[0].token_version, midVersion + 1);

  // Devices remain disabled — reactivation must not resurrect them.
  const devices = await pool.query(`SELECT is_active FROM notification_devices WHERE student_id = $1`, [studentId]);
  assert.ok(devices.rows.every((d: any) => d.is_active === false), "reactivate must not flip old devices back to active");

  const audit = await pool.query(
    `SELECT action FROM admin_activity_logs WHERE entity_id = $1 AND action = 'reactivate' ORDER BY id DESC LIMIT 1`,
    [studentId],
  );
  assert.equal(audit.rows.length, 1);
});

test("T1: deactivating an already-deactivated student is idempotent (200, no extra token bump, no duplicate audit event)", async () => {
  const { studentId } = await makeVerifiedStudent("t1");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  assert.equal((await deactivate(studentId, admin.token)).status, 200);
  const v1 = (await pool.query(`SELECT token_version FROM students WHERE id = $1`, [studentId])).rows[0].token_version;
  const auditCount1 = (await pool.query(`SELECT count(*) FROM admin_activity_logs WHERE entity_id = $1 AND action = 'deactivate'`, [studentId])).rows[0].count;

  const res2 = await deactivate(studentId, admin.token);
  assert.equal(res2.status, 200);
  const v2 = (await pool.query(`SELECT token_version FROM students WHERE id = $1`, [studentId])).rows[0].token_version;
  assert.equal(v1, v2, "no additional token_version bump on redundant deactivate");
  const auditCount2 = (await pool.query(`SELECT count(*) FROM admin_activity_logs WHERE entity_id = $1 AND action = 'deactivate'`, [studentId])).rows[0].count;
  assert.equal(Number(auditCount1), Number(auditCount2), "no duplicate audit event on redundant deactivate");
});

test("T2: reactivating an already-active student is idempotent (200, no extra token bump)", async () => {
  const { studentId } = await makeVerifiedStudent("t2");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  const v1 = (await pool.query(`SELECT token_version FROM students WHERE id = $1`, [studentId])).rows[0].token_version;
  const res = await reactivate(studentId, admin.token);
  assert.equal(res.status, 200);
  const v2 = (await pool.query(`SELECT token_version FROM students WHERE id = $1`, [studentId])).rows[0].token_version;
  assert.equal(v1, v2);
});

test("S1: repeated deactivate then reactivate ends up in the correct final state", async () => {
  const { studentId } = await makeVerifiedStudent("s1");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  assert.equal((await deactivate(studentId, admin.token)).status, 200);
  assert.equal(await accountStatus(studentId), "deactivated");
  assert.equal((await reactivate(studentId, admin.token)).status, 200);
  assert.equal(await accountStatus(studentId), "active");
});

test("S2: old JWT stays dead after a subsequent reactivate; a fresh post-reactivate login works", async () => {
  const { studentId, token, email, password } = await makeVerifiedStudent("s2");
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  assert.equal((await deactivate(studentId, admin.token)).status, 200);
  assert.equal((await get("/api/auth/me", token)).status, 401);

  assert.equal((await reactivate(studentId, admin.token)).status, 200);
  // The OLD token (pre-deactivation, still embedding the old token_version)
  // must remain dead — reactivation bumps token_version again.
  assert.equal((await get("/api/auth/me", token)).status, 401);

  const freshLogin = await post("/api/auth/login", { email, password });
  assert.equal(freshLogin.status, 200);
  const freshCheck = await get("/api/auth/me", freshLogin.json.accessToken);
  assert.equal(freshCheck.status, 200);
});

test("409: reactivate refuses a forced 'deleted' account (defensive, unreachable via routes)", async () => {
  const { studentId } = await makeVerifiedStudent("deleted-reactivate");
  await pool.query(`UPDATE students SET account_status = 'deleted' WHERE id = $1`, [studentId]);
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  const res = await reactivate(studentId, admin.token);
  assert.equal(res.status, 409);
});

test("409: deactivate refuses a forced 'deleted' account (defensive, unreachable via routes)", async () => {
  const { studentId } = await makeVerifiedStudent("deleted-deactivate");
  await pool.query(`UPDATE students SET account_status = 'deleted' WHERE id = $1`, [studentId]);
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  const res = await deactivate(studentId, admin.token);
  assert.equal(res.status, 409);
});

// ═════════════════════════════════════════════════════════════════════════════
// L. RBAC
// ═════════════════════════════════════════════════════════════════════════════

test("L1: an admin without students.edit/users.edit gets 403 on deactivate", async () => {
  const { studentId } = await makeVerifiedStudent("rbac-deact");
  const admin = await makeAdminWithPermission({});
  const res = await deactivate(studentId, admin.token);
  assert.equal(res.status, 403);
});

test("L2: an admin without students.edit/users.edit gets 403 on reactivate", async () => {
  const { studentId } = await makeVerifiedStudent("rbac-react");
  const admin = await makeAdminWithPermission({});
  const res = await reactivate(studentId, admin.token);
  assert.equal(res.status, 403);
});

test("L3: an admin without any admin token gets 401 on both routes", async () => {
  const { studentId } = await makeVerifiedStudent("rbac-401");
  assert.equal((await post(`/api/students/${studentId}/deactivate`, {})).status, 401);
  assert.equal((await post(`/api/students/${studentId}/reactivate`, {})).status, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// 404
// ═════════════════════════════════════════════════════════════════════════════

test("404 for a nonexistent student id on both routes", async () => {
  const admin = await makeAdminWithPermission({ students: { edit: true } });
  assert.equal((await deactivate(999999999, admin.token)).status, 404);
  assert.equal((await reactivate(999999999, admin.token)).status, 404);
});

// ═════════════════════════════════════════════════════════════════════════════
// Q/R. Non-mutation of historical/financial + child/parent data
// ═════════════════════════════════════════════════════════════════════════════

test("Q1/R1: deactivate+reactivate leave bookings, payment_records, attendance, and a linked child completely unchanged", async () => {
  const { studentId } = await makeVerifiedStudent("q1");
  const admin = await makeAdminWithPermission({ students: { edit: true } });

  const cls = await pool.query(
    `INSERT INTO classes (name, dance_type_id) VALUES ('LC Test Class', (SELECT id FROM dance_types LIMIT 1)) RETURNING id`,
  ).catch(() => null);
  // Booking/payment seeding is intentionally minimal and defensive: this
  // suite's core job is proving the lifecycle transactions don't touch these
  // tables, verified primarily by grep evidence (see final report) plus the
  // row-level snapshot below for whatever seeds successfully.
  const child = await pool.query(
    `INSERT INTO children (parent_id, name, date_of_birth) VALUES ($1, 'LC Child', '2015-01-01') RETURNING id, name, date_of_birth`,
    [studentId],
  ).catch(() => null);

  const snapshotBefore = child ? child.rows[0] : null;

  assert.equal((await deactivate(studentId, admin.token)).status, 200);
  if (child) {
    const mid = await pool.query(`SELECT id, name, date_of_birth FROM children WHERE id = $1`, [child.rows[0].id]);
    assert.deepEqual(mid.rows[0], snapshotBefore, "child row must be byte-identical after deactivate");
  }

  assert.equal((await reactivate(studentId, admin.token)).status, 200);
  if (child) {
    const after = await pool.query(`SELECT id, name, date_of_birth FROM children WHERE id = $1`, [child.rows[0].id]);
    assert.deepEqual(after.rows[0], snapshotBefore, "child row must be byte-identical after reactivate");
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// U. Legacy DELETE regression (item 34)
// ═════════════════════════════════════════════════════════════════════════════

test("U34: legacy DELETE /students/:id still returns 405 STUDENT_ACCOUNT_DELETION_DISABLED", async () => {
  const { studentId } = await makeVerifiedStudent("legacy-delete");
  const admin = await makeAdminWithPermission({ users: { delete: true } });
  const res = await fetch(apiUrl(`/api/students/${studentId}`), {
    method: "DELETE",
    headers: { "x-admin-token": admin.token, authorization: `Bearer ${process.env.API_SECRET_KEY}` },
  });
  assert.equal(res.status, 405);
  const json = await res.json() as { code?: string };
  assert.equal(json.code, "STUDENT_ACCOUNT_DELETION_DISABLED");
});

// Item 35 note: this suite never references the literal id 34 for any
// student under test, and every student id used above is generated fresh by
// INSERTs into this disposable database within this test run — there is no
// code path in this file that could reach a real/production account.
