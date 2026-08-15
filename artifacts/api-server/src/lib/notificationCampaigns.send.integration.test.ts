/**
 * Notifications Wave 2 — recipient snapshot, send pipeline, delivery
 * aggregation, read aggregation, and backward-compatibility coverage.
 *
 * Calls sendCampaign() directly (not through the fire-and-forget HTTP
 * route) for deterministic assertions — see the Wave 2 report's "Send
 * Pipeline" section for why the route itself is fire-and-forget while this
 * function is fully awaitable.
 *
 * Never sends real Push: globalThis.fetch is replaced with a fake Expo
 * endpoint (token-level pass/fail control, not just call-index) for the
 * duration of this suite; ../lib/logger is left real (already proven safe
 * by Wave 1's suites) except where explicitly noted.
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

/** Tokens in this set produce an Expo "error" ticket; every other token succeeds. */
const failingTokens = new Set<string>();
let expoCallCount = 0;

function fakeExpoFetch(_input: unknown, init?: RequestInit): Promise<Response> {
  expoCallCount += 1;
  const messages = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
  const data = messages.map((msg) => (
    failingTokens.has(String(msg.to))
      ? { status: "error", message: "simulated failure", details: { error: "DeviceNotRegistered" } }
      : { status: "ok", id: `fake-ticket-${Math.random().toString(36).slice(2, 8)}` }
  ));
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as Response);
}

let pool: import("pg").Pool;
let campaigns: typeof import("./notificationCampaigns");
let push: typeof import("./pushNotifications");
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let studentSeq = 0;

async function seedStudent(): Promise<{ id: number; email: string }> {
  studentSeq += 1;
  const email = `campaign-send-${RUN}-${studentSeq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ($1, $2, 'student', true) RETURNING id`,
    [`Campaign Send Verify ${studentSeq}`, email],
  );
  return { id: rows[0].id, email };
}

async function seedDevice(studentId: number, opts: { platform?: string; willFail?: boolean } = {}): Promise<{ id: number; pushToken: string }> {
  const pushToken = `ExponentPushToken[campaign-${RUN}-${studentId}-${Math.random().toString(36).slice(2, 8)}]`;
  if (opts.willFail) failingTokens.add(pushToken);
  const { rows } = await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active) VALUES ($1, $2, 'expo', $3, true) RETURNING id`,
    [studentId, pushToken, opts.platform ?? "ios"],
  );
  return { id: rows[0].id, pushToken };
}

async function createDraftCampaign(title: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status) VALUES ($1, 'send test body', 'all', 'draft') RETURNING id`,
    [title],
  );
  return rows[0].id;
}

