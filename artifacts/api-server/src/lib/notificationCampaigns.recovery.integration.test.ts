/**
 * Notifications Wave 2.1 — crash/recovery coverage for the Manual Push
 * Campaign send pipeline.
 *
 * Real DB integration tests against a disposable local Postgres, fake Expo
 * provider (token-level pass/fail control). "Crashed mid-send" is simulated
 * directly via raw SQL that leaves the exact state a real crash would leave
 * (frozen recipients + canonical notification + status='sending' + a stale
 * heartbeat, with some/none/all delivery logs already written) — there is
 * no real async boundary to interrupt in this synchronous pipeline, so this
 * is the faithful way to exercise the recovered-state code paths.
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
delete process.env.NOTIFICATION_PUSH_BROADCAST_LIMIT;
delete process.env.NOTIFICATION_CAMPAIGN_STALE_SENDING_MINUTES;
delete process.env.NOTIFICATION_CAMPAIGN_MAX_SEND_ATTEMPTS;
delete process.env.NOTIFICATION_CAMPAIGN_DEVICE_MAX_ATTEMPTS;

/** Tokens in this set produce an Expo "error" ticket with the given errorCode; every other token succeeds. */
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
  const email = `campaign-recovery-${RUN}-${studentSeq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ($1, $2, 'student', true) RETURNING id`,
    [`Campaign Recovery Verify ${studentSeq}`, email],
  );
  return { id: rows[0].id, email };
}

async function seedDevice(studentId: number, opts: { willFailCode?: string } = {}): Promise<{ id: number; pushToken: string }> {
  const pushToken = `ExponentPushToken[recovery-${RUN}-${studentId}-${Math.random().toString(36).slice(2, 8)}]`;
  if (opts.willFailCode) failingTokens.set(pushToken, opts.willFailCode);
  const { rows } = await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active) VALUES ($1, $2, 'expo', 'ios', true) RETURNING id`,
    [studentId, pushToken],
  );
  return { id: rows[0].id, pushToken };
}

/**
 * Simulates the exact durable state a real crash leaves behind: a draft
 * campaign that already went through sendCampaign()'s transactional step
 * (frozen recipients + canonical notification row + status='sending'), but
 * never reached finalization. `recipients` are the frozen accounts;
 * `preExisting` optionally seeds delivery_logs / recipient status rows as
 * if some pages were already processed before the "crash".
 */
async function simulateCrashedCampaign(
  title: string,
  recipientStudentIds: number[],
  opts: {
    heartbeatMinutesAgo: number | null; // null = never set (crash before first heartbeat)
    sendAttempt?: number;
    preExisting?: Array<{ studentId: number; deviceId: number; status: "sent" | "failed"; errorCode?: string | null }>;
  },
): Promise<{ campaignId: number; notificationId: number }> {
  const { rows: campaignRows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status) VALUES ($1, 'recovery sim body', 'all', 'draft') RETURNING id`,
    [title],
  );
  const campaignId = campaignRows[0].id;
  const { rows: notifRows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ($1, 'recovery sim body', $2, 'manual_campaign', 'notification_campaign', $3, 'manual_admin', false, now()) RETURNING id`,
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

  for (const entry of opts.preExisting ?? []) {
    await pool.query(
      `INSERT INTO notification_delivery_logs (notification_id, student_id, device_id, channel, provider, status, error_code, sent_at)
       VALUES ($1, $2, $3, 'push', 'expo', $4, $5, $6)`,
      [notificationId, entry.studentId, entry.deviceId, entry.status, entry.errorCode ?? null, entry.status === "sent" ? new Date().toISOString() : null],
    );
    await pool.query(
      `UPDATE notification_campaign_recipients SET status = $1 WHERE campaign_id = $2 AND student_id = $3`,
      [entry.status, campaignId, entry.studentId],
    );
  }

  const heartbeatExpr = opts.heartbeatMinutesAgo == null ? "null" : `now() - interval '${opts.heartbeatMinutesAgo} minutes'`;
  await pool.query(
    `UPDATE notification_campaigns
     SET status = 'sending', notification_id = $1, sent_at = now(), send_started_at = now(),
         last_send_heartbeat_at = ${heartbeatExpr}, send_attempt = $2
     WHERE id = $3`,
    [notificationId, opts.sendAttempt ?? 1, campaignId],
  );

  return { campaignId, notificationId };
}

async function recipientStatuses(campaignId: number): Promise<Record<string, string>> {
  const { rows } = await pool.query(`SELECT student_id AS "studentId", status FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  return Object.fromEntries(rows.map((r: { studentId: number; status: string }) => [r.studentId, r.status]));
}

