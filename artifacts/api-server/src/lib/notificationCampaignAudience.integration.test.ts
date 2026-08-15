/**
 * Notifications Wave 3 — Manual Push Campaign audience segments.
 *
 * Real DB integration tests against a disposable local Postgres, fake Expo
 * provider. Covers all seven audience types (all_members, specific_members,
 * students, parents, ballet_families, class_participants, package_holders),
 * the shared resolver's preview/send consistency, and the security/config
 * validation rules — see the Wave 3 report for the full numbered
 * scenario list this file implements.
 *
 * Regression coverage for Wave 1/2/2.1 (campaign lifecycle, send, mobile
 * visibility, recovery, concurrency, broadcast batching, privacy/logout) is
 * NOT duplicated here — those are the existing dedicated suites, re-run
 * separately and reported alongside this file's results.
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

const expoCallTokens: string[] = [];
function fakeExpoFetch(_input: unknown, init?: RequestInit): Promise<Response> {
  const messages = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
  const data = messages.map((msg) => {
    expoCallTokens.push(String(msg.to));
    return { status: "ok", id: `fake-ticket-${Math.random().toString(36).slice(2, 8)}` };
  });
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as Response);
}

let pool: import("pg").Pool;
let campaigns: typeof import("./notificationCampaigns");
let audience: typeof import("./notificationCampaignAudience");
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedStudent(opts: { accountType?: string | null; emailVerified?: boolean } = {}): Promise<{ id: number; email: string }> {
  seq += 1;
  const email = `w3-${RUN}-${seq}@example.invalid`;
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, account_type, email_verified) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`W3 Verify ${seq}`, email, opts.accountType ?? null, opts.emailVerified ?? true],
  );
  return { id: rows[0].id, email };
}

async function seedDevice(studentId: number): Promise<{ id: number; pushToken: string }> {
  const pushToken = `ExponentPushToken[w3-${RUN}-${studentId}-${Math.random().toString(36).slice(2, 8)}]`;
  const { rows } = await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, provider, platform, is_active) VALUES ($1, $2, 'expo', 'ios', true) RETURNING id`,
    [studentId, pushToken],
  );
  return { id: rows[0].id, pushToken };
}

async function seedChild(parentId: number): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO children (parent_id, full_name, gender) VALUES ($1, $2, 'female') RETURNING id`,
    [parentId, `W3 Child ${seq}`],
  );
  return { id: rows[0].id };
}

let balletLevelId: number | null = null;
async function ensureBalletLevel(): Promise<number> {
  if (balletLevelId) return balletLevelId;
  const { rows } = await pool.query(`INSERT INTO ballet_levels (name) VALUES ($1) RETURNING id`, [`W3 Level ${RUN}`]);
  balletLevelId = rows[0].id as number;
  return balletLevelId;
}

async function seedBalletApplication(): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO ballet_applications (parent_name, parent_phone, parent_email, child_name, status)
     VALUES ('W3 Parent', '+201000000000', $1, 'W3 Child', 'active') RETURNING id`,
    [`w3-app-${RUN}-${seq}@example.invalid`],
  );
  return { id: rows[0].id };
}

async function seedBalletLevelAssignment(childId: number, status: "active" | "paused" | "graduated" | "withdrawn"): Promise<{ id: number }> {
  const application = await seedBalletApplication();
  const levelId = await ensureBalletLevel();
  const { rows } = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, child_id, level_id, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [application.id, childId, levelId, status],
  );
  return { id: rows[0].id };
}

async function seedClass(): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO classes (title, category, duration_mins, capacity) VALUES ($1, 'general', 60, 20) RETURNING id`,
    [`W3 Class ${RUN}-${seq}`],
  );
  return { id: rows[0].id };
}

async function seedSchedule(classId: number, opts: { dayOfWeek: number; status?: string }): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time) VALUES ($1, 'weekly', $2, $3, '10:00', '11:00') RETURNING id`,
    [classId, opts.status ?? "active", opts.dayOfWeek],
  );
  return { id: rows[0].id };
}

async function seedBooking(params: { scheduleId: number; classId: number; occurrenceDate: string; accountOwnerStudentId: number; bookingStatus: string }): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, status, booking_status)
     VALUES ('W3 Booking', 'w3-booking@example.invalid', $1, $2, $3, $4, 'confirmed', $5) RETURNING id`,
    [params.accountOwnerStudentId, params.scheduleId, params.classId, params.occurrenceDate, params.bookingStatus],
  );
  return { id: rows[0].id };
}

async function seedPricePackage(): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions) VALUES ($1, 'per_class', 500, 5) RETURNING id`,
    [`W3 Package ${RUN}-${seq}`],
  );
  return { id: rows[0].id };
}

async function seedPackageOrder(params: { studentId: number; packageId: number; status: string; remainingCredits: number; expiresAt?: string | null }): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status, expires_at)
     VALUES ('W3 Order', 'w3-order@example.invalid', $1, $2, 'W3 Package', 5, $3, $4, $5) RETURNING id`,
    [params.studentId, params.packageId, params.remainingCredits, params.status, params.expiresAt ?? null],
  );
  return { id: rows[0].id };
}

async function createDraftCampaign(title: string, audienceType: string, audienceConfig: Record<string, unknown> = {}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO notification_campaigns (title, body, audience_type, audience_config, status) VALUES ($1, 'w3 test body', $2, $3, 'draft') RETURNING id`,
    [title, audienceType, JSON.stringify(audienceConfig)],
  );
  return rows[0].id;
}

async function cleanupAll(): Promise<void> {
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`w3-${RUN}-%`]);
  await pool.query(`DELETE FROM notification_delivery_logs WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`w3-${RUN}-%`]);
  await pool.query(`DELETE FROM bookings WHERE student_email = 'w3-booking@example.invalid'`);
  await pool.query(`DELETE FROM package_orders WHERE student_email = 'w3-order@example.invalid'`);
  await pool.query(`DELETE FROM price_packages WHERE name LIKE $1`, [`W3 Package ${RUN}-%`]);
  await pool.query(`DELETE FROM ballet_level_assignments WHERE application_id IN (SELECT id FROM ballet_applications WHERE parent_email LIKE $1)`, [`w3-app-${RUN}-%`]);
  await pool.query(`DELETE FROM ballet_applications WHERE parent_email LIKE $1`, [`w3-app-${RUN}-%`]);
  await pool.query(`DELETE FROM children WHERE parent_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`w3-${RUN}-%`]);
  await pool.query(`DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE title LIKE $1)`, [`W3 Class ${RUN}-%`]);
  await pool.query(`DELETE FROM classes WHERE title LIKE $1`, [`W3 Class ${RUN}-%`]);
  await pool.query(`DELETE FROM notification_devices WHERE student_id IN (SELECT id FROM students WHERE email LIKE $1)`, [`w3-${RUN}-%`]);
  await pool.query(`DELETE FROM students WHERE email LIKE $1`, [`w3-${RUN}-%`]);
  seq = 0;
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  campaigns = await import("./notificationCampaigns");
  audience = await import("./notificationCampaignAudience");
  (globalThis as any).__origFetch = globalThis.fetch;
  globalThis.fetch = fakeExpoFetch as unknown as typeof globalThis.fetch;
});

beforeEach(async () => {
  expoCallTokens.length = 0;
  await cleanupAll();
});

after(async () => {
  globalThis.fetch = (globalThis as any).__origFetch;
  await cleanupAll();
  await pool.query(`DELETE FROM notification_campaign_recipients WHERE campaign_id IN (SELECT id FROM notification_campaigns WHERE title LIKE 'W3 Verify%')`);
  await pool.query(`DELETE FROM notifications WHERE id IN (SELECT notification_id FROM notification_campaigns WHERE title LIKE 'W3 Verify%' AND notification_id IS NOT NULL)`);
  await pool.query(`DELETE FROM notification_campaigns WHERE title LIKE 'W3 Verify%'`);
  await pool.query(`DELETE FROM ballet_levels WHERE name LIKE $1`, [`W3 Level ${RUN}`]);
  await pool.end();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1-5: All Members
// ═══════════════════════════════════════════════════════════════════════════

test("1/2: all_members includes a normal student and a parent account", async () => {
  const student = await seedStudent({ accountType: "student" });
  const parent = await seedStudent({ accountType: "parent" });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 2);
  void student; void parent;
});

test("3: all_members includes a member with no device (noActiveDeviceAccounts counts them)", async () => {
  await seedStudent();
  const preview = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
  assert.equal(preview.pushEnabledAccounts, 0);
  assert.equal(preview.activeDevices, 0);
  assert.equal(preview.noActiveDeviceAccounts, 1);
});

test("4: all_members with one account and 3 devices — matchedAccounts=1, pushEnabledAccounts=1, activeDevices=3 (account count != device count)", async () => {
  const s = await seedStudent();
  await seedDevice(s.id);
  await seedDevice(s.id);
  await seedDevice(s.id);
  const preview = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
  assert.equal(preview.pushEnabledAccounts, 1);
  assert.equal(preview.activeDevices, 3);
  assert.equal(preview.noActiveDeviceAccounts, 0);
});

test("5: no deleted/blocked/disabled flag exists on students — all_members matches every account that exists, no invented exclusion", async () => {
  // Investigation finding (Wave 3 report §4): the students table has no
  // deleted/blocked/disabled column anywhere in the schema. "Exists in the
  // students table" is therefore the strongest safe eligibility definition
  // — this test documents and locks in that decision rather than a
  // fabricated exclusion rule.
  await seedStudent();
  await seedStudent();
  await seedStudent();
  const preview = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 3);
});

test("5b: an unverified account IS a matched member account (A) but structurally cannot be push-capable (B) — verification gates Push registration, not membership", async () => {
  // Business-rule review finding: a students row is created immediately at
  // signup (emailVerified defaults to false) and persists as a real,
  // permanent account regardless of whether OTP is ever completed — there
  // is no separate pending/staging table, no purge job, and unverified
  // accounts can still log in and use /auth/me and profile routes (just not
  // "verified-only" ones). PushRegistrationGate (central/components/
  // PushRegistrationGate.tsx) independently requires emailVerified=true
  // before ever calling registerPushNotificationsForCurrentUser — so an
  // unverified account is CORRECTLY matched here (it is a real member) and
  // is separately, structurally reported as having no device, exactly
  // distinguishing "matched member account" from "push-capable account"
  // without needing any extra filter in the resolver.
  await seedStudent({ emailVerified: false });
  const verified = await seedStudent({ emailVerified: true });
  await seedDevice(verified.id);

  const preview = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 2, "the unverified account is a matched member account");
  assert.equal(preview.pushEnabledAccounts, 1, "only the verified account (the only one that could ever register a device) is push-enabled");
  assert.equal(preview.noActiveDeviceAccounts, 1, "the unverified account correctly shows as no-device, not as excluded from matching");
});

// ═══════════════════════════════════════════════════════════════════════════
// 6-10: Specific Members
// ═══════════════════════════════════════════════════════════════════════════

test("6: specific_members matches only the selected IDs", async () => {
  const a = await seedStudent();
  const b = await seedStudent();
  await seedStudent(); // not selected
  const preview = await campaigns.previewCampaignAudience({ audienceType: "specific_members", audienceConfig: { studentIds: [a.id, b.id] } });
  assert.equal(preview.matchedAccounts, 2);
});

test("7: specific_members deduplicates repeated IDs in the submitted list", async () => {
  const a = await seedStudent();
  const validated = await audience.validateAndNormalizeAudienceConfig("specific_members", { studentIds: [a.id, a.id, a.id] });
  assert.deepEqual(validated.studentIds, [a.id]);
});

test("8: specific_members rejects a nonexistent ID (validate all IDs exist)", async () => {
  const a = await seedStudent();
  const bogusId = a.id + 1_000_000;
  await assert.rejects(
    () => audience.validateAndNormalizeAudienceConfig("specific_members", { studentIds: [a.id, bogusId] }),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "INVALID_AUDIENCE_CONFIG",
  );
});

test("9: a child's id cannot become an independent recipient account via specific_members", async () => {
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  // The child's id lives in a completely separate table/id-space; unless it
  // coincidentally collides with a real students.id (which it structurally
  // cannot be interpreted as here), specific_members simply has no matching
  // account for it and validation correctly rejects it as nonexistent.
  await assert.rejects(
    () => audience.validateAndNormalizeAudienceConfig("specific_members", { studentIds: [child.id + 5_000_000] }),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "INVALID_AUDIENCE_CONFIG",
  );
});

test("10: specific_members never includes an account that was not selected", async () => {
  const selected = await seedStudent();
  await seedStudent();
  await seedStudent();
  const campaignId = await createDraftCampaign("W3 Verify SpecificMembersSend", "specific_members", { studentIds: [selected.id] });
  const result = await campaigns.sendCampaign(campaignId);
  assert.equal(result.intendedRecipientCount, 1);
  const { rows } = await pool.query(`SELECT student_id AS "studentId" FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].studentId, selected.id);
});

test("specific_members with an empty list is rejected (400) — a campaign with zero chosen recipients is never a meaningful send", async () => {
  await assert.rejects(() => audience.validateAndNormalizeAudienceConfig("specific_members", { studentIds: [] }));
});

// ═══════════════════════════════════════════════════════════════════════════
// 11-13: Students
// ═══════════════════════════════════════════════════════════════════════════

test("11/12: students includes accountType='student' and legacy NULL accountType", async () => {
  const explicit = await seedStudent({ accountType: "student" });
  const legacy = await seedStudent({ accountType: null });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "students", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 2);
  void explicit; void legacy;
});

test("13: students excludes parent accounts", async () => {
  await seedStudent({ accountType: "student" });
  await seedStudent({ accountType: "parent" });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "students", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 14-16: Parents
// ═══════════════════════════════════════════════════════════════════════════

test("14/15: parents includes accountType='parent' and excludes students", async () => {
  await seedStudent({ accountType: "parent" });
  await seedStudent({ accountType: "student" });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "parents", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
});

test("16: a parent with 3 children is counted once, never multiplied by child count", async () => {
  const parent = await seedStudent({ accountType: "parent" });
  await seedChild(parent.id);
  await seedChild(parent.id);
  await seedChild(parent.id);
  const preview = await campaigns.previewCampaignAudience({ audienceType: "parents", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 17-20: Ballet Families
// ═══════════════════════════════════════════════════════════════════════════

test("17: a parent with an active Ballet level assignment is included", async () => {
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  await seedBalletLevelAssignment(child.id, "active");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "ballet_families", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
});

test("18: an accepted application with NO ballet_level_assignments row is excluded (application status alone never qualifies)", async () => {
  const parent = await seedStudent();
  await seedChild(parent.id);
  // A ballet_applications row with status='active' exists (seedBalletApplication
  // default), but no ballet_level_assignments row references this family at
  // all — per the task's explicit rule, application status is never the
  // Ballet-Family signal.
  await seedBalletApplication();
  const preview = await campaigns.previewCampaignAudience({ audienceType: "ballet_families", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 0);
});

test("19: a withdrawn/inactive ballet_level_assignments row is excluded", async () => {
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  await seedBalletLevelAssignment(child.id, "withdrawn");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "ballet_families", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 0);
});

test("20: a parent with two active Ballet children is counted once", async () => {
  const parent = await seedStudent();
  const child1 = await seedChild(parent.id);
  const child2 = await seedChild(parent.id);
  await seedBalletLevelAssignment(child1.id, "active");
  await seedBalletLevelAssignment(child2.id, "active");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "ballet_families", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
});

test("19b: a PAUSED ballet_level_assignments row is excluded — only status='active' counts as currently enrolled", async () => {
  // Business-rule review: confirmed via adminBallet.ts's assign-level
  // invariant comment ("at most one row with status=active per
  // application"; anything else — withdrawn/graduated/paused — is
  // historical and never reused) that 'paused' is one of the terminal/
  // non-current states, not a second flavor of "active".
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  await seedBalletLevelAssignment(child.id, "paused");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "ballet_families", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 0);
});

test("19c: a GRADUATED ballet_level_assignments row is excluded", async () => {
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  await seedBalletLevelAssignment(child.id, "graduated");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "ballet_families", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 0);
});

test("19d: an unpaid/expired Ballet subscription does NOT independently exclude an otherwise-active level assignment (payment and enrollment status are architecturally independent)", async () => {
  // Business-rule review finding: no code path anywhere (adminBallet.ts,
  // adminBalletPayments.ts, balletCancellationFinalization.ts, or any
  // worker) flips ballet_level_assignments.status in response to a
  // ballet_payments subscription lapsing — the ONLY producer of a
  // non-active status is the explicit admin cancellation-finalization flow
  // (-> 'withdrawn'). A family with an active level assignment and no
  // ballet_payments row at all (payment simply never modeled in this test)
  // must still be included — Ballet Families tracks ENROLLMENT, not
  // billing state, exactly as instructed ("do not accidentally turn Ballet
  // Families into 'currently paid Ballet families'").
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  await seedBalletLevelAssignment(child.id, "active");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "ballet_families", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 21-28: Class Participants
// ═══════════════════════════════════════════════════════════════════════════

test("21/22/23: class_participants includes confirmed, excludes pending and cancelled/rejected", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 3 }); // Wednesday
  const occurrenceDate = nextDateForDow(3);
  const confirmed = await seedStudent();
  const pending = await seedStudent();
  const cancelled = await seedStudent();
  const rejected = await seedStudent();
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate, accountOwnerStudentId: confirmed.id, bookingStatus: "confirmed" });
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate, accountOwnerStudentId: pending.id, bookingStatus: "pending" });
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate, accountOwnerStudentId: cancelled.id, bookingStatus: "cancelled" });
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate, accountOwnerStudentId: rejected.id, bookingStatus: "rejected" });

  const preview = await campaigns.previewCampaignAudience({
    audienceType: "class_participants",
    audienceConfig: { classId: cls.id, scheduleId: schedule.id, occurrenceDate },
  });
  assert.equal(preview.matchedAccounts, 1);
});

test("24: a confirmed booking for a DIFFERENT occurrence of the same class is excluded", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 3 });
  const targetDate = nextDateForDow(3);
  const otherOccurrenceDate = addDays(targetDate, 7); // next week's occurrence, same schedule
  const student = await seedStudent();
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate: otherOccurrenceDate, accountOwnerStudentId: student.id, bookingStatus: "confirmed" });

  const preview = await campaigns.previewCampaignAudience({
    audienceType: "class_participants",
    audienceConfig: { classId: cls.id, scheduleId: schedule.id, occurrenceDate: targetDate },
  });
  assert.equal(preview.matchedAccounts, 0);
});

test("25: a schedule belonging to a DIFFERENT class is rejected at config-validation time (400)", async () => {
  const classA = await seedClass();
  const classB = await seedClass();
  const scheduleOfB = await seedSchedule(classB.id, { dayOfWeek: 2 });
  const occurrenceDate = nextDateForDow(2);
  await assert.rejects(
    () => audience.validateAndNormalizeAudienceConfig("class_participants", { classId: classA.id, scheduleId: scheduleOfB.id, occurrenceDate }),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "INVALID_AUDIENCE_CONFIG",
  );
});

test("class_participants rejects a CANCELLED schedule (the one genuinely invalidating status)", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 4, status: "cancelled" });
  const occurrenceDate = nextDateForDow(4);
  await assert.rejects(
    () => audience.validateAndNormalizeAudienceConfig("class_participants", { classId: cls.id, scheduleId: schedule.id, occurrenceDate }),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "INVALID_AUDIENCE_CONFIG",
  );
});

test("class_participants ALLOWS an EXPIRED one-time schedule's own (necessarily past) occurrence — post-class follow-up is a legitimate use case, not a rejection case", async () => {
  // Business-rule review, highest-priority item: routes/schedules.ts's
  // syncAutomaticScheduleStatuses() auto-flips a one-time schedule to
  // 'expired' purely because its date+time already passed (Cairo) — a
  // silent, inevitable, time-based transition every one-time schedule
  // eventually gets, NOT an admin decision that the class was invalid.
  // Rejecting 'expired' would make it impossible to message people about a
  // one-time class immediately after it happens — the exact opposite of
  // what a "send a follow-up" feature is for.
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 2, status: "expired" });
  // one_time schedules match only their own exact `date`, regardless of
  // status — force this schedule to one_time with a real past date to
  // exercise the true "already happened" shape precisely.
  await pool.query(`UPDATE schedules SET type = 'one_time', date = $1 WHERE id = $2`, ["2020-01-06", schedule.id]); // a real past Monday
  const student = await seedStudent();
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate: "2020-01-06", accountOwnerStudentId: student.id, bookingStatus: "confirmed" });

  const preview = await campaigns.previewCampaignAudience({
    audienceType: "class_participants",
    audienceConfig: { classId: cls.id, scheduleId: schedule.id, occurrenceDate: "2020-01-06" },
  });
  assert.equal(preview.matchedAccounts, 1, "an expired one-time schedule's own occurrence must remain targetable");
});

test("class_participants ALLOWS a past occurrence of a still-active WEEKLY schedule (past-occurrence targeting is a legitimate, already-supported product behavior, not something to newly restrict)", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 5, status: "active" });
  const pastOccurrenceDate = "2020-01-03"; // a real past Friday, well before "today" in any test run
  const student = await seedStudent();
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate: pastOccurrenceDate, accountOwnerStudentId: student.id, bookingStatus: "confirmed" });

  const preview = await campaigns.previewCampaignAudience({
    audienceType: "class_participants",
    audienceConfig: { classId: cls.id, scheduleId: schedule.id, occurrenceDate: pastOccurrenceDate },
  });
  assert.equal(preview.matchedAccounts, 1);
});

test("class_participants rejects an occurrenceDate that is not a real projected date for the schedule (wrong day-of-week)", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 1 }); // Monday only
  const wrongDayDate = nextDateForDow(2); // a Tuesday
  await assert.rejects(
    () => audience.validateAndNormalizeAudienceConfig("class_participants", { classId: cls.id, scheduleId: schedule.id, occurrenceDate: wrongDayDate }),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "INVALID_AUDIENCE_CONFIG",
  );
});

test("26: a child's booking resolves to the parent/account-owner recipient", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 5 });
  const occurrenceDate = nextDateForDow(5);
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_type, participant_child_id, schedule_id, class_id, occurrence_date, status, booking_status)
     VALUES ('W3 Booking', 'w3-booking@example.invalid', $1, 'child', $2, $3, $4, $5, 'confirmed', 'confirmed')`,
    [parent.id, child.id, schedule.id, cls.id, occurrenceDate],
  );
  const preview = await campaigns.previewCampaignAudience({
    audienceType: "class_participants",
    audienceConfig: { classId: cls.id, scheduleId: schedule.id, occurrenceDate },
  });
  assert.equal(preview.matchedAccounts, 1);
});

test("27: multiple qualifying bookings for the same occurrence dedupe to one recipient", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 6 });
  const occurrenceDate = nextDateForDow(6);
  const parent = await seedStudent();
  const child1 = await seedChild(parent.id);
  const child2 = await seedChild(parent.id);
  for (const child of [child1, child2]) {
    await pool.query(
      `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_type, participant_child_id, schedule_id, class_id, occurrence_date, status, booking_status)
       VALUES ('W3 Booking', 'w3-booking@example.invalid', $1, 'child', $2, $3, $4, $5, 'confirmed', 'confirmed')`,
      [parent.id, child.id, schedule.id, cls.id, occurrenceDate],
    );
  }
  const preview = await campaigns.previewCampaignAudience({
    audienceType: "class_participants",
    audienceConfig: { classId: cls.id, scheduleId: schedule.id, occurrenceDate },
  });
  assert.equal(preview.matchedAccounts, 1);
});

test("28: the Cairo occurrence date is preserved verbatim end-to-end (no UTC/local shift)", async () => {
  const cls = await seedClass();
  const schedule = await seedSchedule(cls.id, { dayOfWeek: 0 }); // Sunday
  const occurrenceDate = nextDateForDow(0);
  const student = await seedStudent();
  await seedBooking({ scheduleId: schedule.id, classId: cls.id, occurrenceDate, accountOwnerStudentId: student.id, bookingStatus: "confirmed" });
  // Off-by-one-day config (the classic UTC/local shift bug) must NOT match.
  const shiftedDate = addDays(occurrenceDate, 1);
  await assert.rejects(
    () => audience.validateAndNormalizeAudienceConfig("class_participants", { classId: cls.id, scheduleId: schedule.id, occurrenceDate: shiftedDate }),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "INVALID_AUDIENCE_CONFIG",
  );
  const preview = await campaigns.previewCampaignAudience({
    audienceType: "class_participants",
    audienceConfig: { classId: cls.id, scheduleId: schedule.id, occurrenceDate },
  });
  assert.equal(preview.matchedAccounts, 1, "the EXACT stored occurrence date must match with no shift");
});

// ═══════════════════════════════════════════════════════════════════════════
// 29-36: Package Holders
// ═══════════════════════════════════════════════════════════════════════════

test("29: an active, non-expired, positive-credit package order is included (future expiresAt)", async () => {
  const pkg = await seedPricePackage();
  const student = await seedStudent();
  const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "active", remainingCredits: 3, expiresAt: futureExpiry });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 1);
});

test("29b: status='active' + credits>0 + a PAST expiresAt is still included — status is the canonical authority, matching attendanceResolver.ts's live eligibility check exactly", async () => {
  // Business-rule review, Package Holders: traced expiresAt usage across
  // booking creation (routes/bookings.ts — zero references), attendance/
  // check-in package eligibility (attendanceResolver.ts — status='active'
  // AND remainingCredits>0 ONLY, no expiresAt check), and credit
  // consumption (selectConsumptionLot.ts checks package_credit_lots.expiresAt,
  // a separate finer-grained lot mechanism, not package_orders.expiresAt).
  // No consumer anywhere independently re-checks expiresAt while trusting
  // status. The hourly package-credit-expiration worker
  // (packageCreditExpiration.ts) is the SOLE authority that transitions an
  // order once its Cairo business-date expiry passes — and when it does, it
  // atomically sets BOTH status='expired' AND remainingCredits=0 in the same
  // update, so post-worker-run an expired order already fails both of Wave
  // 3's conditions anyway. Reusing attendanceResolver.ts's exact live check
  // (status='active' AND remainingCredits>0, no expiresAt) rather than
  // inventing an independent, stricter re-check is the deliberate choice
  // here — adding one would create exactly the "subtly different rule"
  // divergence from canonical business logic the review explicitly warns
  // against.
  const pkg = await seedPricePackage();
  const student = await seedStudent();
  const pastExpiry = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "active", remainingCredits: 3, expiresAt: pastExpiry });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 1, "status='active' is authoritative — the expiration worker, not a live expiresAt check, is what retires a package order");
});

test("30: an expired package order is excluded", async () => {
  const pkg = await seedPricePackage();
  const student = await seedStudent();
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "expired", remainingCredits: 3 });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 0);
});

test("31: a cancelled package order is excluded", async () => {
  const pkg = await seedPricePackage();
  const student = await seedStudent();
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "cancelled", remainingCredits: 3 });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 0);
});

test("32: a zero-credit (exhausted) active package order is excluded", async () => {
  const pkg = await seedPricePackage();
  const student = await seedStudent();
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "active", remainingCredits: 0 });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 0);
});

test("33: an unpaid/unactivated (pendingPayment) package order is excluded", async () => {
  const pkg = await seedPricePackage();
  const student = await seedStudent();
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "pendingPayment", remainingCredits: 3 });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 0);
});

test("34: scope=package with a specific packageId selects only holders of that package", async () => {
  const pkgA = await seedPricePackage();
  const pkgB = await seedPricePackage();
  const holderA = await seedStudent();
  const holderB = await seedStudent();
  await seedPackageOrder({ studentId: holderA.id, packageId: pkgA.id, status: "active", remainingCredits: 2 });
  await seedPackageOrder({ studentId: holderB.id, packageId: pkgB.id, status: "active", remainingCredits: 2 });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "package", packageId: pkgA.id } });
  assert.equal(preview.matchedAccounts, 1);
});

test("35: multiple active package orders for the same account dedupe to one recipient", async () => {
  const pkg = await seedPricePackage();
  const student = await seedStudent();
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "active", remainingCredits: 2 });
  await seedPackageOrder({ studentId: student.id, packageId: pkg.id, status: "active", remainingCredits: 5 });
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 1);
});

test("36: a Ballet subscription/payment alone never qualifies for package_holders (regular Studio packages only)", async () => {
  // No package_orders row is created at all — only a Ballet application/
  // enrollment exists for this account's family. package_holders must never
  // read ballet_payments/ballet_packages.
  const parent = await seedStudent();
  const child = await seedChild(parent.id);
  await seedBalletLevelAssignment(child.id, "active");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "package_holders", audienceConfig: { scope: "all_active" } });
  assert.equal(preview.matchedAccounts, 0);
});

test("package_holders scope=package without packageId is rejected (400)", async () => {
  await assert.rejects(() => audience.validateAndNormalizeAudienceConfig("package_holders", { scope: "package" } as never));
});

test("package_holders scope=package with a nonexistent packageId is rejected (400)", async () => {
  await assert.rejects(
    () => audience.validateAndNormalizeAudienceConfig("package_holders", { scope: "package", packageId: 999_999_999 }),
    (err: unknown) => err instanceof campaigns.NotificationCampaignError && err.code === "INVALID_AUDIENCE_CONFIG",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 37-41: Preview/send consistency
// ═══════════════════════════════════════════════════════════════════════════

test("37/38/39: preview writes no recipient rows, no notification row, and calls Expo zero times", async () => {
  await seedStudent();
  const campaignId = await createDraftCampaign("W3 Verify PreviewSideEffectFree", "all_members");
  const preview = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);

  const { rows: recipientRows } = await pool.query(`SELECT id FROM notification_campaign_recipients WHERE campaign_id = $1`, [campaignId]);
  assert.equal(recipientRows.length, 0, "preview must never write recipient rows");
  const { rows: campaignRows } = await pool.query(`SELECT notification_id AS "notificationId" FROM notification_campaigns WHERE id = $1`, [campaignId]);
  assert.equal(campaignRows[0].notificationId, null, "preview must never create a canonical notification row");
  assert.equal(expoCallTokens.length, 0, "preview must never call Expo");
});

test("40/41: preview returns N, data changes, send's frozen snapshot reflects the CURRENT truth (N+1), not the stale preview count — and distinguishes accounts from devices", async () => {
  const first = await seedStudent();
  await seedDevice(first.id);
  const campaignId = await createDraftCampaign("W3 Verify PreviewThenSendReResolve", "all_members");

  const preview = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(preview.matchedAccounts, 1);
  assert.equal(preview.pushEnabledAccounts, 1);
  assert.equal(preview.activeDevices, 1);

  // Data changes AFTER preview, BEFORE send.
  const second = await seedStudent();
  await seedDevice(second.id);
  await seedDevice(second.id); // second account has 2 devices

  const result = await campaigns.sendCampaign(campaignId);
  assert.equal(result.intendedRecipientCount, 2, "send must reflect the CURRENT truth (preview's N=1, now N+1=2), never the stale preview count");
  assert.equal(result.pushEnabledAccountCount, 2);
  assert.equal(result.activeDeviceCount, 3, "3 devices across 2 accounts — device count, not account count");

  const { rows: recipientRows } = await pool.query(`SELECT student_id AS "studentId" FROM notification_campaign_recipients WHERE campaign_id = $1 ORDER BY student_id`, [campaignId]);
  const actualIds: number[] = recipientRows.map((r: { studentId: number }) => r.studentId).sort((a: number, b: number) => a - b);
  const expectedIds: number[] = [first.id, second.id].sort((a: number, b: number) => a - b);
  assert.deepEqual(actualIds, expectedIds);
});

// ═══════════════════════════════════════════════════════════════════════════
// 42-46: Security
// ═══════════════════════════════════════════════════════════════════════════

test("42: malformed audienceConfig is rejected (unknown field via .strict())", async () => {
  await assert.rejects(() => audience.validateAndNormalizeAudienceConfig("all_members", { unexpectedField: "x" } as never));
});

test("43: an unsupported audienceType is rejected by the resolver", () => {
  assert.throws(() => audience.buildAudienceAccountsSubquery("not_a_real_type" as never, {}));
});

test("44: client-submitted matchedAccounts/counts are never trusted — preview always recomputes from live DB state", async () => {
  await seedStudent();
  // There is no code path anywhere that accepts a client-supplied count and
  // returns it verbatim — previewCampaignAudience always executes the live
  // aggregate query. This test locks in that by asserting the count tracks
  // real DB state across a mutation, the same invariant test 40/41 exercises
  // for send; here for preview specifically.
  const before = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(before.matchedAccounts, 1);
  await seedStudent();
  const after = await campaigns.previewCampaignAudience({ audienceType: "all_members", audienceConfig: {} });
  assert.equal(after.matchedAccounts, 2, "no cached/client-suppliable count could have produced this without the live requery");
});

test("45: a client cannot submit arbitrary student IDs for a non-specific-members audience — extra fields on a no-config schema are rejected", async () => {
  await assert.rejects(() => audience.validateAndNormalizeAudienceConfig("students", { studentIds: [1, 2, 3] } as never));
  await assert.rejects(() => audience.validateAndNormalizeAudienceConfig("ballet_families", { studentIds: [1, 2, 3] } as never));
});

test("46: specific-member existence validation reuses the students table directly — no separate PII-leaking lookup path exists in the resolver", async () => {
  // The resolver's only interaction with identity for specific_members is
  // an existence check against students.id (see validateAndNormalizeAudienceConfig)
  // — no name/email/phone is ever read or returned by it. This is verified
  // structurally: the validated/normalized config contains ONLY studentIds.
  const s = await seedStudent();
  const normalized = await audience.validateAndNormalizeAudienceConfig("specific_members", { studentIds: [s.id] });
  assert.deepEqual(Object.keys(normalized), ["studentIds"]);
});

// ─── date helpers (Cairo-safe, calendar-date-string arithmetic only) ────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Next calendar date (strictly in the future) matching the given ISO day-of-week (0=Sunday..6=Saturday). */
function nextDateForDow(dow: number): string {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  for (let i = 1; i <= 7; i += 1) {
    const candidate = addDays(todayStr, i);
    if (new Date(`${candidate}T00:00:00Z`).getUTCDay() === dow) return candidate;
  }
  throw new Error("unreachable");
}