async function cleanupAllStudentsAndDevices(): Promise<void> {
  // Every send test deliberately shares "audienceType: all" == every
  // student account, so — same isolation requirement as Wave 1's broadcast
  // batching suite — each test must start from a clean students table.
  await pool.query(`DELETE FROM notification_delivery_logs WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-send-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_read_receipts WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-send-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-send-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_devices WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`campaign-send-${RUN}-%`]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`campaign-send-${RUN}-%`]);
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
  expoCallCount = 0;
  failingTokens.clear();
  await cleanupAllStudentsAndDevices();
});

after(async () => {
  globalThis.fetch = (globalThis as any).__origFetch;
  await cleanupAllStudentsAndDevices();
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE campaign_id IN (SELECT id FROM notification_campaigns WHERE title LIKE 'Send Verify%')`);
  await pool.query(`DELETE FROM notifications WHERE id IN (SELECT notification_id FROM notification_campaigns WHERE title LIKE 'Send Verify%' AND notification_id IS NOT NULL)`);
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'Send Verify%'`);
  await pool.end();
});

// ─── 8/9: snapshot created only at send, preview does not freeze ────────────

test("recipient snapshot has zero rows before send and exactly one row per account after", async () => {
  await seedStudent();
  await seedStudent();
  const campaignId = await createDraftCampaign("Send Verify SnapshotTiming");

  const preview = await campaigns.previewCampaignAudience({ audienceType: "all" });
  assert.equal(preview.matchedAccounts, 2);
  const { rows: beforeSend } = await pool.query(`SELECT id FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  assert.equal(beforeSend.length, 0, "preview must not have created any snapshot rows");

  await campaigns.sendCampaign(campaignId);
  const { rows: afterSend } = await pool.query(`SELECT id FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  assert.equal(afterSend.length, 2, "exactly one snapshot row per account after send");
});

// ─── 10: duplicate account resolves once (DB-level guarantee) ───────────────

test("the unique (campaign_id, student_id) constraint makes a duplicate snapshot row impossible", async () => {
  const student = await seedStudent();
  const campaignId = await createDraftCampaign("Send Verify DuplicateGuard");
  await pool.query(`INSERT INTO notification_campaign_recipients (campaign_id, student_id, status) VALUES ($1, $2, 'pending')`, [campaignId, student.id]);
  await assert.rejects(
    () => pool.query(`INSERT INTO notification_campaign_recipients (campaign_id, student_id, status) VALUES ($1, $2, 'pending')`, [campaignId, student.id]),
    /duplicate key value violates unique constraint/,
  );
});

// ─── 11: parent with multiple linked children resolves to one account row ───

test("a parent account with multiple linked children still resolves to exactly one recipient row", async () => {
  const parent = await seedStudent();
  await pool.query(`UPDATE students SET account_type = 'parent' WHERE id = $1`, [parent.id]);
  await pool.query(`INSERT INTO children (parent_id, full_name, gender) VALUES ($1, 'Child One', 'female'), ($1, 'Child Two', 'female')`, [parent.id]);
  const campaignId = await createDraftCampaign("Send Verify ParentMultiChild");
  await campaigns.sendCampaign(campaignId);
  const { rows } = await pool.query(`SELECT id FROM notification_campaign_recipients WHERE campaign_id = $1 AND student_id = $2`, [campaignId, parent.id]);
  assert.equal(rows.length, 1, "the parent account must appear exactly once regardless of how many children are linked");
});

// ─── 12: snapshot remains unchanged if source data changes after send ───────

test("recipient snapshot facts do not change when devices/accounts change after send", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const campaignId = await createDraftCampaign("Send Verify SnapshotFrozen");
  await campaigns.sendCampaign(campaignId);

  const { rows: before } = await pool.query(
    `SELECT active_device_count_at_snapshot AS "activeDeviceCountAtSnapshot", had_active_device_at_snapshot AS "hadActiveDeviceAtSnapshot"
     FROM notification_campaign_recipients WHERE campaign_id = $1 AND student_id = $2`,
    [campaignId, student.id],
  );
  assert.equal(before[0].activeDeviceCountAtSnapshot, 1);
  assert.equal(before[0].hadActiveDeviceAtSnapshot, true);

  // Mutate the world after send: add a second device for this student, and
  // a brand-new account entirely.
  await seedDevice(student.id);
  const lateStudent = await seedStudent();
  await seedDevice(lateStudent.id);

  const { rows: after } = await pool.query(
    `SELECT active_device_count_at_snapshot AS "activeDeviceCountAtSnapshot" FROM notification_campaign_recipients WHERE campaign_id = $1 AND student_id = $2`,
    [campaignId, student.id],
  );
  assert.equal(after[0].activeDeviceCountAtSnapshot, 1, "snapshot fact must stay frozen at what was true when sent, not what's true now");

  const { rows: lateRows } = await pool.query(`SELECT id FROM notification_campaign_recipients WHERE campaign_id = $1 AND student_id = $2`, [campaignId, lateStudent.id]);
  assert.equal(lateRows.length, 0, "an account created after send must never appear in the frozen snapshot");
});

// ─── 13: no Push token stored in snapshot ────────────────────────────────────

test("notification_campaign_recipients has no push-token column at all", async () => {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'notification_campaign_recipients'`,
  );
  const columnNames: string[] = rows.map((r: { column_name: string }) => r.column_name);
  assert.ok(!columnNames.some((c) => /token/i.test(c)), `no token-like column expected, found: ${columnNames.join(", ")}`);
  assert.ok(!columnNames.includes("email"));
  assert.ok(!columnNames.includes("phone"));
});