async function cleanupAllStudentsAndDevices(): Promise<void> {
  await pool.query(`DELETE FROM notification_delivery_logs WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-recovery-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_read_receipts WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-recovery-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-recovery-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_devices WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-recovery-${RUN}-%`]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`campaign-recovery-${RUN}-%`]);
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
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE campaign_id IN (SELECT id FROM notification_campaigns WHERE title LIKE 'Recovery Verify%')`);
  await pool.query(`DELETE FROM notifications WHERE id IN (SELECT notification_id FROM notification_campaigns WHERE title LIKE 'Recovery Verify%' AND notification_id IS NOT NULL)`);
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'Recovery Verify%'`);
  await pool.end();
});

// ─── 2: crash immediately after freeze leaves recoverable state ─────────────

test("2: crash immediately after freeze (before any delivery) leaves a fully recoverable stale campaign", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId, notificationId } = await simulateCrashedCampaign("Recovery Verify CrashAtFreeze", [student.id], { heartbeatMinutesAgo: 10 });

  const { rows: preRows } = await pool.query(`SELECT count(*)::int AS n FROM notification_delivery_logs WHERE notification_id = $1`, [notificationId]);
  assert.equal(preRows[0].n, 0, "no delivery logs exist yet — nothing was ever attempted");

  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.status, "completed");
  assert.equal(result.sentDeviceCount, 1);
});

// ─── 3/4/5: crash after first batch — already-sent skipped, remaining sent ──

test("3/4/5: crash after a partial batch — already-sent devices are never resent, remaining devices are delivered", async () => {
  const alreadySentStudent = await seedStudent();
  const alreadySentDevice = await seedDevice(alreadySentStudent.id);
  const remainingStudent = await seedStudent();
  const remainingDevice = await seedDevice(remainingStudent.id);

  const { campaignId, notificationId } = await simulateCrashedCampaign(
    "Recovery Verify PartialBatch",
    [alreadySentStudent.id, remainingStudent.id],
    {
      heartbeatMinutesAgo: 10,
      preExisting: [{ studentId: alreadySentStudent.id, deviceId: alreadySentDevice.id, status: "sent" }],
    },
  );

  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.status, "completed");
  assert.equal(result.devicesPreviouslySent, 1, "the pre-crash device must be recognized as already delivered");
  assert.equal(result.skippedAlreadySent, 1);
  assert.equal(result.devicesAttemptedThisRun, 1, "only the remaining device is actually attempted this run");
  assert.equal(result.sentThisRun, 1);

  // Explicit assertion: no duplicate Expo call for the already-sent device.
  assert.ok(!expoCallTokens.includes(alreadySentDevice.pushToken), "the already-sent device's token must never be sent to Expo again");
  assert.ok(expoCallTokens.includes(remainingDevice.pushToken), "the remaining device must be attempted");

  const statuses = await recipientStatuses(campaignId);
  assert.equal(statuses[alreadySentStudent.id], "sent");
  assert.equal(statuses[remainingStudent.id], "sent");

  const { rows: logRows } = await pool.query(`SELECT device_id AS "deviceId", status FROM notification_delivery_logs WHERE notification_id = $1`, [notificationId]);
  assert.equal(logRows.length, 2, "exactly one delivery log per device total — the pre-existing one was not duplicated");
});

// ─── 6/7: snapshot and notification row counts unchanged during recovery ────

test("6/7: recipient snapshot row count and notification row count are unchanged by recovery", async () => {
  const s1 = await seedStudent();
  await seedDevice(s1.id);
  const s2 = await seedStudent();
  await seedDevice(s2.id);
  const { campaignId, notificationId } = await simulateCrashedCampaign("Recovery Verify RowCountsStable", [s1.id, s2.id], { heartbeatMinutesAgo: 10 });

  const { rows: recipientsBefore } = await pool.query(`SELECT count(*)::int AS n FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  const { rows: notifsBefore } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE related_entity_type = 'notification_campaign' AND related_entity_id = $1`, [campaignId]);
  assert.equal(recipientsBefore[0].n, 2);
  assert.equal(notifsBefore[0].n, 1);

  await campaigns.resumeCampaign(campaignId);

  const { rows: recipientsAfter } = await pool.query(`SELECT count(*)::int AS n FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  const { rows: notifsAfter } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE related_entity_type = 'notification_campaign' AND related_entity_id = $1`, [campaignId]);
  assert.equal(recipientsAfter[0].n, 2, "recipient snapshot must never be recreated or duplicated by recovery");
  assert.equal(notifsAfter[0].n, 1, "a second canonical notification must never be inserted by recovery");

  const { rows: campaignRows } = await pool.query(`SELECT notification_id AS "notificationId" FROM notification_campaigns WHERE id = $1`, [campaignId]);
  assert.equal(campaignRows[0].notificationId, notificationId, "the exact same notification id is reused, never replaced");
});

