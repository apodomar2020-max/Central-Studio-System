import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PUSH_PRIVACY_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:55481/central_push_privacy_disposable_test";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing non-local database host: ${url.hostname}`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing database without disposable/local/test name: ${url.pathname}`);
  }
  if (/railway|rlwy\.net/i.test(databaseUrl)) throw new Error("Refusing Railway database URL");
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;
process.env.API_SECRET_KEY = "push-privacy-test-api-key";
process.env.STUDENT_JWT_SECRET = "push-privacy-test-student-secret";
process.env.TRUST_PROXY_HOPS = "1";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const API_KEY = process.env.API_SECRET_KEY;
const JWT_SECRET = process.env.STUDENT_JWT_SECRET;
const GENERIC_SUCCESS = { ok: true };

let server: import("node:http").Server;
let port: number;
let pool: typeof import("@workspace/db").pool;
let jwtSign: typeof import("jsonwebtoken").default.sign;
let hashSecret: typeof import("../lib/installationUnregister").hashUnregisterSecret;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function apiHeaders(ip: string, key = API_KEY): Record<string, string> {
  return {
    "content-type": "application/json",
    // Matches the logged-out mobile customFetch path exactly.
    authorization: `Bearer ${key}`,
    "x-forwarded-for": ip,
  };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, JWT_SECRET);
}

async function post(path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body) });
}

async function createStudent(label: string): Promise<{ id: number; email: string }> {
  const email = `push-privacy-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO students (name, email, account_type, email_verified)
     VALUES ($1, $2, 'student', true) RETURNING id`,
    [`Push Privacy ${label}`, email],
  );
  return { id: result.rows[0].id, email };
}

type DeviceFixture = {
  studentId: number;
  token: string;
  deviceId: string;
  secret?: string | null;
  provider?: string;
  active?: boolean;
};

async function insertDevice(input: DeviceFixture): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO notification_devices
       (student_id, push_token, provider, platform, device_id, unregister_secret_hash, is_active)
     VALUES ($1, $2, $3, 'android', $4, $5, $6) RETURNING id`,
    [
      input.studentId,
      input.token,
      input.provider ?? "expo",
      input.deviceId,
      input.secret == null ? null : hashSecret(input.secret),
      input.active ?? true,
    ],
  );
  return result.rows[0].id;
}

async function deviceState(id: number): Promise<{ is_active: boolean; student_id: number; unregister_secret_hash: string | null }> {
  const result = await pool.query(
    `SELECT is_active, student_id, unregister_secret_hash FROM notification_devices WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  ({ sign: jwtSign } = (await import("jsonwebtoken")).default);
  ({ hashUnregisterSecret: hashSecret } = await import("../lib/installationUnregister"));
  const express = (await import("express")).default;
  const { requireAuth } = await import("../middlewares/auth");
  const notificationsRouter = (await import("./notifications")).default;
  const app = express();
  // Production ordering from app.ts: proxy trust, body parsing, global auth,
  // then the production router (whose route-specific limiter remains intact).
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", notificationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await pool.query(`DROP TRIGGER IF EXISTS notification_devices_test_fail_insert ON notification_devices`);
  await pool.query(`DROP FUNCTION IF EXISTS notification_devices_test_fail_insert()`);
  await pool.query(`DELETE FROM notification_devices`);
  await pool.query(`DELETE FROM students WHERE email LIKE 'push-privacy-%@example.test'`);
  if (server) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await pool.end();
});

test("logged-out endpoint traverses global auth and is not student-JWT gated", async () => {
  const student = await createStudent("auth");
  const secret = "a".repeat(64);
  const validId = await insertDevice({ studentId: student.id, token: "ExponentPushToken[auth-valid]", deviceId: "auth-device", secret });

  const valid = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "auth-device", unregisterSecret: secret },
    apiHeaders("198.51.100.10"),
  );
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), GENERIC_SUCCESS);
  assert.equal((await deviceState(validId)).is_active, false);

  const noCredentialsId = await insertDevice({ studentId: student.id, token: "ExponentPushToken[auth-none]", deviceId: "auth-none", secret });
  const noCredentials = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "auth-none", unregisterSecret: secret },
    { "content-type": "application/json", "x-forwarded-for": "198.51.100.11" },
  );
  assert.equal(noCredentials.status, 401);
  assert.equal((await deviceState(noCredentialsId)).is_active, true);

  const invalidKeyId = await insertDevice({ studentId: student.id, token: "ExponentPushToken[auth-invalid]", deviceId: "auth-invalid", secret });
  const invalidKey = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "auth-invalid", unregisterSecret: secret },
    apiHeaders("198.51.100.12", "wrong-api-key"),
  );
  assert.equal(invalidKey.status, 403, "production global auth uses 403 for an invalid supplied API key");
  assert.equal((await deviceState(invalidKeyId)).is_active, true);
});