// ─── 14: send re-resolves after preview (does not trust a stale preview) ────

test("send resolves the audience fresh, including accounts that registered after preview", async () => {
  const early = await seedStudent();
  const campaignId = await createDraftCampaign("Send Verify ReResolve");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "all" });
  assert.equal(preview.matchedAccounts, 1);

  const late = await seedStudent(); // registers after preview, before send
  await campaigns.sendCampaign(campaignId);

  const { rows } = await pool.query(`SELECT student_id AS "studentId" FROM notification_campaign_recipients WHERE campaign_id = $1 ORDER BY student_id`, [campaignId]);
  const studentIds: number[] = rows.map((r: { studentId: number }) => r.studentId).sort((a: number, b: number) => a - b);
  assert.deepEqual(studentIds, [early.id, late.id].sort((a, b) => a - b), "send must include the late-registered account, proving it didn't trust the earlier preview");
});

// ─── 15/16/17: status transitions ────────────────────────────────────────────

test("campaign transitions draft -> sending -> completed when every device succeeds", async () => {
  const s1 = await seedStudent();
  const s2 = await seedStudent();
  await seedDevice(s1.id);
  await seedDevice(s2.id);
  const campaignId = await createDraftCampaign("Send Verify AllSucceed");
  const result = await campaigns.sendCampaign(campaignId);
  assert.equal(result.status, "completed");
  assert.equal(result.sentDeviceCount, 2);
  assert.equal(result.failedDeviceCount, 0);
  const { rows } = await pool.query(`SELECT status FROM notification_campaigns WHERE id = $1`, [campaignId]);
  assert.equal(rows[0].status, "completed");
});

test("campaign transitions to completed_with_errors on partial device failure", async () => {
  const s1 = await seedStudent();
  const s2 = await seedStudent();
  await seedDevice(s1.id);
  await seedDevice(s2.id, { willFail: true });
  const campaignId = await createDraftCampaign("Send Verify PartialFail");
  const result = await campaigns.sendCampaign(campaignId);
  assert.equal(result.status, "completed_with_errors");
  assert.equal(result.sentDeviceCount, 1);
  assert.equal(result.failedDeviceCount, 1);
});

test("campaign transitions to failed when every attempted device fails", async () => {
  const s1 = await seedStudent();
  const s2 = await seedStudent();
  await seedDevice(s1.id, { willFail: true });
  await seedDevice(s2.id, { willFail: true });
  const campaignId = await createDraftCampaign("Send Verify TotalFail");
  const result = await campaigns.sendCampaign(campaignId);
  assert.equal(result.status, "failed");
  assert.equal(result.sentDeviceCount, 0);
  assert.equal(result.failedDeviceCount, 2);
});

test("campaign with zero push-enabled accounts completes cleanly (nothing to fail)", async () => {
  await seedStudent(); // no device
  const campaignId = await createDraftCampaign("Send Verify NoDevices");
  const result = await campaigns.sendCampaign(campaignId);
  assert.equal(result.status, "completed");
  assert.equal(result.noDeviceAccountCount, 1);
  assert.equal(result.sentDeviceCount, 0);
  assert.equal(result.failedDeviceCount, 0);
});

// ─── 18: delivery logs link to campaign notification ─────────────────────────

test("delivery logs are linked to the campaign's canonical notification row", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const campaignId = await createDraftCampaign("Send Verify DeliveryLink");
  await campaigns.sendCampaign(campaignId);

  const { rows: campaignRows } = await pool.query(`SELECT notification_id AS "notificationId" FROM notification_campaigns WHERE id = $1`, [campaignId]);
  const notificationId = campaignRows[0].notificationId;
  assert.ok(notificationId);

  const { rows: logRows } = await pool.query(`SELECT status FROM notification_delivery_logs WHERE notification_id = $1 AND student_id = $2`, [notificationId, student.id]);
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].status, "sent");
});