// ─── 8: two concurrent resume attempts produce only one active sender ───────

test("8: two concurrent resume attempts on the same stale campaign produce exactly one active sender", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId } = await simulateCrashedCampaign("Recovery Verify ConcurrentResume", [student.id], { heartbeatMinutesAgo: 10 });

  const results = await Promise.allSettled([campaigns.resumeCampaign(campaignId), campaigns.resumeCampaign(campaignId)]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one concurrent resume attempt must succeed");
  assert.equal(rejected.length, 1, "the other must be rejected, never silently proceed");
  const rejection = rejected[0] as PromiseRejectedResult;
  assert.ok(rejection.reason instanceof campaigns.NotificationCampaignError);
  // The loser is always rejected by the atomic claim, but which reason it
  // sees depends on race timing: if it re-checks status while the winner is
  // still mid-flight, the campaign is still "sending" -> NOT_STALE (heartbeat
  // just moved); if the winner has already finalized by then, the campaign
  // is no longer "sending" at all -> NOT_RESUMABLE. Both are a safe,
  // deterministic rejection — the exact code is an implementation detail of
  // timing, not part of the guarantee under test here.
  const code = (rejection.reason as InstanceType<typeof campaigns.NotificationCampaignError>).code;
  assert.ok(code === "NOT_STALE" || code === "NOT_RESUMABLE", `expected NOT_STALE or NOT_RESUMABLE, got ${code}`);
});

// ─── 9: repeated resume after completion is safe/rejected ───────────────────

test("9: resuming an already-completed campaign is rejected, not re-run", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId } = await simulateCrashedCampaign("Recovery Verify ResumeAfterComplete", [student.id], { heartbeatMinutesAgo: 10 });
  const first = await campaigns.resumeCampaign(campaignId);
  assert.equal(first.status, "completed");

  await assert.rejects(
    () => campaigns.resumeCampaign(campaignId),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "NOT_RESUMABLE",
  );
});

// ─── 10/11: staleness gate ────────────────────────────────────────────────────

test("10: a non-stale (actively-heartbeating) sending campaign cannot be resumed", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId } = await simulateCrashedCampaign("Recovery Verify NotStale", [student.id], { heartbeatMinutesAgo: 0 });
  // heartbeatMinutesAgo: 0 -> "now() - interval '0 minutes'" == now(), i.e. actively fresh.
  await assert.rejects(
    () => campaigns.resumeCampaign(campaignId),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "NOT_STALE",
  );
  const statuses = await recipientStatuses(campaignId);
  assert.equal(statuses[student.id], "pending", "an actively-running campaign's recipients must be untouched by a rejected resume attempt");
});

test("11: a genuinely stale sending campaign can be resumed", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId } = await simulateCrashedCampaign("Recovery Verify IsStale", [student.id], { heartbeatMinutesAgo: 10 });
  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.wasStale, true);
  assert.equal(result.status, "completed");
});

// ─── 12/13: finalization outcomes preserve prior successful history ─────────

test("12: prior successful delivery + this run's failure -> completed_with_errors, never losing the earlier success", async () => {
  const sentStudent = await seedStudent();
  const sentDevice = await seedDevice(sentStudent.id);
  const failStudent = await seedStudent();
  const failDevice = await seedDevice(failStudent.id, { willFailCode: "DeviceNotRegistered" });

  const { campaignId } = await simulateCrashedCampaign(
    "Recovery Verify PriorSentThenFail",
    [sentStudent.id, failStudent.id],
    { heartbeatMinutesAgo: 10, preExisting: [{ studentId: sentStudent.id, deviceId: sentDevice.id, status: "sent" }] },
  );

  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.status, "completed_with_errors");
  assert.equal(result.sentDeviceCount, 1, "the pre-crash success is preserved in the final tally");
  assert.equal(result.failedDeviceCount, 1);
  void failDevice;
});

