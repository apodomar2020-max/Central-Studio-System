/**
 * Notifications Wave 1 — broadcast batching / anti-truncation coverage.
 *
 * Proves sendBroadcastPushNotification processes the COMPLETE eligible
 * active-device audience via bounded keyset-paginated batches, replacing
 * the previous hard `LIMIT 25` truncation defect. Real DB integration
 * tests against a disposable local Postgres (same convention as
 * notificationReminders.integration.test.ts / pushNotifications.test.ts).
 *
 * Never sends a real Push: `globalThis.fetch` is replaced with a fake Expo
 * endpoint for the duration of this suite, and `../lib/logger` is mocked so
 * every log call can be inspected (used by the "no raw token" test) without
 * writing to stdout.
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
process.env.PUSH_NOTIFICATIONS_ENABLED = "true";
delete process.env.REDIS_URL;
delete process.env.NOTIFICATION_PUSH_BROADCAST_LIMIT; // exercise the real default (25) unless a test overrides it

type CapturedExpoCall = { url: string; messages: Array<Record<string, unknown>> };
type LogRecord = { level: "info" | "warn" | "error"; args: unknown[] };

const expoCalls: CapturedExpoCall[] = [];
const capturedLogs: LogRecord[] = [];
/** When set, the Nth Expo call (0-indexed) rejects instead of succeeding. */
let failExpoCallAtIndex: number | null = null;

function fakeLogger() {
  const record = (level: LogRecord["level"]) => (...args: unknown[]) => {
    capturedLogs.push({ level, args });
  };
  return { info: record("info"), warn: record("warn"), error: record("error"), debug: record("info") };
}

function fakeExpoFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const messages = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
  const callIndex = expoCalls.length;
  expoCalls.push({ url, messages });

  if (failExpoCallAtIndex !== null && callIndex === failExpoCallAtIndex) {
    return Promise.reject(new Error("simulated Expo outage for this chunk"));
  }

  const data = messages.map((_msg, i) => ({ status: "ok", id: `fake-ticket-${callIndex}-${i}` }));
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as Response);
}

let pool: import("pg").Pool;
let push: typeof import("./pushNotifications");
let originalFetch: typeof globalThis.fetch;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let studentSeq = 0;

async function seedStudent(): Promise<number> {
  studentSeq += 1;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ($1, $2, 'student', true) RETURNING id`,
    [`Broadcast Verify ${studentSeq}`, `broadcast-verify-${RUN}-${studentSeq}@example.invalid`],
  );
  return rows[0].id as number;
}

/** N students, each with exactly one active eligible device. Returns the device ids in insertion order. */
async function seedNStudentsOneDeviceEach(n: number, platform: "ios" | "android" = "ios"): Promise<{ studentIds: number[]; deviceIds: number[] }> {
  const studentIds: number[] = [];
  const deviceIds: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const studentId = await seedStudent();
    studentIds.push(studentId);
    const { rows } = await pool.query(
      `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active)
       VALUES ($1, $2, 'expo', $3, true) RETURNING id`,
      [studentId, `ExponentPushToken[broadcast-${RUN}-${studentId}]`, platform],
    );
    deviceIds.push(rows[0].id as number);
  }
  return { studentIds, deviceIds };
}

async function deliveryLogCountFor(deviceIds: number[]): Promise<number> {
  if (deviceIds.length === 0) return 0;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM notification_delivery_logs WHERE device_id = ANY($1::int[])`,
    [deviceIds],
  );
  return rows[0].n;
}

before(async () => {
  mock.module("./logger", { namedExports: { logger: fakeLogger() } });
  originalFetch = globalThis.fetch;
  globalThis.fetch = fakeExpoFetch as unknown as typeof globalThis.fetch;

  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  push = await import("./pushNotifications");
});