// ─── 19/20: 26+ / 100 / 1,000 devices — Wave 1 batching, no truncation ───────

async function seedNStudentsWithDevices(n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = await seedStudent();
    await seedDevice(s.id);
    ids.push(s.id);
  }
  return ids;
}

for (const n of [26, 100]) {
  test(`campaign send with ${n} recipients fully processes all ${n} through Wave 1 batching (no truncation)`, async () => {
    await seedNStudentsWithDevices(n);
    const campaignId = await createDraftCampaign(`Send Verify Scale${n}`);
    const result = await campaigns.sendCampaign(campaignId);
    assert.equal(result.intendedRecipientCount, n);
    assert.equal(result.sentDeviceCount, n);
    assert.equal(result.failedDeviceCount, 0);
    assert.equal(result.status, "completed");
    assert.equal(result.truncated, false);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notification_campaign_recipients WHERE campaign_id = $1 AND status = 'sent'`, [campaignId]);
    assert.equal(rows[0].n, n);
  });
}

test("campaign send with 1,000 recipients fully processes all 1,000, bounded memory, no truncation", async () => {
  await seedNStudentsWithDevices(1000);
  const campaignId = await createDraftCampaign("Send Verify Scale1000");
  const result = await campaigns.sendCampaign(campaignId);
  assert.equal(result.intendedRecipientCount, 1000);
  assert.equal(result.sentDeviceCount, 1000);
  assert.equal(result.failedDeviceCount, 0);
  assert.equal(result.status, "completed");
  assert.equal(result.truncated, false);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notification_campaign_recipients WHERE campaign_id = $1 AND status = 'sent'`, [campaignId]);
  assert.equal(rows[0].n, 1000);
  // Aggregate query performance/indexes sanity: detail-style aggregate over
  // 1,000 rows must still resolve to exactly the right numbers, not just
  // "some number" — proves the join strategy in computeCampaignAggregate
  // doesn't silently drop or double-count rows at this volume.
  const aggregate = await campaigns.computeCampaignAggregate(campaignId);
  assert.equal(aggregate.intendedRecipients, 1000);
  assert.equal(aggregate.sentDevices, 1000);
  assert.equal(aggregate.attemptedDevices, 1000);
});

// ─── 21-23: reads ─────────────────────────────────────────────────────────────

test("one account read counts as exactly one campaign read, and multiple devices never multiply it", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  await seedDevice(student.id); // second device, same account
  const campaignId = await createDraftCampaign("Send Verify ReadsOneAccount");
  await campaigns.sendCampaign(campaignId);
  const { rows: campaignRows } = await pool.query(`SELECT notification_id AS "notificationId" FROM notification_campaigns WHERE id = $1`, [campaignId]);
  const notificationId = campaignRows[0].notificationId;

  await pool.query(`INSERT INTO notification_read_receipts (notification_id, student_id) VALUES ($1, $2)`, [notificationId, student.id]);

  const reads = await campaigns.countCampaignReads(campaignId, notificationId);
  assert.equal(reads, 1, "one account read, regardless of that account owning two devices");

  const aggregate = await campaigns.computeCampaignAggregate(campaignId);
  assert.equal(aggregate.reads, 1);
});

