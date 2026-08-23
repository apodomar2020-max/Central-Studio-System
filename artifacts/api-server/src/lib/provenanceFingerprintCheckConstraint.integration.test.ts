/**
 * B3B0-1A Verification Closure — Section H / requirement 22: real raw SQL
 * INSERT attempts against the actual migrated
 * student_email_identity_history_fingerprint_format_check CHECK constraint
 * (migration 0116). Live-INSERT proof, not regex reasoning about the SQL.
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

let pool: typeof import("@workspace/db").pool;
let db: typeof import("@workspace/db").db;
let studentsTable: typeof import("@workspace/db").studentsTable;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  db = dbModule.db;
  studentsTable = dbModule.studentsTable;
});

after(async () => {
  await pool.end();
});

let seq = 0;
async function makeStudent(): Promise<number> {
  seq += 1;
  const email = `check-const-${Date.now()}-${seq}@example.com`;
  const [row] = await db.insert(studentsTable).values({ name: "Check Constraint Test", email }).returning();
  return row!.id;
}

async function attemptInsert(studentId: number, fingerprint: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await pool.query(
      `INSERT INTO student_email_identity_history (student_id, email_fingerprint, valid_from, valid_to, source)
       VALUES ($1, $2, now(), NULL, 'admin_update')`,
      [studentId, fingerprint],
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

test("H: correct v1:k1:<64hex> format IS accepted by the live CHECK constraint", async () => {
  const studentId = await makeStudent();
  const result = await attemptInsert(studentId, `v1:k1:${"a".repeat(64)}`);
  assert.equal(result.ok, true, result.error);
});

test("H: old ambiguous v1:<64hex> format (no k1 segment) IS REJECTED by the live CHECK constraint", async () => {
  const studentId = await makeStudent();
  const result = await attemptInsert(studentId, `v1:${"a".repeat(64)}`);
  assert.equal(result.ok, false, "old format must be rejected");
  assert.match(result.error!, /fingerprint_format_check|violates check constraint/i);
});

test("H: non-numeric key id v1:kx:<digest> is REJECTED", async () => {
  const studentId = await makeStudent();
  const result = await attemptInsert(studentId, `v1:kx:${"a".repeat(64)}`);
  assert.equal(result.ok, false);
  assert.match(result.error!, /fingerprint_format_check|violates check constraint/i);
});

test("H: wrong-length hex v1:k1:short is REJECTED", async () => {
  const studentId = await makeStudent();
  const result = await attemptInsert(studentId, "v1:k1:short");
  assert.equal(result.ok, false);
  assert.match(result.error!, /fingerprint_format_check|violates check constraint/i);
});

test("H: raw email string is REJECTED", async () => {
  const studentId = await makeStudent();
  const result = await attemptInsert(studentId, "student@example.com");
  assert.equal(result.ok, false);
  assert.match(result.error!, /fingerprint_format_check|violates check constraint/i);
});

test("H: plain hex with no version/key prefix is REJECTED", async () => {
  const studentId = await makeStudent();
  const result = await attemptInsert(studentId, "a".repeat(64));
  assert.equal(result.ok, false);
  assert.match(result.error!, /fingerprint_format_check|violates check constraint/i);
});

test("H: uppercase hex v1:k1:<64 UPPERCASE hex> is REJECTED (lowercase-only per regex)", async () => {
  const studentId = await makeStudent();
  const result = await attemptInsert(studentId, `v1:k1:${"A".repeat(64)}`);
  assert.equal(result.ok, false);
  assert.match(result.error!, /fingerprint_format_check|violates check constraint/i);
});