test("13: all remaining deliveries succeed on resume -> completed", async () => {
  const s1 = await seedStudent();
  await seedDevice(s1.id);
  const s2 = await seedStudent();
  await seedDevice(s2.id);
  const { campaignId } = await simulateCrashedCampaign("Recovery Verify AllSucceedOnResume", [s1.id, s2.id], { heartbeatMinutesAgo: 10 });
  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.status, "completed");
  assert.equal(result.sentDeviceCount, 2);
  assert.equal(result.failedDeviceCount, 0);
});

// ─── 14/15: retry classification ─────────────────────────────────────────────

test("14: a device with a permanent prior failure (DeviceNotRegistered) is not retried on resume", async () => {
  const student = await seedStudent();
  const device = await seedDevice(student.id);
  const { campaignId } = await simulateCrashedCampaign(
    "Recovery Verify PermanentNotRetried",
    [student.id],
    { heartbeatMinutesAgo: 10, preExisting: [{ studentId: student.id, deviceId: device.id, status: "failed", errorCode: "DeviceNotRegistered" }] },
  );
  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.devicesAttemptedThisRun, 0, "a permanently-failed device must not be attempted again");
  assert.ok(!expoCallTokens.includes(device.pushToken), "no Expo call for a permanently failed device");
  assert.equal(result.status, "failed", "nothing could ever be delivered for this campaign");
});

test("15: a device with a retryable prior failure (expo_request_failed) is retried within bounds", async () => {
  const student = await seedStudent();
  const device = await seedDevice(student.id); // will succeed this time (not in failingTokens)
  const { campaignId } = await simulateCrashedCampaign(
    "Recovery Verify RetryableRetried",
    [student.id],
    { heartbeatMinutesAgo: 10, preExisting: [{ studentId: student.id, deviceId: device.id, status: "failed", errorCode: "expo_request_failed" }] },
  );
  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.devicesAttemptedThisRun, 1, "a retryable failure must be retried");
  assert.ok(expoCallTokens.includes(device.pushToken));
  assert.equal(result.status, "completed");
  assert.equal(result.sentDeviceCount, 1);
});

test("a device already at the per-device attempt cap is not retried even with a retryable error code", async () => {
  process.env.NOTIFICATION_CAMPAIGN_DEVICE_MAX_ATTEMPTS = "2";
  try {
    const student = await seedStudent();
    const device = await seedDevice(student.id);
    const { campaignId } = await simulateCrashedCampaign(
      "Recovery Verify AttemptCapped",
      [student.id],
      {
        heartbeatMinutesAgo: 10,
        preExisting: [
          { studentId: student.id, deviceId: device.id, status: "failed", errorCode: "expo_request_failed" },
          { studentId: student.id, deviceId: device.id, status: "failed", errorCode: "expo_request_failed" },
        ],
      },
    );
    const result = await campaigns.resumeCampaign(campaignId);
    assert.equal(result.devicesAttemptedThisRun, 0, "a device at the attempt cap must not be retried even though its error is retryable");
    assert.ok(!expoCallTokens.includes(device.pushToken));
  } finally {
    delete process.env.NOTIFICATION_CAMPAIGN_DEVICE_MAX_ATTEMPTS;
  }
});

// ─── 18: read receipts remain intact across recovery ─────────────────────────

test("18: an existing read receipt survives recovery unchanged", async () => {
  const reader = await seedStudent();
  await seedDevice(reader.id, { willFailCode: "DeviceNotRegistered" }); // irrelevant to the read, just seeding a recipient
  const other = await seedStudent();
  await seedDevice(other.id);
  const { campaignId, notificationId } = await simulateCrashedCampaign("Recovery Verify ReadsIntact", [reader.id, other.id], { heartbeatMinutesAgo: 10 });

  await pool.query(`INSERT INTO notification_read_receipts (notification_id, student_id) VALUES ($1, $2)`, [notificationId, reader.id]);

  await campaigns.resumeCampaign(campaignId);

  const { rows } = await pool.query(`SELECT id FROM notification_read_receipts WHERE notification_id = $1 AND student_id = $2`, [notificationId, reader.id]);
  assert.equal(rows.length, 1, "the read receipt must survive resume untouched");
  const aggregate = await campaigns.computeCampaignAggregate(campaignId);
  assert.equal(aggregate.reads, 1);
});

// ─── max campaign send attempts ──────────────────────────────────────────────