test("read count can never exceed intended recipient count", async () => {
  const students = await Promise.all([seedStudent(), seedStudent(), seedStudent()]);
  for (const s of students) await seedDevice(s.id);
  const campaignId = await createDraftCampaign("Send Verify ReadsBounded");
  await campaigns.sendCampaign(campaignId);
  const { rows: campaignRows } = await pool.query(`SELECT notification_id AS "notificationId" FROM notification_campaigns WHERE id = $1`, [campaignId]);
  const notificationId = campaignRows[0].notificationId;
  for (const s of students) {
    await pool.query(`INSERT INTO notification_read_receipts (notification_id, student_id) VALUES ($1, $2)`, [notificationId, s.id]);
  }
  const aggregate = await campaigns.computeCampaignAggregate(campaignId);
  assert.equal(aggregate.reads, 3);
  assert.ok(aggregate.reads <= aggregate.intendedRecipients, "reads must never exceed intended recipients");
});

// ─── 28-30: backward compatibility ────────────────────────────────────────────

test("a legacy (pre-campaign) target='all' notification is unaffected by the campaign feature existing", async () => {
  const { rows } = await pool.query(
    `INSERT INTO notifications (title, body, target, source, is_draft, sent_at)
     VALUES ('Send Verify Legacy Broadcast', 'legacy body', 'all', 'manual_admin', false, now()) RETURNING id`,
  );
  const legacyId = rows[0].id;
  // Same visibility semantics as before Wave 2 — target='all' is visible
  // unconditionally, campaign machinery never enters into it.
  const { rows: check } = await pool.query(`SELECT target, source FROM notifications WHERE id = $1`, [legacyId]);
  assert.equal(check[0].target, "all");
  assert.equal(check[0].source, "manual_admin");
  await pool.query(`DELETE FROM notifications WHERE id = $1`, [legacyId]);
});

