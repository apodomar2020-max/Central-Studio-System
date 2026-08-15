/**
 * Notifications Wave 2.1 concurrency review — ORIGINAL SENDER VS RESUME
 * SENDER race.
 *
 * The recovery suite (notificationCampaigns.recovery.integration.test.ts)
 * proves resume-vs-resume races are closed. This file proves the DIFFERENT,
 * previously-unverified race: an original sender that is legitimately still
 * alive but stalled (slow Expo/network call) past the stale threshold,
 * while a resume concurrently claims and finishes the campaign.
 *
 * Real DB integration test against a disposable local Postgres, fake Expo
 * provider. The provider-boundary pause uses the TEST-ONLY
 * `onDevicesSelected` hook on sendCampaignPushNotification's input — never
 * set by production callers (sendCampaign/resumeCampaign don't pass it) —
 * to pause a sender exactly "device(s) selected, before provider send",
 * per the existing convention of exporting pipeline functions directly for
 * deterministic test control rather than only reachable via HTTP. No
 * production sleeps are used; the pause is a manually-resolved Promise.
 *
 * Requires --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

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
delete process.env.NOTIFICATION_PUSH_BROADCAST_LIMIT;
delete process.env.NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES;
delete process.env.NOTIFICATION_CAMPAIGN_MAX_SEND_ATTEMPTS;
delete process.env.NOTIFICATION_CAMPAIGN_DEVICE_MAX_ATTEMPTS;

const failingTokens = new Map<string, string>();
const expoCallTokens: string[] = [];

function fakeExpoFetch(_input: unknown, init?: RequestInit): Promise<Response> {
  const messages = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
  const data = messages.map((msg) => {
    const token = String(msg.to);
    expoCallTokens.push(token);
    const failCode = failingTokens.get(token);
    return failCode
      ? { status: "error", message: "simulated failure", details: { error: failCode } }
      : { status: "ok", id: `fake-ticket-${Math.random().toString(36).slice(2, 8)}` };
  });
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as Response);
}

let pool: import("pg").Pool;
let campaigns: typeof import("./notificationCampaigns");
let push: typeof import("./pushNotifications");
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let studentSeq = 0;

async function seedStudent(): Promise<{ id: number; email: string }> {
  studentSeq += 1;
  const email = `campaign-race-${RUN}-${studentSeq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ($1, $2, 'student', true) RETURNING id`,
    [`Campaign Race Verify ${studentSeq}`, email],
  );
  return { id: rows[0].id, email };
}

async function seedDevice(studentId: number): Promise<{ id: number; pushToken: string }> {
  const pushToken = `ExponentPushToken[race-${RUN}-${studentId}-${Math.random().toString(36).slice(2, 8)}]`;
  const { rows } = await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active) VALUES ($1, $2, 'expo', 'ios', true) RETURNING id`,
    [studentId, pushToken],
  );
  return { id: rows[0].id, pushToken };
}

/** A manually-resolvable promise — the pause/release primitive for the test. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * Sets up a campaign in EXACTLY the state sendCampaign()'s own transaction
 * leaves it in the instant it commits (frozen recipients + canonical
 * notification row + status='sending', notification_id set, send_attempt=1,
 * heartbeat=now()) — the same starting point sendCampaign() itself would
 * have produced, so the "original sender" in these tests is a faithful
 * stand-in for a real in-flight sendCampaign() call.
 */
async function setUpFreshSendingCampaign(title: string, recipientStudentIds: number[]): Promise<{ campaignId: number; notificationId: number }> {
  const { rows: campaignRows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status) VALUES ($1, 'race test body', 'all', 'draft') RETURNING id`,
    [title],
  );
  const campaignId = campaignRows[0].id;
  const { rows: notifRows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ($1, 'race test body', $2, 'manual_campaign', 'notification_campaign', $3, 'manual_admin', false, now()) RETURNING id`,
    [title, `campaign:${campaignId}`, campaignId],
  );
  const notificationId = notifRows[0].id;
  for (const studentId of recipientStudentIds) {
    await pool.query(
      `INSERT INTO notification_campaign_recipients (campaign_id, student_id, status, had_active_device_at_snapshot, active_device_count_at_snapshot)
       VALUES ($1, $2, 'pending', true, 1)`,
      [campaignId, studentId],
    );
  }
  await pool.query(
    `UPDATE notification_campaigns
     SET status = 'sending', notification_id = $1, sent_at = now(), send_started_at = now(),
         last_send_heartbeat_at = now(), send_attempt = 1
     WHERE id = $2`,
    [notificationId, campaignId],
  );
  return { campaignId, notificationId };
}

async function forceHeartbeatStale(campaignId: number, minutesAgo = 10): Promise<void> {
  await pool.query(`UPDATE notification_campaigns SET last_send_heartbeat_at = now() - interval '${minutesAgo} minutes' WHERE id = $1`, [campaignId]);
}

async function cleanupAllStudentsAndDevices(): Promise<void> {
  await pool.query(`DELETE FROM notification_delivery_logs WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-race-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-race-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_devices WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-race-${RUN}-%`]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`campaign-race-${RUN}-%`]);
  studentSeq = 0;
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  campaigns = await import("./notificationCampaigns");
  push = await import("./pushNotifications");
  (globalThis as any).__origFetch = globalThis.fetch;
  globalThis.fetch = fakeExpoFetch as unknown as typeof globalThis.fetch;
});

beforeEach(async () => {
  failingTokens.clear();
  expoCallTokens.length = 0;
  await cleanupAllStudentsAndDevices();
});

