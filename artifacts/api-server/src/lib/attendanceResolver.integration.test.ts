/**
 * Real-database integration tests for the unified Attendance resolver —
 * account isolation, QR payload validation, phone normalization, and
 * child-name collision handling. These map directly to the task's stop
 * conditions: "foreign children/accounts appear in resolver output" and
 * "a scan silently selects the first child" must never be true.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ATTENDANCE_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5612/central_studio_disposable_attendance";

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

let pool: import("pg").Pool;
let resolveAccountIdsFromQr: typeof import("./attendanceResolver.ts").resolveAccountIdsFromQr;
let resolveAccountIdsFromPhone: typeof import("./attendanceResolver.ts").resolveAccountIdsFromPhone;
let resolveAccountIdsFromChildName: typeof import("./attendanceResolver.ts").resolveAccountIdsFromChildName;
let resolveAttendanceCandidates: typeof import("./attendanceResolver.ts").resolveAttendanceCandidates;
let computeBalletCandidateKey: typeof import("./attendanceResolver.ts").computeBalletCandidateKey;
let cairoDateTimeToUtcMs: typeof import("./occurrence.ts").cairoDateTimeToUtcMs;

interface AccountFixture {
  studentId: number;
  qrToken: string;
  phone: string;
  email: string;
}

// A run-unique 9-digit suffix so repeated executions of this file against
// the same persistent disposable DB (no cleanup between runs) never
// accumulate colliding phone numbers across runs — the exact bug that
// first surfaced here when combined with other test files in one process.
function uniquePhone(seed: number): string {
  // "010" + 8 digits = 11 digits total, matching normalizePhone's
  // 01-prefix/11-digit Egyptian-local-format branch exactly. Canonical
  // Account Phone Domain (migration 0125) additionally requires the
  // operator digit right after "01" to be one of 0/1/2/5 — fixed to "0"
  // here so every generated fixture always satisfies
  // students_phone_canonical_check, regardless of the random seed/time.
  const suffix = String(Date.now() % 100_000).padStart(6, "0") + String(seed).padStart(2, "0");
  return `010${suffix}`;
}

async function insertAccount(label: string, phone: string): Promise<AccountFixture> {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Canonical Account Phone Domain (migration 0125): students.phone must
  // already be canonical "20XXXXXXXXXX" at rest (DB CHECK constraint) — a
  // real write path would normalize before persisting, so this fixture
  // does the same. `phone` (the local "01..." form) is still returned and
  // used below to derive the local/+20/0020 SEARCH QUERY variants the
  // tests exercise; only the stored value changes.
  const canonicalPhone = `20${phone.slice(1)}`;
  const row = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, $3, 'parent') RETURNING id, qr_token`,
    [`Resolver Test ${label}`, `resolver-${label}-${run}@example.com`, canonicalPhone],
  );
  return { studentId: row.rows[0].id, qrToken: row.rows[0].qr_token, phone, email: `resolver-${label}-${run}@example.com` };
}

let accountA: AccountFixture;
let accountB: AccountFixture;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const mod = await import("./attendanceResolver.ts");
  resolveAccountIdsFromQr = mod.resolveAccountIdsFromQr;
  resolveAccountIdsFromPhone = mod.resolveAccountIdsFromPhone;
  resolveAccountIdsFromChildName = mod.resolveAccountIdsFromChildName;
  resolveAttendanceCandidates = mod.resolveAttendanceCandidates;
  computeBalletCandidateKey = mod.computeBalletCandidateKey;
  cairoDateTimeToUtcMs = (await import("./occurrence.ts")).cairoDateTimeToUtcMs;

  accountA = await insertAccount("a", uniquePhone(1));
  accountB = await insertAccount("b", uniquePhone(2));

  // Same displayed child name across two different accounts — ownership must
  // still be derived from the resolved account, never merged or confused.
  await pool.query(`INSERT INTO children (parent_id, full_name, birthday) VALUES ($1, 'Shared Name Child', '2018-01-01')`, [accountA.studentId]);
  await pool.query(`INSERT INTO children (parent_id, full_name, birthday) VALUES ($1, 'Shared Name Child', '2018-01-01')`, [accountB.studentId]);
});

after(async () => {
  await pool.end();
});

test("valid full-screen QR payload resolves exactly the owning account", async () => {
  const ids = await resolveAccountIdsFromQr(JSON.stringify({ app: "centralstudio", token: accountA.qrToken }));
  assert.deepEqual(ids, [accountA.studentId]);
});

test("a foreign/unknown QR token resolves to no account", async () => {
  const ids = await resolveAccountIdsFromQr(JSON.stringify({ app: "centralstudio", token: "00000000-0000-0000-0000-000000000000" }));
  assert.deepEqual(ids, []);
});

test("malformed (non-JSON, non-UUID) QR payload resolves to no account", async () => {
  const ids = await resolveAccountIdsFromQr("not-a-qr-payload-at-all");
  assert.deepEqual(ids, []);
});

test("a raw sequential account id is never accepted as a QR payload", async () => {
  // Simulates the exact vulnerability the task calls out: the Profile-tab
  // preview card historically encoded user.id (a small integer) instead of
  // the opaque qrToken. The full-screen resolver must never resolve this.
  const ids = await resolveAccountIdsFromQr(String(accountA.studentId));
  assert.deepEqual(ids, [], "a bare integer string must never resolve to an account");

  const idsJson = await resolveAccountIdsFromQr(JSON.stringify({ app: "centralstudio", token: accountA.studentId }));
  assert.deepEqual(idsJson, [], "a numeric token field (not a UUID string) must never resolve to an account");
});

test("wrong app tag in an otherwise well-formed payload is rejected", async () => {
  const ids = await resolveAccountIdsFromQr(JSON.stringify({ app: "some-other-app", token: accountA.qrToken }));
  assert.deepEqual(ids, []);
});

test("normalized Egyptian phone matches regardless of input format (local vs +20 vs 00 prefix)", async () => {
  // accountA.phone is "01" + 9 digits (uniquePhone()); derive the
  // equivalent international representations from it directly rather than
  // hardcoding a literal, since the local literal is now run-unique.
  const local = await resolveAccountIdsFromPhone(accountA.phone);
  const intlPlus = await resolveAccountIdsFromPhone(`+20${accountA.phone.slice(1)}`);
  const intlZeros = await resolveAccountIdsFromPhone(`0020${accountA.phone.slice(1)}`);
  assert.deepEqual(local, [accountA.studentId]);
  assert.deepEqual(intlPlus, [accountA.studentId]);
  assert.deepEqual(intlZeros, [accountA.studentId]);
});

test("an unknown phone number resolves to a safe empty result, not an error", async () => {
  const ids = await resolveAccountIdsFromPhone("019999999999999");
  assert.deepEqual(ids, []);
});

test("phone search for account A never returns account B's id", async () => {
  const ids = await resolveAccountIdsFromPhone(accountA.phone);
  assert.ok(!ids.includes(accountB.studentId));
});

test("child-name search below the minimum length returns nothing (no broad enumeration)", async () => {
  const ids = await resolveAccountIdsFromChildName("S");
  assert.deepEqual(ids, []);
});

test("same child display name across two different accounts resolves BOTH accounts, kept separate, never merged", async () => {
  const ids = await resolveAccountIdsFromChildName("Shared Name Child");
  assert.ok(ids.includes(accountA.studentId));
  assert.ok(ids.includes(accountB.studentId));
  assert.equal(new Set(ids).size, ids.length, "no duplicate account ids");
});

test("full resolveAttendanceCandidates response never leaks another account's data and never auto-selects", async () => {
  const result = await resolveAttendanceCandidates("phone", accountA.phone);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].accountId, accountA.studentId);
  // The resolver itself performs no selection/write — it only returns
  // candidates; every candidate (if any) still carries eligibility metadata
  // rather than an implicit "go ahead" signal.
  for (const account of result.accounts) {
    assert.notEqual(account.accountId, accountB.studentId);
  }
});

test("resolver response never exposes the qrToken field on any account", async () => {
  const result = await resolveAttendanceCandidates("phone", accountA.phone);
  const raw = JSON.stringify(result);
  assert.ok(!raw.includes(accountA.qrToken), "resolver response must never echo back the account's qrToken");
});

test("resolver response masks phone numbers, never returning the full digits", async () => {
  const result = await resolveAttendanceCandidates("phone", accountA.phone);
  const account = result.accounts.find((a) => a.accountId === accountA.studentId);
  assert.ok(account);
  assert.notEqual(account!.maskedPhone, accountA.phone);
  assert.ok(account!.maskedPhone?.includes("•"), "masked phone should contain a masking character");
});

test("cross-midnight Ballet resolver emits Tuesday's real occurrence and candidateKey when its window opens Monday", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const level = await pool.query(
    `INSERT INTO ballet_levels (name, sort_order, is_active) VALUES ($1, 991, true) RETURNING id`,
    [`Resolver Midnight Level ${run}`],
  );
  const group = await pool.query(
    `INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`,
    [`Resolver Midnight Group ${run}`, level.rows[0].id],
  );
  const instructor = await pool.query(
    `INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`,
    [`Resolver Midnight Instructor ${run}`],
  );
  const balletClass = await pool.query(
    `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active)
     VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
    [`Resolver Midnight Class ${run}`, level.rows[0].id, group.rows[0].id, instructor.rows[0].id],
  );
  const schedule = await pool.query(
    `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status)
     VALUES ($1, 2, '01:00', '02:00', 60, 'active') RETURNING id`,
    [balletClass.rows[0].id],
  );
  const application = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status, assigned_level_id)
     VALUES ($1, 'Resolver Parent', $2, $3, 'Resolver Midnight Child', 'active', $4) RETURNING id`,
    [accountA.studentId, accountA.phone, accountA.email, level.rows[0].id],
  );
  const assignment = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, group_id, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [application.rows[0].id, level.rows[0].id, group.rows[0].id],
  );
  const pkg = await pool.query(
    `INSERT INTO ballet_packages (name, monthly_classes, monthly_hours, price_egp, is_active)
     VALUES ($1, 8, 12, 2500, true) RETURNING id`,
    [`Resolver Midnight Package ${run}`],
  );
  await pool.query(
    `INSERT INTO ballet_payments (application_id, package_id, amount_egp, status, payment_method, paid_at, subscription_start_date, subscription_expires_at)
     VALUES ($1, $2, 2500, 'paid', 'inPerson', now(), '2026-07-01', '2026-08-31')`,
    [application.rows[0].id, pkg.rows[0].id],
  );

  const monday = "2026-07-27";
  const tuesday = "2026-07-28";
  const beforeOpen = await resolveAttendanceCandidates("phone", accountA.phone, new Date(cairoDateTimeToUtcMs(monday, "22:59")));
  assert.equal(beforeOpen.accounts.flatMap((account) => account.candidates).some((candidate) => candidate.scheduleId === schedule.rows[0].id), false);

  const atOpen = await resolveAttendanceCandidates("phone", accountA.phone, new Date(cairoDateTimeToUtcMs(monday, "23:00")));
  const candidate = atOpen.accounts.flatMap((account) => account.candidates).find((row) => row.scheduleId === schedule.rows[0].id);
  assert.ok(candidate);
  assert.equal(candidate!.occurrenceDate, tuesday);
  assert.equal(candidate!.eligibility, "eligible");
  assert.equal(
    candidate!.candidateKey,
    computeBalletCandidateKey(accountA.studentId, application.rows[0].id, assignment.rows[0].id, schedule.rows[0].id, tuesday),
  );
  assert.notEqual(
    candidate!.candidateKey,
    computeBalletCandidateKey(accountA.studentId, application.rows[0].id, assignment.rows[0].id, schedule.rows[0].id, monday),
  );
});