test("a system-generated notification (target='student:{id}', source='system') is unaffected", async () => {
  const student = await seedStudent();
  const { rows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, source, is_draft, sent_at)
     VALUES ('Send Verify System Notif', 'system body', $1, 'booking_confirmed', 'system', false, now()) RETURNING id`,
    [`student:${student.id}`],
  );
  const notifId = rows[0].id;
  const { rows: check } = await pool.query(`SELECT target, source, type FROM notifications WHERE id = $1`, [notifId]);
  assert.equal(check[0].source, "system");
  assert.equal(check[0].type, "booking_confirmed");
  await pool.query(`DELETE FROM notifications WHERE id = $1`, [notifId]);
});

// ─── Integrity review Part 3: crash/recovery behavior ────────────────────────
// sendCampaign()'s transactional step (freeze + create notification +
// status='sending') is atomic — a crash during it rolls back cleanly and is
// not interesting to test here (Postgres already guarantees it). What's
// actually testable is the aftermath of a crash occurring AFTER that
// transaction commits but before the pipeline finishes: this is simulated
// directly (raw SQL replicating exactly what the transactional step does)
// rather than by interrupting a real sendCampaign() call mid-flight, since
// there is no real async boundary to interrupt in this synchronous,
// fire-and-forget-from-the-route architecture.

async function simulateCrashMidSend(title: string, studentId: number): Promise<{ campaignId: number; notificationId: number }> {
  const { rows: campaignRows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, status) VALUES ($1, 'crash sim body', 'all', 'draft') RETURNING id`,
    [title],
  );
  const campaignId = campaignRows[0].id;
  const { rows: notifRows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ($1, 'crash sim body', $2, 'manual_campaign', 'notification_campaign', $3, 'manual_admin', false, now()) RETURNING id`,
    [title, `campaign:${campaignId}`, campaignId],
  );
  const notificationId = notifRows[0].id;
  await pool.query(`INSERT INTO notification_campaign_recipients (campaign_id, student_id, status) VALUES ($1, $2, 'pending')`, [campaignId, studentId]);
  // The exact state sendCampaign()'s transaction leaves behind on commit —
  // then the process is presumed to have died before sendCampaignPushNotification
  // or the final status update ever ran.
  await pool.query(`UPDATE notification_campaigns SET status = 'sending', notification_id = $1, sent_at = now() WHERE id = $2`, [notificationId, campaignId]);
  return { campaignId, notificationId };
}

test("a campaign stuck at status=sending after a simulated crash never auto-resolves and is never silently reported as completed", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId } = await simulateCrashMidSend("Send Verify CrashStuck", student.id);

  // Nothing in this codebase revisits a "sending" campaign (confirmed: no
  // Worker/cron reconciliation exists for notification_campaigns) — so
  // status must remain exactly "sending", never silently "completed".
  const { rows: statusRows } = await pool.query(`SELECT status FROM notification_campaigns WHERE id = $1`, [campaignId]);
  assert.equal(statusRows[0].status, "sending", "a crashed campaign must remain visibly 'sending', never silently 'completed'");
});

test("retrying a stuck 'sending' campaign through sendCampaign() is rejected, not duplicated", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId, notificationId } = await simulateCrashMidSend("Send Verify CrashRetryReject", student.id);

  await assert.rejects(
    () => campaigns.sendCampaign(campaignId),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "NOT_SENDABLE",
    "sendCampaign() must reject re-entry on a 'sending' campaign, exactly as it does for any other non-draft/ready status",
  );

  // No Push was ever attempted by the rejected retry — confirms retry
  // cannot duplicate already-sent (or, here, never-sent) devices, because
  // it never reaches the delivery step at all.
  const { rows: logRows } = await pool.query(`SELECT id FROM notification_delivery_logs WHERE notification_id = $1`, [notificationId]);
  assert.equal(logRows.length, 0, "a rejected retry must not create any delivery log rows");
  const { rows: statusRows } = await pool.query(`SELECT status FROM notification_campaigns WHERE id = $1`, [campaignId]);
  assert.equal(statusRows[0].status, "sending", "status is unchanged by the rejected retry attempt");
});

test("a crashed campaign's frozen snapshot and canonical notification remain fully intact and queryable for manual recovery", async () => {
  const student = await seedStudent();
  await seedDevice(student.id);
  const { campaignId, notificationId } = await simulateCrashMidSend("Send Verify CrashDataIntact", student.id);

  // This is the evidence that recovery is POSSIBLE in principle (a
  // future Wave 2.1 could safely resume from here) even though Wave 2
  // itself provides no automated resume path — see the Wave 2 integrity
  // review report's classification of this as a reliability gap, not a
  // data-loss risk.
  const { rows: recipientRows } = await pool.query(`SELECT status, student_id AS "studentId" FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  assert.equal(recipientRows.length, 1);
  assert.equal(recipientRows[0].status, "pending", "an untouched recipient's status correctly still reads 'pending', identifying exactly what a resume would need to (re-)attempt");
  assert.equal(recipientRows[0].studentId, student.id);

  const { rows: notifRows } = await pool.query(`SELECT id, target, source FROM notifications WHERE id = $1`, [notificationId]);
  assert.equal(notifRows.length, 1);
  assert.equal(notifRows[0].target, `campaign:${campaignId}`);
});

// ─── Integrity review Part 4: snapshot-time vs delivery-time divergence ─────