test("a campaign at the max send-attempt cap is finalized as failed rather than remaining resumable forever", async () => {
  process.env.NOTIFICATION_CAMPAIGN_MAX_SEND_ATTEMPTS = "1";
  try {
    const student = await seedStudent();
    await seedDevice(student.id);
    const { campaignId } = await simulateCrashedCampaign("Recovery Verify MaxAttempts", [student.id], { heartbeatMinutesAgo: 10, sendAttempt: 1 });
    // sendAttempt is already 1 (== the original send); the claim increments
    // it to 2, exceeding the cap of 1.
    await assert.rejects(
      () => campaigns.resumeCampaign(campaignId),
      (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "MAX_ATTEMPTS_EXCEEDED",
    );
    const { rows } = await pool.query(`SELECT status FROM notification_campaigns WHERE id = $1`, [campaignId]);
    assert.equal(rows[0].status, "failed", "exceeding the attempt cap must finalize the campaign, not leave it stuck forever");
  } finally {
    delete process.env.NOTIFICATION_CAMPAIGN_MAX_SEND_ATTEMPTS;
  }
});

// ─── scale: 100 / 1,000 recipients, recovery after partial processing ───────

async function seedNStudentsWithDevices(n: number): Promise<Array<{ studentId: number; deviceId: number; pushToken: string }>> {
  const out: Array<{ studentId: number; deviceId: number; pushToken: string }> = [];
  for (let i = 0; i < n; i += 1) {
    const s = await seedStudent();
    const d = await seedDevice(s.id);
    out.push({ studentId: s.id, deviceId: d.id, pushToken: d.pushToken });
  }
  return out;
}

test("100 recipients: crash-then-resume delivers all 100 with bounded, deterministic aggregates", async () => {
  const seeded = await seedNStudentsWithDevices(100);
  const { campaignId } = await simulateCrashedCampaign("Recovery Verify Scale100", seeded.map((s) => s.studentId), { heartbeatMinutesAgo: 10 });
  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.status, "completed");
  assert.equal(result.sentDeviceCount, 100);
  assert.equal(result.failedDeviceCount, 0);
  assert.equal(result.remainingRecipients, 0);
  const seenTokens = new Set(expoCallTokens);
  assert.equal(seenTokens.size, 100, "no duplicate Expo calls across the whole recovered run");
});

test("1,000 recipients: recovery after ~half were already processed before the simulated crash delivers exactly the rest, with no duplicates", async () => {
  const seeded = await seedNStudentsWithDevices(1000);
  const alreadyProcessed = seeded.slice(0, 500);
  const remaining = seeded.slice(500);

  const { campaignId } = await simulateCrashedCampaign(
    "Recovery Verify Scale1000Partial",
    seeded.map((s) => s.studentId),
    {
      heartbeatMinutesAgo: 10,
      preExisting: alreadyProcessed.map((s) => ({ studentId: s.studentId, deviceId: s.deviceId, status: "sent" as const })),
    },
  );

  const result = await campaigns.resumeCampaign(campaignId);
  assert.equal(result.status, "completed");
  assert.equal(result.devicesPreviouslySent, 500, "exactly the pre-crash half is recognized as already delivered");
  assert.equal(result.devicesAttemptedThisRun, 500, "only the remaining half is actually attempted this run — bounded, not the full 1,000 again");
  assert.equal(result.sentDeviceCount, 1000, "the final cumulative tally still reflects the full campaign, including the pre-crash successes");
  assert.equal(result.failedDeviceCount, 0);
  assert.equal(result.remainingRecipients, 0);

  // No duplicate Expo call for any of the 500 pre-processed devices.
  for (const s of alreadyProcessed) {
    assert.ok(!expoCallTokens.includes(s.pushToken), `pre-processed device ${s.deviceId} must not be re-sent`);
  }
  // Every remaining device was in fact called exactly once.
  const remainingCallCounts = new Map<string, number>();
  for (const token of expoCallTokens) remainingCallCounts.set(token, (remainingCallCounts.get(token) ?? 0) + 1);
  for (const s of remaining) {
    assert.equal(remainingCallCounts.get(s.pushToken), 1, `remaining device ${s.deviceId} must be attempted exactly once`);
  }

  const { rows: logCountRows } = await pool.query(
    `SELECT count(*)::int AS n FROM notification_delivery_logs WHERE notification_id = (SELECT notification_id FROM notification_campaigns WHERE id = $1)`,
    [campaignId],
  );
  assert.equal(logCountRows[0].n, 1000, "exactly one delivery log per device across the whole campaign — 500 from before the crash + 500 from recovery");
});
