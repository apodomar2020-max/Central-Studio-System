/**
 * Security-04B — CS-SEC-??? retire API_SECRET_KEY from authorization.
 *
 * Proves the new requireAuth state machine end-to-end against a real
 * disposable Postgres + real in-process Express app mounting the actual
 * auth/emailOtp/adminAuth/notifications/classes routers:
 *
 *   - a missing or non-JWT-shaped credential is anonymous, never 401 at the
 *     global gate — the shared API key ("X-Api-Key" / a non-JWT Bearer) is
 *     completely inert;
 *   - a JWT-shaped bearer is still verified exactly as before (valid ->
 *     identity attached; invalid/expired/wrong-type/revoked -> 401, it must
 *     NEVER be silently downgraded to anonymous);
 *   - downstream gates (requireStudentAuth via /auth/me, requireAdminAuth via
 *     /admin/auth/me) are completely unaffected — they still 401/403 on
 *     missing identity regardless of what requireAuth now allows through;
 *   - the device-unregister route's own unregisterSecret check is proven
 *     fully independent of this middleware change;
 *   - the auth-rate-limiter mount order in app.ts is confirmed unaffected.
 *
 * Harness mirrors auth.sessionRevocation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATABASE_URL = process.env.DISPOSABLE_SECURITY04B_AUTH_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_security04b_auth";

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
// This is a FAKE placeholder value, never a real secret — used only to prove
// that the legacy shared key is now inert. It intentionally still gets set
// so any code that merely reads (but no longer authorizes on) the env var
// keeps working identically either way.
process.env.API_SECRET_KEY = "legacy-fake-placeholder-not-a-real-key-0000000000000000000000000000";
process.env.STUDENT_JWT_SECRET = "test-student-secret-s04b";
process.env.ADMIN_JWT_SECRET = "test-admin-secret-s04b";
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY;

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
  opts: { token?: string; apiKeyHeader?: string; adminToken?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token !== undefined) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.apiKeyHeader !== undefined) headers["x-api-key"] = opts.apiKeyHeader;
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
  return `s04b-${tag}-${Date.now()}-${seq}@example.com`;
}

/** Registers + verifies a fresh student, returns a valid current access token. */
async function makeVerifiedStudent(tag: string, password = "OriginalPass123") {
  const email = freshEmail(tag);
  const reg = await post("/api/auth/register", { body: { name: "S04B Test User", email, password } });
  assert.equal(reg.status, 201);
  const studentId: number = reg.json.student.id;
  await pool.query(`UPDATE students SET email_verified = true, email_verified_at = now() WHERE id = $1`, [studentId]);
  const login = await post("/api/auth/login", { body: { email, password } });
  assert.equal(login.status, 200);
  return { studentId, token: login.json.accessToken as string, email, password };
}