test("real installation endpoint enforces deviceId plus hash and returns one generic shape", async () => {
  const student = await createStudent("endpoint");
  const correct = "b".repeat(64);
  const other = "c".repeat(64);
  const a1 = await insertDevice({ studentId: student.id, token: "ExponentPushToken[a1]", deviceId: "install-a", secret: correct });
  const a2 = await insertDevice({ studentId: student.id, token: "ExponentPushToken[a2]", deviceId: "install-a", secret: correct });
  const differentHash = await insertDevice({ studentId: student.id, token: "ExponentPushToken[a-wrong-hash]", deviceId: "install-a", secret: other });
  const differentDevice = await insertDevice({ studentId: student.id, token: "ExponentPushToken[b-same-hash]", deviceId: "install-b", secret: correct });
  const inactive = await insertDevice({ studentId: student.id, token: "ExponentPushToken[a-inactive]", deviceId: "install-a", secret: correct, active: false });

  const wrong = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "install-a", unregisterSecret: "d".repeat(64) },
    apiHeaders("198.51.100.20"),
  );
  assert.deepEqual(await wrong.json(), GENERIC_SUCCESS);
  assert.equal((await deviceState(a1)).is_active, true);

  const malformed = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "install-a" },
    apiHeaders("198.51.100.21"),
  );
  assert.equal(malformed.status, 200);
  assert.deepEqual(await malformed.json(), GENERIC_SUCCESS);
  assert.equal((await deviceState(a1)).is_active, true);

  const valid = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "install-a", unregisterSecret: correct },
    apiHeaders("198.51.100.22"),
  );
  assert.deepEqual(await valid.json(), GENERIC_SUCCESS);
  assert.equal((await deviceState(a1)).is_active, false);
  assert.equal((await deviceState(a2)).is_active, false);
  assert.equal((await deviceState(inactive)).is_active, false);
  assert.equal((await deviceState(differentHash)).is_active, true);
  assert.equal((await deviceState(differentDevice)).is_active, true);

  const again = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "install-a", unregisterSecret: correct },
    apiHeaders("198.51.100.23"),
  );
  assert.deepEqual(await again.json(), GENERIC_SUCCESS);
});

