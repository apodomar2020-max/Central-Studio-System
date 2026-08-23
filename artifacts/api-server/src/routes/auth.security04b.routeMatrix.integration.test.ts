/**
 * Security-04B — the exact 14-case route-trust regression matrix from the
 * brief. Each case is one clear, standalone assertion so a future regression
 * shows up as a single named failure rather than buried inside a larger
 * scenario test (that broader coverage lives in
 * auth.security04b.integration.test.ts — this file is the compact matrix).
 *
 * Same real-Postgres / real-in-process-app harness as its sibling.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_SECURITY04B_MATRIX_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_security04b_matrix";

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
process.env.API_SECRET_KEY = "legacy-fake-placeholder-not-a-real-key-1111111111111111111111111111";
process.env.STUDENT_JWT_SECRET = "test-student-secret-matrix";
process.env.ADMIN_JWT_SECRET = "test-admin-secret-matrix";
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY;
process.env.IDENTITY_PROVENANCE_PEPPER = "test-regression-identity-provenance-pepper".padEnd(64, "0");

const LEGACY_BEARER = process.env.API_SECRET_KEY;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let hashUnregisterSecret: (secret: string) => string;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

type ApiResult = { status: number; json: any };
async function req(
  method: string,
  path: string,
  opts: { token?: string; adminToken?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token !== undefined) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.adminToken !== undefined) headers["x-admin-token"] = opts.adminToken;
  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const get = (path: string, opts?: Parameters<typeof req>[2]) => req("GET", path, opts);
const post = (path: string, opts?: Parameters<typeof req>[2]) => req("POST", path, opts);

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const installModule = await import("../lib/installationUnregister");
  hashUnregisterSecret = installModule.hashUnregisterSecret;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const authRouter = (await import("./auth")).default;
  const emailOtpRouter = (await import("./emailOtp")).default;
  const adminAuthRouter = (await import("./adminAuth")).default;
  const notificationsRouter = (await import("./notifications")).default;
  const danceTypesRouter = (await import("./danceTypes")).default;
  const healthRouter = (await import("./health")).default;
  const versionRouter = (await import("./version")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", healthRouter);
  app.use("/api", versionRouter);
  app.use("/api", authRouter);
  app.use("/api", emailOtpRouter);
  app.use("/api", adminAuthRouter);
  app.use("/api", notificationsRouter);
  app.use("/api", danceTypesRouter);
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
  return `matrix-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeVerifiedStudent(tag: string, password = "OriginalPass123") {
  const email = freshEmail(tag);
  const reg = await post("/api/auth/register", { body: { name: "Matrix Test User", email, password } });
  assert.equal(reg.status, 201);
  const studentId: number = reg.json.student.id;
  await pool.query(`UPDATE students SET email_verified = true, email_verified_at = now() WHERE id = $1`, [studentId]);
  const login = await post("/api/auth/login", { body: { email, password } });
  assert.equal(login.status, 200);
  return { studentId, token: login.json.accessToken as string, email, password };
}

async function makeAdmin(tag: string): Promise<{ adminId: number; token: string }> {
  const bcryptModule = await import("bcryptjs");
  const bcrypt = (bcryptModule as any).default ?? bcryptModule;
  const username = `matrix-${tag}-${Date.now()}`.slice(0, 30).replace(/[^a-z0-9_]/gi, "_");
  const email = freshEmail(`admin-${tag}`);
  const passwordHash = await bcrypt.hash("AdminPass123!", 10);
  const r = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active)
     VALUES ($1, $2, $3, 'Matrix Admin', true, true) RETURNING id`,
    [username, email, passwordHash],
  );
  const adminId = r.rows[0].id as number;
  const token = jwtSign({ sub: adminId, username, isSuperAdmin: true, roleId: null }, process.env.ADMIN_JWT_SECRET!);
  return { adminId, token };
}

async function makeDevice(secret: string): Promise<string> {
  const { studentId } = await makeVerifiedStudent(`dev${Math.random().toString(36).slice(2, 8)}`);
  const deviceId = `matrix-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, device_id, is_active, unregister_secret_hash)
     VALUES ($1, $2, 'expo', 'ios', $3, true, $4)`,
    [studentId, `ExponentPushToken[${deviceId}]`, deviceId, hashUnregisterSecret(secret)],
  );
  return deviceId;
}

async function deviceIsActive(deviceId: string): Promise<boolean> {
  const r = await pool.query(`SELECT is_active FROM notification_devices WHERE device_id = $1`, [deviceId]);
  return r.rows[0].is_active as boolean;
}

// ═════════════════════════════════════════════════════════════════════════════
// The 14-case matrix
// ═════════════════════════════════════════════════════════════════════════════

test("1. public GET, no credential at all -> 200", async () => {
  const res = await get("/api/dance-types");
  assert.equal(res.status, 200);
});

test("2. public GET, legacy non-JWT bearer -> 200 (key is inert)", async () => {
  const res = await get("/api/dance-types", { token: LEGACY_BEARER });
  assert.equal(res.status, 200);
});

test("3. auth/login, no key at all -> reaches the real route (not a global 401/403)", async () => {
  const res = await post("/api/auth/login", { body: { email: "no-such-user@example.com", password: "x" } });
  assert.equal(res.status, 401); // the ROUTE's own "invalid credentials", not the global gate
  assert.notEqual(res.json.error, "Missing authentication credentials");
});

test("4. auth/login, legacy bearer -> reaches the real route (identical outcome to case 3)", async () => {
  const res = await post("/api/auth/login", { token: LEGACY_BEARER, body: { email: "no-such-user@example.com", password: "x" } });
  assert.equal(res.status, 401);
  assert.notEqual(res.json.error, "Missing authentication credentials");
});

test("5. student route, no token -> 401", async () => {
  const res = await get("/api/auth/me");
  assert.equal(res.status, 401);
});

test("6. student route, legacy-bearer-only -> 401 (key does not substitute for identity)", async () => {
  const res = await get("/api/auth/me", { token: LEGACY_BEARER });
  assert.equal(res.status, 401);
});

test("7. student route, valid JWT -> 200/allowed", async () => {
  const { token, email } = await makeVerifiedStudent("case7");
  const res = await get("/api/auth/me", { token });
  assert.equal(res.status, 200);
  assert.equal(res.json.student.email, email);
});

test("8. student route, invalid-JWT-shaped bearer -> rejected (401), not silently anonymous", async () => {
  const res = await get("/api/auth/me", { token: "not.a.validjwt" });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, "Invalid or expired token");
});

test("9. revoked student JWT -> SESSION_REVOKED", async () => {
  const { token } = await makeVerifiedStudent("case9");
  await post("/api/auth/logout", { token });
  const res = await get("/api/auth/me", { token });
  assert.equal(res.status, 401);
  assert.equal(res.json.code, "SESSION_REVOKED");
});

test("10. admin route, valid admin token + no API key at all -> allowed", async () => {
  const { token: adminToken } = await makeAdmin("case10");
  const res = await get("/api/admin/auth/me", { adminToken });
  assert.equal(res.status, 200);
});

test("11. admin route, API-key-shaped-bearer-only (no admin token) -> rejected", async () => {
  const res = await get("/api/admin/auth/me", { token: LEGACY_BEARER });
  assert.equal(res.status, 401);
});

test("12. admin route, student JWT (no admin token) -> rejected", async () => {
  const { token } = await makeVerifiedStudent("case12");
  const res = await get("/api/admin/auth/me", { token });
  assert.equal(res.status, 401);
});

test("13. device-unregister still enforces its own credential, independent of requireAuth", async () => {
  const secret = "matrix-case13-secret-ffffffffffffffffffffffffffffffff";
  const deviceId = await makeDevice(secret);

  const wrong = await post("/api/notifications/devices/unregister-by-installation", {
    body: { deviceId, unregisterSecret: "totally-wrong-secret-gggggggggggggggggggggggggggggg" },
  });
  assert.equal(wrong.status, 200); // oracle-resistant response
  assert.equal(await deviceIsActive(deviceId), true, "wrong secret must not deactivate");

  const right = await post("/api/notifications/devices/unregister-by-installation", {
    body: { deviceId, unregisterSecret: secret },
  });
  assert.equal(right.status, 200);
  assert.equal(await deviceIsActive(deviceId), false, "correct secret must deactivate");
});

test("14. /healthz and /version unchanged (no credential needed, no credential effect)", async () => {
  const h1 = await get("/api/healthz");
  assert.equal(h1.status, 200);
  const h2 = await get("/api/healthz", { token: LEGACY_BEARER });
  assert.equal(h2.status, 200);
  const v1 = await get("/api/version");
  assert.equal(v1.status, 200);
  const v2 = await get("/api/version", { token: LEGACY_BEARER });
  assert.equal(v2.status, 200);
});