/** Creates a Super Admin row directly and returns a valid admin JWT for it. */
async function makeAdmin(tag: string): Promise<{ adminId: number; token: string }> {
  const bcryptModule = await import("bcryptjs");
  const bcrypt = (bcryptModule as any).default ?? bcryptModule;
  const username = `s04b-${tag}-${Date.now()}`.slice(0, 30).replace(/[^a-z0-9_]/gi, "_");
  const email = freshEmail(`admin-${tag}`);
  const passwordHash = await bcrypt.hash("AdminPass123!", 10);
  const r = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active)
     VALUES ($1, $2, $3, 'S04B Admin', true, true) RETURNING id`,
    [username, email, passwordHash],
  );
  const adminId = r.rows[0].id as number;
  const token = jwtSign({ sub: adminId, username, isSuperAdmin: true, roleId: null }, process.env.ADMIN_JWT_SECRET!);
  return { adminId, token };
}

async function makeDevice(secret: string): Promise<{ studentId: number; deviceId: string }> {
  const { studentId } = await makeVerifiedStudent(`dev${Math.random().toString(36).slice(2, 8)}`);
  const deviceId = `install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, device_id, is_active, unregister_secret_hash)
     VALUES ($1, $2, 'expo', 'ios', $3, true, $4)`,
    [studentId, `ExponentPushToken[${deviceId}]`, deviceId, hashUnregisterSecret(secret)],
  );
  return { studentId, deviceId };
}

async function deviceIsActive(deviceId: string): Promise<boolean> {
  const r = await pool.query(`SELECT is_active FROM notification_devices WHERE device_id = $1`, [deviceId]);
  return r.rows[0].is_active as boolean;
}

function decodeJwt(token: string): any {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

// ═════════════════════════════════════════════════════════════════════════════
// E/F. Old-mobile / old-admin compatibility + new keyless client
// ═════════════════════════════════════════════════════════════════════════════

test("E1: legacy non-JWT bearer on a public catalog GET -> 200 (never compared against anything)", async () => {
  const res = await get("/api/dance-types", { token: LEGACY_BEARER });
  assert.equal(res.status, 200);
});

test("E2: same route with NO Authorization header at all -> 200 (identical outcome)", async () => {
  const res = await get("/api/dance-types");
  assert.equal(res.status, 200);
});

test("E3: legacy non-JWT bearer on /auth/login reaches the real handler (not a global 401/403)", async () => {
  const res = await post("/api/auth/login", { token: LEGACY_BEARER, body: { email: "nope@example.com", password: "x" } });
  // The route itself rejects bad credentials with 401 — but that 401 comes
  // from auth.ts's OWN business logic, not from requireAuth's global gate.
  // Distinguish by body shape: the route's own message, not the global one.
  assert.equal(res.status, 401);
  assert.notEqual(res.json.error, "Missing authentication credentials");
  assert.notEqual(res.json.error, "Invalid credentials");
});

test("E4: /auth/login with NO header at all also reaches the real handler (identical to E3's outcome)", async () => {
  const res = await post("/api/auth/login", { body: { email: "nope@example.com", password: "x" } });
  assert.equal(res.status, 401);
  assert.notEqual(res.json.error, "Missing authentication credentials");
});

test("E5: /auth/register with legacy bearer succeeds exactly as with no header", async () => {
  const withLegacy = await post("/api/auth/register", {
    token: LEGACY_BEARER,
    body: { name: "Legacy Client", email: freshEmail("legacyreg"), password: "SomePass123" },
  });
  assert.equal(withLegacy.status, 201);

  const withNone = await post("/api/auth/register", {
    body: { name: "Keyless Client", email: freshEmail("keylessreg"), password: "SomePass123" },
  });
  assert.equal(withNone.status, 201);
});

test("E6: valid student JWT -> unchanged behavior (still authenticates /auth/me)", async () => {
  const { token, email } = await makeVerifiedStudent("validjwt");
  const res = await get("/api/auth/me", { token });
  assert.equal(res.status, 200);
  assert.equal(res.json.student.email, email);
});

test("F1: X-Api-Key header with the legacy value is also inert on a public route", async () => {
  const res = await get("/api/dance-types", { apiKeyHeader: LEGACY_BEARER });
  assert.equal(res.status, 200);
});

test("F2: student route (/auth/me) with NOTHING -> 401 (downstream requireStudentAuth still enforces identity)", async () => {
  const res = await get("/api/auth/me");
  assert.equal(res.status, 401);
});

test("F3: student route with legacy bearer ONLY (no JWT) -> 401 — the key does not substitute for identity", async () => {
  const res = await get("/api/auth/me", { token: LEGACY_BEARER });
  assert.equal(res.status, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// G. Admin compatibility / keyless admin client
// ═════════════════════════════════════════════════════════════════════════════

test("G1: admin route works with legacy bearer + valid X-Admin-Token (old-admin-client compat)", async () => {
  const { token: adminToken } = await makeAdmin("compat1");
  const res = await get("/api/admin/auth/me", { token: LEGACY_BEARER, adminToken });
  assert.equal(res.status, 200);
});

test("G2: admin route works with a valid X-Admin-Token and NO API key / Authorization header at all", async () => {
  const { token: adminToken } = await makeAdmin("compat2");
  const res = await get("/api/admin/auth/me", { adminToken });
  assert.equal(res.status, 200);
});

test("G3: legacy bearer alone, no admin token -> admin route still fails", async () => {
  const res = await get("/api/admin/auth/me", { token: LEGACY_BEARER });
  assert.equal(res.status, 401);
});

test("G4: neither legacy bearer nor admin token -> admin route fails", async () => {
  const res = await get("/api/admin/auth/me");
  assert.equal(res.status, 401);
});

// ═════════════════════════════════════════════════════════════════════════════
// H. Invalid-JWT fail-closed (release blocker)
// ═════════════════════════════════════════════════════════════════════════════

test("H1: expired student JWT -> 401, never silently anonymous", async () => {
  const { studentId, email } = await makeVerifiedStudent("expired");
  const expired = jwtSign(
    { sub: studentId, email, type: "student", emailVerified: true, tokenVersion: 1 },
    process.env.STUDENT_JWT_SECRET!,
    { expiresIn: -10 },
  );
  const res = await get("/api/auth/me", { token: expired });
  assert.equal(res.status, 401);
  assert.notEqual(res.status, 200);
});

test("H2: bad-signature JWT -> 401", async () => {
  const { studentId, email } = await makeVerifiedStudent("badsig");
  const badSig = jwtSign(
    { sub: studentId, email, type: "student", emailVerified: true, tokenVersion: 1 },
    "wrong-secret-entirely",
  );
  const res = await get("/api/auth/me", { token: badSig });
  assert.equal(res.status, 401);
});

test("H3: malformed JWT-shaped bearer (3 dot-separated garbage parts) -> 401, not anonymous 401-missing-creds", async () => {
  const res = await get("/api/auth/me", { token: "abc.def.ghi" });
  assert.equal(res.status, 401);
  // Must be the JWT-verification-failure path, not treated as anonymous
  // (anonymous would also 401 here via requireStudentAuth, but for a
  // different reason — assert the JWT path's own message to be precise).
  assert.equal(res.json.error, "Invalid or expired token");
});

test("H4: student JWT with wrong `type` claim -> 401", async () => {
  const { studentId, email } = await makeVerifiedStudent("wrongtype");
  const wrongType = jwtSign(
    { sub: studentId, email, type: "admin", emailVerified: true, tokenVersion: 1 },
    process.env.STUDENT_JWT_SECRET!,
  );
  const res = await get("/api/auth/me", { token: wrongType });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, "Invalid token type");
});

test("H5: revoked (tokenVersion-mismatched) student JWT -> 401 SESSION_REVOKED, never anonymous", async () => {
  const { studentId, email, token } = await makeVerifiedStudent("revoked");
  const before = await get("/api/auth/me", { token });
  assert.equal(before.status, 200);

  await post("/api/auth/logout", { token });
  const after = await get("/api/auth/me", { token });
  assert.equal(after.status, 401);
  assert.equal(after.json.code, "SESSION_REVOKED");
  void studentId; void email;
});

// ═════════════════════════════════════════════════════════════════════════════
// I. Device-unregister route — independent of the requireAuth change
// ═════════════════════════════════════════════════════════════════════════════

test("I1: no unregister secret -> rejected (device stays active)", async () => {
  const { deviceId } = await makeDevice("correct-secret-i1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const res = await post("/api/notifications/devices/unregister-by-installation", { body: { deviceId } });
  assert.equal(res.status, 200); // oracle-resistant: always 200
  assert.equal(await deviceIsActive(deviceId), true, "must NOT have deactivated without a secret");
});

test("I2: wrong unregister secret -> rejected (device stays active)", async () => {
  const secret = "correct-secret-i2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const { deviceId } = await makeDevice(secret);
  const res = await post("/api/notifications/devices/unregister-by-installation", {
    body: { deviceId, unregisterSecret: "wrong-secret-i2-cccccccccccccccccccccccccccccccc" },
  });
  assert.equal(res.status, 200);
  assert.equal(await deviceIsActive(deviceId), true, "must NOT have deactivated with the wrong secret");
});

test("I3: correct TEST-OWNED unregister secret -> succeeds (device deactivated)", async () => {
  const secret = "correct-secret-i3-dddddddddddddddddddddddddddddddd";
  const { deviceId } = await makeDevice(secret);
  const res = await post("/api/notifications/devices/unregister-by-installation", {
    body: { deviceId, unregisterSecret: secret },
  });
  assert.equal(res.status, 200);
  assert.equal(await deviceIsActive(deviceId), false, "must have deactivated with the correct secret");
});

test("I4: the unregister route succeeds with NO Authorization header and NO X-Api-Key at all — proves its gate is unrelated to requireAuth", async () => {
  const secret = "correct-secret-i4-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const { deviceId } = await makeDevice(secret);
  const res = await fetch(apiUrl("/api/notifications/devices/unregister-by-installation"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, unregisterSecret: secret }),
  });
  assert.equal(res.status, 200);
  assert.equal(await deviceIsActive(deviceId), false);
});

// ═════════════════════════════════════════════════════════════════════════════
// J. Health/version unchanged + rate-limiter mount order
// ═════════════════════════════════════════════════════════════════════════════

test("J1: /healthz and /version remain unauthenticated and unchanged", async () => {
  const h = await get("/api/healthz");
  assert.equal(h.status, 200);
  const v = await get("/api/version");
  assert.equal(v.status, 200);
});

test("J2: app.ts mounts the auth rate limiters on /api/auth and /api/admin/auth BEFORE requireAuth, unaffected by this change", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const appSrc = readFileSync(join(here, "..", "app.ts"), "utf8");
  const authLimiterIdx = appSrc.indexOf('app.use("/api/auth", authRateLimiter)');
  const adminLimiterIdx = appSrc.indexOf('app.use("/api/admin/auth", authRateLimiter)');
  const requireAuthIdx = appSrc.indexOf('app.use("/api", requireAuth)');
  assert.ok(authLimiterIdx > -1 && adminLimiterIdx > -1 && requireAuthIdx > -1, "all three mount lines must exist");
  assert.ok(authLimiterIdx < requireAuthIdx, "/api/auth rate limiter must be mounted before requireAuth");
  assert.ok(adminLimiterIdx < requireAuthIdx, "/api/admin/auth rate limiter must be mounted before requireAuth");
});

test("J3: source-level check — API_SECRET_KEY is never compared/read for authorization inside requireAuth", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const authSrc = readFileSync(join(here, "..", "middlewares", "auth.ts"), "utf8");
  assert.doesNotMatch(authSrc, /process\.env\[?["']?API_SECRET_KEY["']?\]?/, "no runtime reference to API_SECRET_KEY should remain in auth.ts");
  assert.doesNotMatch(authSrc, /timingSafeEqual/, "the key-comparison code path should be fully removed");
});