beforeEach(async () => {
  expoCalls.length = 0;
  capturedLogs.length = 0;
  failExpoCallAtIndex = null;
  // sendBroadcastPushNotification scans the ENTIRE notification_devices
  // table (correctly, for real broadcast semantics) — so without this,
  // devices seeded by an earlier test in this file would still be "active"
  // and inflate later tests' matched/sent counts. Delivery logs reference
  // devices with ON DELETE SET NULL, so this is safe even though earlier
  // tests already asserted against those logs.
  await pool.query(`DELETE FROM notification_devices WHERE push_token LIKE $1`, [`ExponentPushToken[broadcast-${RUN}-%`]);
});

after(async () => {
  mock.reset();
  globalThis.fetch = originalFetch;
  await pool.query(`DELETE FROM notification_delivery_logs WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`broadcast-verify-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_devices WHERE push_token LIKE $1`, [`ExponentPushToken[broadcast-${RUN}-%`]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`broadcast-verify-${RUN}-%`]);
  await pool.end();
});

// ─── 0 / 1 / 24 / 25 / 26 / 100 devices — no truncation, exact batch counts ──

// `batches` only increments for a page that returned rows — the terminating
// empty "probe" page (length 0) breaks the loop without incrementing it, so
// an audience that's an exact multiple of the page size (25, 100, 1000)
// still shows batches == n/25, not n/25 + 1.
const CASES: Array<{ n: number; expectedBatches: number }> = [
  { n: 0, expectedBatches: 0 },
  { n: 1, expectedBatches: 1 },
  { n: 24, expectedBatches: 1 },
  { n: 25, expectedBatches: 1 }, // exactly one full page; the empty probe after it doesn't count
  { n: 26, expectedBatches: 2 },
  { n: 100, expectedBatches: 4 }, // 4 full pages of 25
];

for (const { n, expectedBatches } of CASES) {
  test(`broadcast with ${n} eligible devices processes all ${n} (no hard truncation), batches=${expectedBatches}`, async () => {
    const { studentIds, deviceIds } = await seedNStudentsOneDeviceEach(n);
    const result = await push.sendBroadcastPushNotification({
      title: `Broadcast Verify ${n}`,
      body: "test body",
      notificationId: null,
    });
    assert.equal(result.matchedDevices, n, "matchedDevices must equal the full eligible audience, not a truncated slice");
    assert.equal(result.matchedStudents, n === 0 ? 0 : new Set(studentIds).size);
    assert.equal(result.attemptedDevices, n);
    assert.equal(result.attemptedStudents, result.matchedStudents);
    assert.equal(result.sent, n);
    assert.equal(result.failed, 0);
    assert.equal(result.batches, expectedBatches);
    assert.equal(result.truncated, false, "a fully-processed audience must never report truncated=true");
    assert.equal(await deliveryLogCountFor(deviceIds), n, "exactly one delivery log per device — no duplicates, none skipped");
  });
}

// ─── 1,000 devices — scale test ──────────────────────────────────────────────

test("broadcast with 1,000 eligible devices processes all 1,000 in bounded pages, no duplicates", async () => {
  const { studentIds, deviceIds } = await seedNStudentsOneDeviceEach(1000);
  const result = await push.sendBroadcastPushNotification({
    title: "Broadcast Verify 1000",
    body: "test body",
    notificationId: null,
  });
  assert.equal(result.matchedDevices, 1000);
  assert.equal(result.matchedStudents, new Set(studentIds).size);
  assert.equal(result.sent, 1000);
  assert.equal(result.failed, 0);
  assert.equal(result.batches, 40); // 40 full pages of 25 (the terminating empty probe page isn't counted)
  assert.equal(result.truncated, false);
  assert.equal(await deliveryLogCountFor(deviceIds), 1000);
  // No duplicate device ids were ever attempted twice.
  const seenTokens = new Set<string>();
  for (const call of expoCalls) {
    for (const msg of call.messages) {
      const token = String(msg.to);
      assert.ok(!seenTokens.has(token), `device token ${token} was sent to Expo more than once`);
      seenTokens.add(token);
    }
  }
  assert.equal(seenTokens.size, 1000);
});

// ─── safety cap: hitting it must never silently report a complete success ───

test("hitting MAX_BROADCAST_BATCHES reports truncated=true and stops after only the already-processed devices", async () => {
  const { deviceIds } = await seedNStudentsOneDeviceEach(5);
  const prevMax = process.env["NOTIFICATION_PUSH_BROADCAST_MAX_BATCHES"];
  process.env["NOTIFICATION_PUSH_BROADCAST_MAX_BATCHES"] = "2";
  try {
    // batchSize:1 + max 2 batches => exactly 2 of the 5 eligible devices are
    // ever attempted; the safety cap must stop the loop there, not silently
    // finish and report success for only part of the audience.
    const result = await push.sendBroadcastPushNotification({
      title: "Safety cap check",
      body: "b",
      notificationId: null,
      batchSize: 1,
    });
    assert.equal(result.truncated, true, "a run stopped by the safety cap must be explicitly marked incomplete");
    assert.equal(result.batches, 2);
    assert.equal(result.matchedDevices, 2, "only the devices actually processed before the cap are counted");
    assert.equal(result.sent, 2);
    // Delivery logs for the 2 devices that WERE processed are preserved —
    // the cap doesn't roll back or discard already-committed work.
    assert.equal(await deliveryLogCountFor(deviceIds), 2, "the 3 devices never reached must have no delivery log, and the 2 processed must each have exactly one");
  } finally {
    if (prevMax === undefined) delete process.env["NOTIFICATION_PUSH_BROADCAST_MAX_BATCHES"];
    else process.env["NOTIFICATION_PUSH_BROADCAST_MAX_BATCHES"] = prevMax;
  }
});

// ─── batch size vs. Expo per-request chunk size are independent concerns ────

test("one student's device group (well under Expo's 100 limit) is sent in a single Expo request", async () => {
  const studentId = await seedStudent();
  for (let i = 0; i < 25; i += 1) {
    await pool.query(
      `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active) VALUES ($1, $2, 'expo', 'ios', true)`,
      [studentId, `ExponentPushToken[broadcast-${RUN}-onechunk-${i}]`],
    );
  }
  await push.sendBroadcastPushNotification({ title: "Chunk check", body: "b", notificationId: null });
  assert.equal(expoCalls.length, 1, "all 25 of one student's devices are one Expo request, not split");
  assert.equal(expoCalls[0]!.messages.length, 25);
});

test("a single student with 150 devices is split into two Expo chunks (100 + 50), respecting Expo's per-request limit", async () => {
  const studentId = await seedStudent();
  const deviceIds: number[] = [];
  for (let i = 0; i < 150; i += 1) {
    const { rows } = await pool.query(
      `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active) VALUES ($1, $2, 'expo', 'ios', true) RETURNING id`,
      [studentId, `ExponentPushToken[broadcast-${RUN}-chunk-${i}]`],
    );
    deviceIds.push(rows[0].id as number);
  }
  const result = await push.sendPushNotification({ studentId, title: "Chunk test", body: "b" });
  assert.equal(result.sent, 150);
  assert.equal(expoCalls.length, 2, "150 devices for one student must be split into exactly two Expo requests");
  assert.equal(expoCalls[0]!.messages.length, 100);
  assert.equal(expoCalls[1]!.messages.length, 50);
  assert.equal(await deliveryLogCountFor(deviceIds), 150);
});

// ─── partial-batch failure does not abort the remaining audience ────────────

test("a failed Expo request for one chunk does not abort the rest of the broadcast", async () => {
  failExpoCallAtIndex = 0; // first Expo HTTP call fails; everything after must still proceed
  const { deviceIds } = await seedNStudentsOneDeviceEach(60);
  const result = await push.sendBroadcastPushNotification({ title: "Partial failure", body: "b", notificationId: null });
  assert.equal(result.matchedDevices, 60, "the full audience is still matched/attempted despite one failed chunk");
  assert.ok(result.failed >= 1, "the failed chunk's devices are counted as failed, not silently dropped");
  assert.ok(result.sent >= 1, "subsequent successful batches still count as sent");
  assert.equal(result.sent + result.failed, 60);
  assert.equal(await deliveryLogCountFor(deviceIds), 60, "every device still gets a delivery log row — failed ones included");
});

// ─── multiple devices per account / multiple accounts are counted distinctly ─

test("multiple devices belonging to one student are all attempted, but counted as one matched student", async () => {
  const studentId = await seedStudent();
  const deviceIds: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const { rows } = await pool.query(
      `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active) VALUES ($1, $2, 'expo', 'ios', true) RETURNING id`,
      [studentId, `ExponentPushToken[broadcast-${RUN}-multi-${i}]`],
    );
    deviceIds.push(rows[0].id as number);
  }
  const result = await push.sendBroadcastPushNotification({ title: "Multi device", body: "b", notificationId: null });
  assert.equal(result.matchedDevices, 3);
  assert.equal(result.matchedStudents, 1, "device count and account count must never be conflated");
  assert.equal(result.sent, 3);
  assert.equal(await deliveryLogCountFor(deviceIds), 3);
});

// ─── Android channel / delivery logging / no-token-leak preservation ────────

test("Android devices still receive the central-default-v1 channelId in the outgoing Expo message", async () => {
  await seedNStudentsOneDeviceEach(1, "android");
  await push.sendBroadcastPushNotification({ title: "Android channel check", body: "b", notificationId: null });
  assert.equal(expoCalls.length, 1);
  assert.equal(expoCalls[0]!.messages[0]!.channelId, "central-default-v1");
});

test("iOS devices never receive an Android channelId", async () => {
  await seedNStudentsOneDeviceEach(1, "ios");
  await push.sendBroadcastPushNotification({ title: "iOS channel check", body: "b", notificationId: null });
  assert.equal(expoCalls[0]!.messages[0]!.channelId, undefined);
});

test("outgoing Expo messages preserve sound and payload data", async () => {
  await seedNStudentsOneDeviceEach(1);
  // notificationId intentionally omitted/null here — notification_delivery_logs.notification_id
  // is a real FK to notifications.id (ON DELETE SET NULL), and this test has
  // no matching notifications row to reference.
  await push.sendBroadcastPushNotification({
    title: "Payload check",
    body: "b",
    data: { type: "custom_type", relatedEntityId: 42 },
    notificationId: null,
  });
  const msg = expoCalls[0]!.messages[0]!;
  assert.equal(msg.sound, "default");
  assert.deepEqual(msg.data, { type: "custom_type", relatedEntityId: 42 });
});

test("raw push tokens never appear in any log call", async () => {
  const { deviceIds: _deviceIds } = await seedNStudentsOneDeviceEach(3);
  await push.sendBroadcastPushNotification({ title: "Token leak check", body: "b", notificationId: null });
  assert.ok(capturedLogs.length > 0, "sanity: logging did occur during this broadcast");
  const serializedLogs = JSON.stringify(capturedLogs);
  assert.ok(!serializedLogs.includes("ExponentPushToken["), "no log call may contain a raw push token");
});

test("provider ticket ids and error info are still recorded per device (delivery logging preserved)", async () => {
  const { deviceIds } = await seedNStudentsOneDeviceEach(2);
  await push.sendBroadcastPushNotification({ title: "Ticket id check", body: "b", notificationId: null });
  const { rows } = await pool.query(
    `SELECT status, provider_message_id AS "providerMessageId" FROM notification_delivery_logs WHERE device_id = ANY($1::int[]) ORDER BY id`,
    [deviceIds],
  );
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.status, "sent");
    assert.ok(row.providerMessageId?.startsWith("fake-ticket-"));
  }
});