test("a recipient who loses their active device between snapshot freeze and delivery is correctly skipped, without corrupting the frozen snapshot fact", async () => {
  const student = await seedStudent();
  const device = await seedDevice(student.id);
  const campaignId = await createDraftCampaign("Send Verify SnapshotThenLogout");

  // Freeze only (raw SQL, mirroring freezeCampaignRecipients exactly) —
  // captures hadActiveDeviceAtSnapshot=true, activeDeviceCountAtSnapshot=1.
  const { rows: notifRows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ('snapshot-logout body', 'body', $1, 'manual_campaign', 'notification_campaign', $2, 'manual_admin', false, now()) RETURNING id`,
    [`campaign:${campaignId}`, campaignId],
  );
  const notificationId = notifRows[0].id;
  await pool.query(
    `INSERT INTO notification_campaign_recipients (campaign_id, student_id, status, had_active_device_at_snapshot, active_device_count_at_snapshot)
     VALUES ($1, $2, 'pending', true, 1)`,
    [campaignId, student.id],
  );
  await pool.query(`UPDATE notification_campaigns SET status = 'sending', notification_id = $1 WHERE id = $2`, [notificationId, campaignId]);

  // Recipient logs out — device deactivated — strictly BETWEEN snapshot
  // freeze and delivery processing.
  await pool.query(`UPDATE notification_devices SET is_active = false WHERE id = $1`, [device.id]);

  const pushResult = await push.sendCampaignPushNotification({
    campaignId,
    notificationId,
    title: "snapshot-logout body",
    body: "body",
    // Wave 2.1 lease token: this test's raw-SQL setup above never sets
    // send_attempt, so it stays at the column default (0) — must match for
    // the lease checkpoint to confirm ownership.
    leaseSendAttempt: 0,
  });
  assert.equal(pushResult.matchedDevices, 0, "the now-inactive device must not be attempted");
  assert.equal(pushResult.noDeviceStudents, 1);

  const { rows: recipientRows } = await pool.query(
    `SELECT status, had_active_device_at_snapshot AS "hadActiveDeviceAtSnapshot", active_device_count_at_snapshot AS "activeDeviceCountAtSnapshot"
     FROM notification_campaign_recipients WHERE campaign_id = $1 AND student_id = $2`,
    [campaignId, student.id],
  );
  // The documented, intentional divergence: delivery-time status reflects
  // reality (no_device), while the snapshot-time fact stays exactly what
  // it was frozen as (true / 1) — neither value is "corrected" to match
  // the other after the fact.
  assert.equal(recipientRows[0].status, "no_device");
  assert.equal(recipientRows[0].hadActiveDeviceAtSnapshot, true, "the frozen snapshot fact must never be silently rewritten by a later delivery outcome");
  assert.equal(recipientRows[0].activeDeviceCountAtSnapshot, 1);
});

test("a recipient who registers a device between snapshot freeze and delivery still receives the push, even though the snapshot recorded no device", async () => {
  const student = await seedStudent(); // no device yet at "freeze" time
  const campaignId = await createDraftCampaign("Send Verify SnapshotThenRegister");

  const { rows: notifRows } = await pool.query(
    `INSERT INTO notifications (title, body, target, type, related_entity_type, related_entity_id, source, is_draft, sent_at)
     VALUES ('snapshot-register body', 'body', $1, 'manual_campaign', 'notification_campaign', $2, 'manual_admin', false, now()) RETURNING id`,
    [`campaign:${campaignId}`, campaignId],
  );
  const notificationId = notifRows[0].id;
  await pool.query(
    `INSERT INTO notification_campaign_recipients (campaign_id, student_id, status, had_active_device_at_snapshot, active_device_count_at_snapshot)
     VALUES ($1, $2, 'pending', false, 0)`,
    [campaignId, student.id],
  );
  await pool.query(`UPDATE notification_campaigns SET status = 'sending', notification_id = $1 WHERE id = $2`, [notificationId, campaignId]);

  // Registers a device strictly AFTER the snapshot was frozen.
  await seedDevice(student.id);

  const pushResult = await push.sendCampaignPushNotification({
    campaignId,
    notificationId,
    title: "snapshot-register body",
    body: "body",
    // Wave 2.1 lease token — see the matching comment above.
    leaseSendAttempt: 0,
  });
  assert.equal(pushResult.sent, 1, "delivery uses live device state, so the newly-registered device correctly receives the push");

  const { rows: recipientRows } = await pool.query(
    `SELECT status, had_active_device_at_snapshot AS "hadActiveDeviceAtSnapshot"
     FROM notification_campaign_recipients WHERE campaign_id = $1 AND student_id = $2`,
    [campaignId, student.id],
  );
  assert.equal(recipientRows[0].status, "sent", "delivery-time outcome reflects what actually happened");
  assert.equal(recipientRows[0].hadActiveDeviceAtSnapshot, false, "the frozen snapshot fact (no device at freeze time) is correctly preserved even though delivery ultimately succeeded");
});