test("production registration transaction hashes secrets and handles refresh and account handoff", async () => {
  const ownerA = await createStudent("owner-a");
  const ownerB = await createStudent("owner-b");
  const secret = "e".repeat(64);
  const register = (student: { id: number; email: string }, body: Record<string, unknown>, ip: string) => post(
    "/api/notifications/devices/register",
    body,
    {
      "content-type": "application/json",
      authorization: `Bearer ${studentToken(student.id, student.email)}`,
      "x-forwarded-for": ip,
    },
  );

  const firstToken = "ExponentPushToken[registration-first]";
  const first = await register(ownerA, {
    pushToken: firstToken, provider: "expo", platform: "android",
    deviceId: "registration-device", unregisterSecret: secret,
  }, "198.51.100.30");
  assert.equal(first.status, 200);
  const firstRow = await pool.query(
    `SELECT * FROM notification_devices WHERE push_token = $1`,
    [firstToken],
  );
  assert.equal(firstRow.rows[0].is_active, true);
  assert.equal(firstRow.rows[0].unregister_secret_hash, hashSecret(secret));
  assert.equal(JSON.stringify(firstRow.rows[0]).includes(secret), false);

  const refreshedToken = "ExponentPushToken[registration-refreshed]";
  const refreshed = await register(ownerA, {
    pushToken: refreshedToken, provider: "expo", platform: "android",
    deviceId: "registration-device", unregisterSecret: secret,
  }, "198.51.100.31");
  assert.equal(refreshed.status, 200);
  assert.equal((await pool.query(`SELECT is_active FROM notification_devices WHERE push_token = $1`, [firstToken])).rows[0].is_active, false);
  assert.equal((await pool.query(`SELECT is_active FROM notification_devices WHERE push_token = $1`, [refreshedToken])).rows[0].is_active, true);

  const handoffToken = "ExponentPushToken[registration-handoff]";
  const handoff = await register(ownerB, {
    pushToken: handoffToken, provider: "expo", platform: "android",
    deviceId: "registration-device", unregisterSecret: secret,
  }, "198.51.100.32");
  assert.equal(handoff.status, 200);
  const handoffRows = await pool.query(
    `SELECT push_token, student_id, is_active FROM notification_devices WHERE device_id = 'registration-device' ORDER BY id`,
  );
  assert.equal(handoffRows.rows.filter((row) => row.is_active).length, 1);
  assert.equal(handoffRows.rows.find((row) => row.is_active).student_id, ownerB.id);
  assert.equal(handoffRows.rows.find((row) => row.is_active).push_token, handoffToken);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM notification_devices WHERE push_token = $1`, [handoffToken])).rows[0].count, 1);

  const sharedToken = "ExponentPushToken[registration-same-token]";
  assert.equal((await register(ownerA, {
    pushToken: sharedToken, provider: "expo", platform: "android",
    deviceId: "same-token-device", unregisterSecret: secret,
  }, "198.51.100.35")).status, 200);
  assert.equal((await register(ownerB, {
    pushToken: sharedToken, provider: "expo", platform: "android",
    deviceId: "same-token-device", unregisterSecret: secret,
  }, "198.51.100.36")).status, 200);
  const sharedTokenRows = await pool.query(
    `SELECT student_id, is_active FROM notification_devices WHERE push_token = $1`,
    [sharedToken],
  );
  assert.equal(sharedTokenRows.rowCount, 1);
  assert.equal(sharedTokenRows.rows[0].student_id, ownerB.id);
  assert.equal(sharedTokenRows.rows[0].is_active, true);

  const protectedId = await insertDevice({
    studentId: ownerA.id,
    token: "ExponentPushToken[protected-other-owner]",
    deviceId: "protected-device",
    secret,
  });
  const wrongSecret = await register(ownerB, {
    pushToken: "ExponentPushToken[wrong-cross-account]", provider: "expo", platform: "android",
    deviceId: "protected-device", unregisterSecret: "f".repeat(64),
  }, "198.51.100.33");
  assert.equal(wrongSecret.status, 200);
  assert.equal((await deviceState(protectedId)).is_active, true);

  const historicalId = await insertDevice({
    studentId: ownerA.id,
    token: "ExponentPushToken[historical-null]",
    deviceId: "historical-device",
    secret: null,
  });
  const historicalSecret = "1".repeat(64);
  const upgraded = await register(ownerA, {
    pushToken: "ExponentPushToken[historical-upgraded]", provider: "expo", platform: "android",
    deviceId: "historical-device", unregisterSecret: historicalSecret,
  }, "198.51.100.34");
  assert.equal(upgraded.status, 200);
  assert.equal((await deviceState(historicalId)).is_active, false);
  assert.equal(
    (await pool.query(`SELECT unregister_secret_hash FROM notification_devices WHERE push_token = 'ExponentPushToken[historical-upgraded]'`)).rows[0].unregister_secret_hash,
    hashSecret(historicalSecret),
  );
});

test("registration transaction rolls back prior deactivation when insert fails", async () => {
  const student = await createStudent("rollback");
  const secret = "2".repeat(64);
  const oldId = await insertDevice({
    studentId: student.id,
    token: "ExponentPushToken[rollback-old]",
    deviceId: "rollback-device",
    secret,
  });
  await pool.query(`
    CREATE OR REPLACE FUNCTION notification_devices_test_fail_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.push_token = 'ExponentPushToken[rollback-fail]' THEN
        RAISE EXCEPTION 'injected registration failure';
      END IF;
      RETURN NEW;
    END $$`);
  await pool.query(`
    CREATE TRIGGER notification_devices_test_fail_insert
    BEFORE INSERT ON notification_devices
    FOR EACH ROW EXECUTE FUNCTION notification_devices_test_fail_insert()`);

  const response = await post(
    "/api/notifications/devices/register",
    {
      pushToken: "ExponentPushToken[rollback-fail]", provider: "expo", platform: "android",
      deviceId: "rollback-device", unregisterSecret: secret,
    },
    {
      "content-type": "application/json",
      authorization: `Bearer ${studentToken(student.id, student.email)}`,
      "x-forwarded-for": "198.51.100.40",
    },
  );
  assert.equal(response.status, 500);
  const failureBody = JSON.stringify(await response.json());
  assert.equal(failureBody.includes("ExponentPushToken"), false);
  assert.equal(failureBody.includes(secret), false);
  assert.equal((await deviceState(oldId)).is_active, true);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM notification_devices WHERE push_token = 'ExponentPushToken[rollback-fail]'`)).rows[0].count, 0);
  await pool.query(`DROP TRIGGER notification_devices_test_fail_insert ON notification_devices`);
  await pool.query(`DROP FUNCTION notification_devices_test_fail_insert()`);
});

