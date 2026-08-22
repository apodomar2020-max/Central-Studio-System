/**
 * Real route + database IDOR/ownership integration tests for
 * GET /ballet/classes/my (the authenticated "My Ballet Classes" endpoint).
 *
 * Boots the ACTUAL Express router (routes/ballet.ts) behind the ACTUAL auth
 * middlewares (requireAuth, requireStudentAuth, requireVerifiedStudent — all
 * unmodified imports from real source), issues real HTTP requests, and
 * asserts on real row state in a disposable local Postgres database. No
 * ownership/entitlement logic is mocked.
 *
 * Safety gate: refuses to run unless DATABASE_URL points at 127.0.0.1/localhost
 * and a database name containing disposable/local/test — same rule as
 * lib/db/tools/verification/run-disposable-migrations.mjs and the sibling
 * balletCancellationRouteIntegration.test.ts. Must already be migrated
 * through the latest migration before running this file.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_OWNERSHIP_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5611/central_studio_disposable_ownership";

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
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const STUDENT_JWT_SECRET = "dev-student-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: import("pg").Pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

function studentToken(studentId: number, email: string, emailVerified = true): string {
  return jwtSign({ sub: studentId, email, type: "student", emailVerified }, STUDENT_JWT_SECRET);
}

async function getMyClasses(token: string | null, path = "/ballet/classes/my"): Promise<{ status: number; body: unknown; raw: string }> {
  const res = await fetch(apiUrl(path), {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const raw = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* leave null for non-JSON bodies */ }
  return { status: res.status, body, raw };
}

const TODAY = new Date().toISOString().slice(0, 10);
function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Fixture accounts, built once in before() ────────────────────────────────

interface Account {
  parentId: number;
  email: string;
  childId: number;
  childName: string;
  applicationId: number;
  assignmentId: number;
  levelId: number;
  groupId: number;
  classId: number;
  scheduleId: number;
}
let accountA: Account;
let accountB: Account;
/** An assignment belonging to Account B's application but whose child_id is
 * hostilely set to Account A's child — proves ownership is not derived from
 * this column. */