after(async () => {
  globalThis.fetch = (globalThis as any).__origFetch;
  await cleanupAllStudentsAndDevices();
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE campaign_id IN (SELECT id FROM notification_campaigns WHERE title LIKE 'Race Verify%')`);
  await pool.query(`DELETE FROM notifications WHERE id IN (SELECT notification_id FROM notification_campaigns WHERE title LIKE 'Race Verify%' AND notification_id IS NOT NULL)`);
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'Race Verify%'`);
  await pool.end();
});

test("original sender stalled past staleness vs a resume that claims mid-page: no device is sent to Expo twice, old sender exits cleanly, resumed sender finishes", async () => {
  const s1 = await seedStudent();
  const d1 = await seedDevice(s1.id);
  const s2 = await seedStudent();
  const d2 = await seedDevice(s2.id);
  const { campaignId, notificationId } = await setUpFreshSendingCampaign("Race Verify OriginalVsResume", [s1.id, s2.id]);

  const selected = deferred<void>();
  const release = deferred<void>();

  // "Original sender" — a direct call to the same function sendCampaign()
  // itself would have made, with the same lease (1) sendCampaign()'s own
  // transaction would have captured. Paused via the test-only hook exactly
  // at "device(s) selected, before provider send".
  const originalSenderPromise = push.sendCampaignPushNotification({
    campaignId,
    notificationId,
    title: "Race test",
    body: "Race test body",
    leaseSendAttempt: 1,
    onDevicesSelected: async (studentIds) => {
      assert.equal(studentIds.length, 2, "both recipients' devices should be selected in this single-page run");
      selected.resolve();
      await release.promise; // held here until the test explicitly releases it
    },
  });

  // Wait for the original sender to reach the pause point (selection done,
  // Expo not yet called for either device).
  await selected.promise;
  assert.equal(expoCallTokens.length, 0, "original sender must not have called Expo yet — it is paused before dispatch");

  // Simulate the original sender having been stalled long enough to cross
  // the stale threshold (it is NOT crashed — its process is still alive,
  // just blocked — this is exactly the scenario under review).
  await forceHeartbeatStale(campaignId, 10);

  // A resume claims the campaign and runs to completion while the original
  // sender is still paused.
  const resumeResult = await campaigns.resumeCampaign(campaignId);

  // Now let the original sender proceed — it will hit its lease re-check
  // immediately after this hook returns, before calling Expo for either
  // device.
  release.resolve();

  await assert.rejects(
    originalSenderPromise,
    (err: unknown) => err instanceof push.LeaseLostError,
    "the original sender must detect its lost lease and stop cleanly (LeaseLostError), never dispatching its already-selected devices",
  );

  // ── Required assertions ──────────────────────────────────────────────
  // 1. Resumed sender completed the campaign.
  assert.equal(resumeResult.status, "completed");
  assert.equal(resumeResult.sentDeviceCount, 2);
  assert.equal(resumeResult.failedDeviceCount, 0);

  // 2. Each Push token reached fake Expo AT MOST ONCE — the core invariant
  // under review. If the original sender's stale-but-alive send had raced
  // through, d1/d2 would appear twice each.
  const tokenCounts = new Map<string, number>();
  for (const t of expoCallTokens) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
  assert.equal(tokenCounts.get(d1.pushToken), 1, "device 1 must be sent to Expo exactly once, not twice");
  assert.equal(tokenCounts.get(d2.pushToken), 1, "device 2 must be sent to Expo exactly once, not twice");
  assert.equal(expoCallTokens.length, 2, "exactly two total Expo calls for two devices — no duplicates from the stalled original sender");

  // 3. Snapshot row count unchanged (still exactly 2 — one per recipient).
  const { rows: recipientRows } = await pool.query(`SELECT count(*)::int AS n FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  assert.equal(recipientRows[0].n, 2);

  // 4. Canonical notification count unchanged (still exactly 1).
  const { rows: notifRows } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE related_entity_type = 'notification_campaign' AND related_entity_id = $1`, [campaignId]);
  assert.equal(notifRows[0].n, 1);

  // 5. Final aggregate is correct and consistent with the delivery logs
  // actually written (only by the resumed sender — the original sender
  // never got to write any).
  const aggregate = await campaigns.computeCampaignAggregate(campaignId);
  assert.equal(aggregate.sentDevices, 2);
  assert.equal(aggregate.failedDevices, 0);
  assert.equal(aggregate.attemptedDevices, 2);

  const { rows: logRows } = await pool.query(`SELECT device_id AS "deviceId", status FROM notification_delivery_logs WHERE notification_id = $1`, [notificationId]);
  assert.equal(logRows.length, 2, "exactly one delivery log per device total — the resumed sender's, never a duplicate from the stalled original");
});

test("resume-vs-resume regression (re-run under the lease fix): exactly one lease owner", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId } = await setUpFreshSendingCampaign("Race Verify ResumeVsResumeRegression", [student.id]);
  await forceHeartbeatStale(campaignId, 10);

  const results = await Promise.allSettled([campaigns.resumeCampaign(campaignId), campaigns.resumeCampaign(campaignId)]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one concurrent resume must succeed under the lease fix, same as before it");
  assert.equal(rejected.length, 1);
  const rejection = rejected[0] as PromiseRejectedResult;
  assert.ok(rejection.reason instanceof campaigns.NotificationCampaignError);
  const code = (rejection.reason as InstanceType<typeof campaigns.NotificationCampaignError>).code;
  assert.ok(code === "NOT_STALE" || code === "NOT_RESUMABLE", `expected NOT_STALE or NOT_RESUMABLE, got ${code}`);
});