test("real Push selection excludes inactive/non-Expo rows and reflects unregister immediately", async () => {
  const student = await createStudent("selection");
  const secret = "3".repeat(64);
  const activeToken = "ExponentPushToken[selection-active]";
  const inactiveToken = "ExponentPushToken[selection-inactive]";
  const otherToken = "ExponentPushToken[selection-other]";
  await insertDevice({ studentId: student.id, token: activeToken, deviceId: "selection-active-device", secret });
  await insertDevice({ studentId: student.id, token: inactiveToken, deviceId: "selection-inactive-device", secret, active: false });
  await insertDevice({ studentId: student.id, token: otherToken, deviceId: "selection-other-device", secret, provider: "other" });

  const originalFetch = globalThis.fetch;
  const submitted: string[][] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const messages = JSON.parse(String(init?.body)) as Array<{ to: string }>;
    submitted.push(messages.map((message) => message.to));
    return new Response(JSON.stringify({ data: messages.map(() => ({ status: "ok", id: "test-ticket" })) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  process.env.PUSH_NOTIFICATIONS_ENABLED = "true";
  try {
    const { sendPushNotification } = await import("../lib/pushNotifications");
    await sendPushNotification({ studentId: student.id, title: "Test", body: "Before" });
    assert.deepEqual(submitted[0], [activeToken]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const wrong = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "selection-active-device", unregisterSecret: "4".repeat(64) },
    apiHeaders("198.51.100.50"),
  );
  assert.deepEqual(await wrong.json(), GENERIC_SUCCESS);
  assert.equal((await pool.query(`SELECT is_active FROM notification_devices WHERE push_token = $1`, [activeToken])).rows[0].is_active, true);

  const valid = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "selection-active-device", unregisterSecret: secret },
    apiHeaders("198.51.100.51"),
  );
  assert.deepEqual(await valid.json(), GENERIC_SUCCESS);
  const eligible = await pool.query(
    `SELECT push_token FROM notification_devices
     WHERE student_id = $1 AND provider = 'expo' AND is_active = true`,
    [student.id],
  );
  assert.deepEqual(eligible.rows, []);
  delete process.env.PUSH_NOTIFICATIONS_ENABLED;
});

test("real route limiter accepts twenty requests and rejects the twenty-first using trusted proxy IP", async () => {
  const headers = apiHeaders("203.0.113.77");
  for (let index = 0; index < 20; index += 1) {
    const response = await post(
      "/api/notifications/devices/unregister-by-installation",
      { deviceId: "rate-device", unregisterSecret: "5".repeat(64) },
      headers,
    );
    assert.equal(response.status, 200, `request ${index + 1} should be below the limit`);
  }
  const limited = await post(
    "/api/notifications/devices/unregister-by-installation",
    { deviceId: "rate-device", unregisterSecret: "5".repeat(64) },
    headers,
  );
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), GENERIC_SUCCESS);
  assert.equal(limited.headers.get("ratelimit-limit"), "20");
});
