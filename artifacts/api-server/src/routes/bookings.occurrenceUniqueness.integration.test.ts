/**
 * Finance Final Closure Batch 1 — Part F2/F3 regression coverage.
 *
 * Proves the DB-level backstop (migration 0085,
 * bookings_active_occurrence_participant_unique — a partial unique index on
 * schedule_id, occurrence_date, account_owner_student_id,
 * coalesce(participant_child_id, 0), scoped to occurrence_date IS NOT NULL
 * AND account_owner_student_id IS NOT NULL AND booking_status IN
 * ('pending','confirmed')) actually closes the concurrency gap the
 * application-level check-then-insert in bookings.ts cannot: two truly
 * simultaneous POST /bookings requests for the same participant + exact
 * occurrence must produce exactly one booking, one payment_records row, and
 * one payment_events row — never two.
 *
 * Requires this test's disposable database to already have migration 0085
 * applied (run `DATABASE_URL=<this db> pnpm --filter @workspace/db run
 * migrate` first, same as every other integration test in this suite).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_OCCURRENCE_UNIQUE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_occurrence_unique";

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
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let classId: number;
let scheduleId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

let studentCounter = 0;
async function makeStudent(label: string): Promise<{ id: number; email: string }> {
  studentCounter += 1;
  const email = `occ-unique-${Date.now()}-${studentCounter}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Occ Unique Test ${label}`, email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

async function asStudent(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function countsForStudent(email: string): Promise<{ bookings: number; records: number; events: number }> {
  const bookings = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE student_email = $1`, [email]);
  const records = await pool.query(
    `SELECT count(*)::int AS n FROM payment_records pr
       JOIN bookings b ON b.id = pr.booking_id
      WHERE b.student_email = $1`,
    [email],
  );
  const events = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe
       JOIN payment_records pr ON pr.id = pe.payment_record_id
       JOIN bookings b ON b.id = pr.booking_id
      WHERE b.student_email = $1`,
    [email],
  );
  return { bookings: bookings.rows[0].n, records: records.rows[0].n, events: events.rows[0].n };
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const bookingsRouter = (await import("./bookings")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", bookingsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Occ Unique Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Occ Unique Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time, price_egp) VALUES ($1, 'one_time', 'active', CURRENT_DATE, '00:00', '23:59', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
  await pool.query(
    `INSERT INTO class_pricing_settings (id, single_class_price_egp) VALUES (1, 300) ON CONFLICT (id) DO UPDATE SET single_class_price_egp = 300`,
  );
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("Part F2: the DB index exists exactly as specified (partial, coalesced, status-scoped)", async () => {
  const result = await pool.query(
    `SELECT indexdef FROM pg_indexes WHERE indexname = 'bookings_active_occurrence_participant_unique'`,
  );
  assert.equal(result.rows.length, 1, "the migration 0085 index must exist on this database");
  const def = result.rows[0].indexdef as string;
  assert.match(def, /UNIQUE/);
  assert.match(def, /COALESCE\(participant_child_id, 0\)/);
  assert.match(def, /occurrence_date IS NOT NULL/);
  assert.match(def, /account_owner_student_id IS NOT NULL/);
  assert.match(def, /booking_status = ANY \(ARRAY\['pending'::text, 'confirmed'::text\]\)/);
});

test("Part F3: two truly concurrent requests for the same participant + occurrence produce exactly one booking, one payment record, one payment event", async () => {
  const student = await makeStudent("concurrent");
  const token = studentToken(student.id, student.email);
  const body = JSON.stringify({
    studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
  });

  const [a, b] = await Promise.all([
    asStudent(token, "/api/bookings", { method: "POST", body }),
    asStudent(token, "/api/bookings", { method: "POST", body }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.equal(statuses[0], 201, "exactly one concurrent request must succeed");
  assert.notEqual(statuses[1], 201, "the other must be deterministically rejected, not also succeed");

  const counts = await countsForStudent(student.email);
  assert.equal(counts.bookings, 1, "the DB constraint must guarantee exactly one booking row survives, even under a true race");
  assert.equal(counts.records, 1, "exactly one payment_records row — no duplicate monetary capture");
  assert.equal(counts.events, 1, "exactly one payment_events row");
});

test("Part F4: a cancelled booking does not block a valid new booking for the same occurrence", async () => {
  const student = await makeStudent("cancel-then-rebook");
  const token = studentToken(student.id, student.email);
  const body = JSON.stringify({
    studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
  });

  const first = await asStudent(token, "/api/bookings", { method: "POST", body });
  assert.equal(first.status, 201);
  const firstBooking = await jsonBody(first);

  await pool.query(`UPDATE bookings SET booking_status = 'cancelled', status = 'cancelled' WHERE id = $1`, [firstBooking.id]);

  const second = await asStudent(token, "/api/bookings", { method: "POST", body });
  assert.equal(second.status, 201, "a cancelled booking must not block re-booking the same occurrence — the DB index is scoped to pending/confirmed only");

  const counts = await countsForStudent(student.email);
  assert.equal(counts.bookings, 2, "both the cancelled row and the new booking coexist");
});

test("Part F5: legacy null-occurrence rows never collide with (and never block) a new occurrence-specific booking", async () => {
  const student = await makeStudent("legacy-null-occurrence");
  // A legacy-shaped row: no occurrence_date, exactly as a pre-occurrence-model booking would look.
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, booking_status, payment_status, payment_mode, status)
     VALUES ($1, $2, $3, $4, $5, NULL, 'confirmed', 'pending_payment', 'pay_at_studio', 'confirmed')`,
    [student.email, student.email, student.id, scheduleId, classId],
  );
  // A second legacy null-occurrence row for the SAME schedule/account/participant —
  // proving the partial index's "occurrence_date IS NOT NULL" exclusion really
  // means legacy rows are entirely untouched (including allowing what would,
  // for a real occurrence, be a duplicate).
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, booking_status, payment_status, payment_mode, status)
     VALUES ($1, $2, $3, $4, $5, NULL, 'confirmed', 'pending_payment', 'pay_at_studio', 'confirmed')`,
    [student.email, student.email, student.id, scheduleId, classId],
  );

  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
  });
  assert.equal(res.status, 201, "a brand-new occurrence-specific booking must succeed despite pre-existing legacy null-occurrence rows for the same schedule/account");
});