let hostileAssignmentId: number;
let childlessApplicationId: number;
let unrelatedOwnedChildId: number;

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const balletRouter = (await import("../routes/ballet.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(balletRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows: levelRows } = await pool.query(`SELECT id FROM ballet_levels ORDER BY id LIMIT 1`);
  const sharedLevelId: number = levelRows[0].id;
  const sharedChildName = "Amira Hassan"; // deliberately identical across both accounts
  const sharedBirthday = "2018-05-01"; // deliberately identical across both accounts

  async function buildAccount(label: "a" | "b"): Promise<Account> {
    const student = await pool.query(
      `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, $3, 'parent') RETURNING id`,
      [`Ownership Test Parent ${label}`, `ownership-test-${label}-${run}@example.com`, `010000000${label === "a" ? 1 : 2}`],
    );
    const parentId: number = student.rows[0].id;

    const child = await pool.query(
      `INSERT INTO children (parent_id, full_name, birthday) VALUES ($1, $2, $3) RETURNING id`,
      [parentId, sharedChildName, sharedBirthday],
    );
    const childId: number = child.rows[0].id;

    const applicationInsert = await pool.query(
      `INSERT INTO ballet_applications
         (parent_student_id, parent_name, parent_phone, parent_email, child_name, child_birthday, child_id, status, assigned_level_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8) RETURNING id`,
      [parentId, `Ownership Test Parent ${label}`, `010000000${label === "a" ? 1 : 2}`, `ownership-test-${label}-${run}@example.com`, sharedChildName, sharedBirthday, childId, sharedLevelId],
    );
    const applicationId: number = applicationInsert.rows[0].id;

    const group = await pool.query(
      `INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`,
      [`Ownership Test Group ${label} ${run}`, sharedLevelId],
    );
    const groupId: number = group.rows[0].id;

    const assignmentInsert = await pool.query(
      `INSERT INTO ballet_level_assignments (application_id, child_id, level_id, group_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [applicationId, childId, sharedLevelId, groupId],
    );
    const assignmentId: number = assignmentInsert.rows[0].id;

    const instructor = await pool.query(
      `INSERT INTO ballet_instructors (name, is_active) VALUES ($1, true) RETURNING id`,
      [`Ownership Test Instructor ${label} ${run}`],
    );
    const classInsert = await pool.query(
      `INSERT INTO ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active)
       VALUES ($1, false, $2, $3, $4, true) RETURNING id`,
      [`Ownership Test Class ${label} ${run}`, sharedLevelId, groupId, instructor.rows[0].id],
    );
    const classId: number = classInsert.rows[0].id;

    const scheduleInsert = await pool.query(
      `INSERT INTO ballet_schedules (class_id, day_of_week, start_time, end_time, duration_mins, status)
       VALUES ($1, 1, '16:00', '17:00', 60, 'active') RETURNING id`,
      [classId],
    );
    const scheduleId: number = scheduleInsert.rows[0].id;

    // Active current-cycle payment so the account clears the payment_pending
    // gate and reaches entitlementState "active".
    await pool.query(
      `INSERT INTO ballet_payments (application_id, level_assignment_id, amount_egp, status, payment_method, paid_at, subscription_start_date, subscription_expires_at)
       VALUES ($1, $2, 1000, 'paid', 'inPerson', now(), $3, $4)`,
      [applicationId, assignmentId, addDays(TODAY, -10), addDays(TODAY, 20)],
    );

    return { parentId, email: `ownership-test-${label}-${run}@example.com`, childId, childName: sharedChildName, applicationId, assignmentId, levelId: sharedLevelId, groupId, classId, scheduleId };
  }

  accountA = await buildAccount("a");
  accountB = await buildAccount("b");

  const unrelatedOwnedChild = await pool.query(
    `INSERT INTO children (parent_id, full_name, birthday) VALUES ($1, 'General Account Child', '2019-06-01') RETURNING id`,
    [accountA.parentId],
  );
  unrelatedOwnedChildId = unrelatedOwnedChild.rows[0].id;

  const childlessApplication = await pool.query(
    `INSERT INTO ballet_applications
       (parent_student_id, parent_name, parent_phone, parent_email, child_name, child_birthday, child_id, status)
     VALUES ($1, 'Ownership Test Parent a', '0100000001', $2, $3, '2018-05-01', NULL, 'pending') RETURNING id`,
    [accountA.parentId, accountA.email, accountA.childName],
  );
  childlessApplicationId = childlessApplication.rows[0].id;

  // Hostile fixture: an assignment tied to Account B's application but whose
  // child_id points at Account A's child. If ownership were derived from
  // child_id rather than the applicationId -> parentStudentId chain, this
  // row could leak Group B/Class B into Account A's response.
  const hostile = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, child_id, level_id, group_id, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [accountB.applicationId, accountA.childId, accountB.levelId, accountB.groupId],
  );
  hostileAssignmentId = hostile.rows[0].id;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── Authentication ───────────────────────────────────────────────────────────

test("unauthenticated request is rejected with 401", async () => {
  const { status, body } = await getMyClasses(null);
  assert.equal(status, 401);
  assert.ok(body && typeof body === "object");
});

test("a non-JWT-shaped garbage token is rejected (treated as an invalid API key, not a downgrade to anonymous access)", async () => {
  const { status } = await getMyClasses("this-is-not-a-valid-jwt");
  assert.equal(status, 403);
});

test("a JWT-shaped token with a tampered payload is rejected with 401", async () => {
  const valid = studentToken(accountA.parentId, accountA.email);
  const tampered = valid.slice(0, -4) + "abcd"; // corrupt the signature segment
  const { status } = await getMyClasses(tampered);
  assert.equal(status, 401);
});

test("a non-student JWT (wrong type claim) is rejected with 401", async () => {
  const adminShaped = jwtSign({ sub: accountA.parentId, email: accountA.email, type: "admin", emailVerified: true }, STUDENT_JWT_SECRET);
  const { status } = await getMyClasses(adminShaped);
  assert.equal(status, 401);
});

test("JWT signed with the wrong secret is rejected with 401", async () => {
  const forged = jwtSign({ sub: accountA.parentId, email: accountA.email, type: "student", emailVerified: true }, "wrong-secret-entirely");
  const { status } = await getMyClasses(forged);
  assert.equal(status, 401);
});

// ─── Core ownership boundary ──────────────────────────────────────────────────

/** All child/application/class/schedule ids that appear anywhere in a
 * /classes/my response body, collected field-by-field (not a raw-text scan —
 * this repo's disposable DB assigns small sequential ids across every table,
 * so a different account's id can coincidentally equal an unrelated field's
 * value; only checking the actual identifying fields avoids false positives). */
function collectIds(body: any): { childIds: number[]; applicationIds: number[]; classIds: number[]; scheduleIds: number[] } {
  const childIds: number[] = [];
  const applicationIds: number[] = [];
  const classIds: number[] = [];
  const scheduleIds: number[] = [];
  for (const child of body.children ?? []) {
    if (child.childId != null) childIds.push(child.childId);
    if (child.applicationId != null) applicationIds.push(child.applicationId);
    for (const klass of child.classes ?? []) {
      classIds.push(klass.id);
      for (const schedule of klass.schedules ?? []) scheduleIds.push(schedule.id);
    }
  }
  return { childIds, applicationIds, classIds, scheduleIds };
}

test("Account A token resolves only Account A's data", async () => {
  const { status, body } = await getMyClasses(studentToken(accountA.parentId, accountA.email));
  assert.equal(status, 200);
  const children = (body as any).children as any[];
  assert.equal(children.length, 1, "Account A must see exactly one child");
  const me = children[0];
  assert.equal(me.childId, accountA.childId);
  assert.equal(me.applicationId, accountA.applicationId);
  assert.equal(me.entitlementState, "active");
  assert.equal(me.classes.length, 1);
  assert.equal(me.classes[0].id, accountA.classId);
  assert.equal(me.classes[0].schedules.length, 1);
  assert.equal(me.classes[0].schedules[0].id, accountA.scheduleId);

  const ids = collectIds(body);
  assert.ok(!ids.childIds.includes(accountB.childId), "Account A response must not contain Child B");
  assert.ok(!ids.applicationIds.includes(accountB.applicationId), "Account A response must not contain Application B");
  assert.ok(!ids.classIds.includes(accountB.classId), "Account A response must not contain Class B");
  assert.ok(!ids.scheduleIds.includes(accountB.scheduleId), "Account A response must not contain Schedule B");
});

test("childId-less applications never become selector entries", async () => {
  const { status, body } = await getMyClasses(studentToken(accountA.parentId, accountA.email));
  assert.equal(status, 200);
  const children = (body as any).children as any[];
  assert.deepEqual(children.map((child) => child.selectorKey), [`child:${accountA.childId}`]);
  assert.equal(children.some((child) => child.applicationId === childlessApplicationId), false);
});

test("owned general-account children without Ballet applications are not returned", async () => {
  const { status, body } = await getMyClasses(studentToken(accountA.parentId, accountA.email));
  assert.equal(status, 200);
  const children = (body as any).children as any[];
  assert.equal(children.some((child) => child.childId === unrelatedOwnedChildId), false);
  assert.deepEqual(children.map((child) => child.selectorKey), [`child:${accountA.childId}`]);
});

test("Account B token resolves only Account B's data", async () => {
  const { status, body } = await getMyClasses(studentToken(accountB.parentId, accountB.email));
  assert.equal(status, 200);
  const children = (body as any).children as any[];
  assert.equal(children.length, 1, "Account B must see exactly one child");
  const me = children[0];
  assert.equal(me.childId, accountB.childId);
  assert.equal(me.applicationId, accountB.applicationId);
  assert.equal(me.entitlementState, "active");
  // Exactly one class/schedule — the hostile assignment (child_id pointed at
  // Child A) must NOT grant Account B a second/duplicated entitlement, and
  // must not have been silently used in place of the real assignment.
  assert.equal(me.classes.length, 1);
  assert.equal(me.classes[0].id, accountB.classId);
  assert.equal(me.classes[0].schedules.length, 1);
  assert.equal(me.classes[0].schedules[0].id, accountB.scheduleId);

  const ids = collectIds(body);
  assert.ok(!ids.childIds.includes(accountA.childId), "Account B response must not contain Child A");
  assert.ok(!ids.applicationIds.includes(accountA.applicationId), "Account B response must not contain Application A");
  assert.ok(!ids.classIds.includes(accountA.classId), "Account B response must not contain Class A");
  assert.ok(!ids.scheduleIds.includes(accountA.scheduleId), "Account B response must not contain Schedule A");
});

// ─── Foreign-ID injection ──────────────────────────────────────────────────────

test("foreign childId/applicationId/parentId/accountId/studentId query params are ignored", async () => {
  const token = studentToken(accountA.parentId, accountA.email);
  const maliciousPath = `/ballet/classes/my?childId=${accountB.childId}&applicationId=${accountB.applicationId}&parentId=${accountB.parentId}&accountId=${accountB.parentId}&studentId=${accountB.parentId}`;
  const { status, body: maliciousBody } = await getMyClasses(token, maliciousPath);
  const { body: plainBody } = await getMyClasses(token);
  assert.equal(status, 200);
  assert.deepEqual(maliciousBody, plainBody, "response must be byte-identical with or without foreign-ID query params");
  const children = (maliciousBody as any).children as any[];
  assert.equal(children.length, 1);
  assert.equal(children[0].childId, accountA.childId);
});

// ─── Same display name / same birthday across accounts ────────────────────────

test("same display name and birthday across two accounts does not cause leakage", async () => {
  assert.equal(accountA.childName, accountB.childName, "fixture sanity: names must be identical");
  const [resA, resB] = await Promise.all([
    getMyClasses(studentToken(accountA.parentId, accountA.email)),
    getMyClasses(studentToken(accountB.parentId, accountB.email)),
  ]);
  const childA = (resA.body as any).children[0];
  const childB = (resB.body as any).children[0];
  assert.equal(childA.childName, childB.childName); // same name, confirmed
  assert.notEqual(childA.childId, childB.childId); // but genuinely different children
  assert.notEqual(childA.applicationId, childB.applicationId);
  assert.equal(childA.classes[0].id, accountA.classId);
  assert.equal(childB.classes[0].id, accountB.classId);
  assert.notEqual(childA.classes[0].id, childB.classes[0].id);
});

// ─── Same Level, different Group isolation ─────────────────────────────────────

test("same Level with different Groups does not leak across accounts", async () => {
  assert.equal(accountA.levelId, accountB.levelId, "fixture sanity: both accounts share one Level");
  assert.notEqual(accountA.groupId, accountB.groupId);
  const [resA, resB] = await Promise.all([
    getMyClasses(studentToken(accountA.parentId, accountA.email)),
    getMyClasses(studentToken(accountB.parentId, accountB.email)),
  ]);
  const classesA = (resA.body as any).children[0].classes.map((c: any) => c.id);
  const classesB = (resB.body as any).children[0].classes.map((c: any) => c.id);
  assert.deepEqual(classesA, [accountA.classId]);
  assert.deepEqual(classesB, [accountB.classId]);
});

// ─── Sensitive-field exposure ───────────────────────────────────────────────────

const FORBIDDEN_SUBSTRINGS = [
  "medicalNotes", "medical_notes", "emergencyName", "emergency_name", "emergencyPhone", "emergency_phone",
  "qrToken", "qr_token", "passwordHash", "password_hash",
  "parentEmail", "parent_email", "parentPhone", "parent_phone",
  "amountEgp", "amount_egp", "paymentMethod", "payment_method", "refund", "subscriptionExpiresAt", "subscription_expires_at",
  "otp", "sessionToken", "session_token",
];

test("response never includes medical, admin-note, payment, refund, or credential fields", async () => {
  const { raw } = await getMyClasses(studentToken(accountA.parentId, accountA.email));
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!raw.toLowerCase().includes(needle.toLowerCase()), `response leaked forbidden field/substring "${needle}"`);
  }
});
