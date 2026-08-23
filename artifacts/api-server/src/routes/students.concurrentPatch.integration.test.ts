/**
 * B3B0-1A Verification Closure — Section I / requirement 32: real
 * concurrent PATCH /students/:id requests against the SAME student,
 * genuinely raced via Promise.all against a real running Express app +
 * real disposable Postgres, exercising the actual FOR UPDATE lock in
 * applyStudentEmailChange (studentEmailChangeService.ts).
 *
 * Route code (read directly, see studentEmailChangeService.ts) does NOT
 * perform optimistic-concurrency checking on the client-supplied "old"
 * email — it re-reads students.email fresh under FOR UPDATE. So the
 * expected REAL behavior: whichever request's transaction acquires the
 * lock first commits its change (A->B or A->C); the second transaction,
 * once unblocked, re-reads the (now already-changed) email under its own
 * lock and unconditionally applies its own target email on top — i.e. BOTH
 * requests succeed (no 409/conflict), and the student's final email is
 * whichever request's transaction committed LAST in the serialization
 * order chosen by Postgres row-lock ordering (not deterministically
 * predictable from application code, so this test asserts on the general
 * invariants below rather than which specific email wins).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_EMAIL_PROVENANCE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_email_provenance";

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
process.env.API_SECRET_KEY = "test-api-secret-key";
process.env.STUDENT_JWT_SECRET = "test-student-secret";
process.env.ADMIN_JWT_SECRET = "test-admin-secret";
process.env.OTP_PEPPER = "test-provenance-otp-pepper".padEnd(64, "0");
process.env.IDENTITY_PROVENANCE_PEPPER = "test-identity-provenance-pepper".padEnd(64, "0");
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

async function patch(path: string, body: unknown, adminToken: string) {
  const res = await fetch(apiUrl(path), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.API_SECRET_KEY}`,
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function post(path: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.API_SECRET_KEY}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const authRouter = (await import("./auth")).default;
  const studentsRouter = (await import("./students")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", authRouter);
  app.use("/api", studentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

let jwtSign: typeof import("jsonwebtoken").sign;
let adminSeq = 0;
async function makeAdminWithPermission(perm: Record<string, unknown>): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`cc-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, false, true, $5) RETURNING id`,
    [`cc-admin-${Date.now()}-${adminSeq}`, `cc-admin-${Date.now()}-${adminSeq}@example.com`, "x", `CC Admin ${adminSeq}`, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `cc-admin-${adminSeq}`, isSuperAdmin: false, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}
before(async () => {
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
});

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `cc-${tag}-${Date.now()}-${seq}@example.com`;
}

async function history(studentId: number) {
  const r = await pool.query(
    `SELECT student_id, email_fingerprint, valid_from, valid_to FROM student_email_identity_history
     WHERE student_id = $1 ORDER BY valid_from ASC`,
    [studentId],
  );
  return r.rows;
}

let fingerprintStudentEmail: typeof import("../lib/studentEmailProvenance").fingerprintStudentEmail;
let normalizeEmail: typeof import("../lib/membershipIdentity").normalizeEmail;
before(async () => {
  fingerprintStudentEmail = (await import("../lib/studentEmailProvenance")).fingerprintStudentEmail;
  normalizeEmail = (await import("../lib/membershipIdentity")).normalizeEmail;
});

test("I: concurrent same-student PATCH A->B and A->C races safely via FOR UPDATE — coherent final state", async () => {
  const admin = await makeAdminWithPermission({ users: { edit: true } });
  const emailA = freshEmail("race-a");
  const emailB = freshEmail("race-b");
  const emailC = freshEmail("race-c");

  const reg = await post("/api/auth/register", { name: "Race Student", email: emailA, password: "OriginalPass123" });
  assert.equal(reg.status, 201);
  const studentId = (reg.json as any).student.id as number;

  const [resB, resC] = await Promise.all([
    patch(`/api/students/${studentId}`, { email: emailB }, admin.token),
    patch(`/api/students/${studentId}`, { email: emailC }, admin.token),
  ]);

  // Route performs no optimistic check on the OLD email value — both
  // requests are expected to succeed (each re-reads the row fresh under
  // its own FOR UPDATE lock once unblocked).
  assert.equal(resB.status, 200, JSON.stringify(resB));
  assert.equal(resC.status, 200, JSON.stringify(resC));

  const rows = await history(studentId);
  const openRows = rows.filter((r) => r.valid_to === null);
  assert.equal(openRows.length, 1, "no two OPEN intervals exist for the student afterward");

  const finalEmailRow = await pool.query(`SELECT email FROM students WHERE id = $1`, [studentId]);
  const finalEmail = finalEmailRow.rows[0].email as string;
  assert.ok(finalEmail === normalizeEmail(emailB) || finalEmail === normalizeEmail(emailC),
    "final email must be exactly one of the two racing targets");
  assert.equal(openRows[0].email_fingerprint, fingerprintStudentEmail(finalEmail),
    "final students.email corresponds to exactly the surviving open interval's fingerprint");

  // Non-overlapping, coherent sequence: for every row except the last,
  // valid_to must be <= the next row's valid_from, and no interval's
  // valid_from > valid_to.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.valid_to !== null) {
      assert.ok(new Date(r.valid_to).getTime() >= new Date(r.valid_from).getTime());
    }
    if (i > 0) {
      const prev = rows[i - 1];
      assert.ok(prev.valid_to !== null, "no interval before the last may be open");
      assert.ok(new Date(prev.valid_to).getTime() <= new Date(r.valid_from).getTime(), "no overlap between consecutive intervals");
    }
  }
  // Expect 3 rows total: the initial registration interval (A, now closed)
  // plus the two racing changes — one closed, one open.
  assert.equal(rows.length, 3, `expected 3 provenance rows (A initial + 2 racing changes), got ${rows.length}`);
});
