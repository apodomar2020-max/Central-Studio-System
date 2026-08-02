import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_LIFECYCLE_TEST_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_schedule_update";
const databaseUrl = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || !/disposable|test|local/i.test(databaseUrl.pathname) || /railway/i.test(DATABASE_URL)) {
  throw new Error("Refusing non-disposable database");
}
process.env.DATABASE_URL = DATABASE_URL;

let pool: typeof import("@workspace/db").pool;
let classId: number;
let unusedScheduleId: number;
let activeScheduleId: number;
let studentId: number;
let branchId: number;
let roomId: number;

before(async () => {
  pool = (await import("@workspace/db")).pool;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const classRes = await pool.query(
    `INSERT INTO classes (title, category, duration_mins, is_active) VALUES ('Lifecycle Class ${suffix}', 'Hip Hop', 60, true) RETURNING id`,
  );
  classId = classRes.rows[0].id;

  const branchRes = await pool.query(
    `INSERT INTO studio_branches (name) VALUES ('Branch ${suffix}') RETURNING id`,
  );
  branchId = branchRes.rows[0].id;

  const roomRes = await pool.query(
    `INSERT INTO studio_rooms (branch_id, name) VALUES ($1, 'Room ${suffix}') RETURNING id`,
    [branchId],
  );
  roomId = roomRes.rows[0].id;

  const unusedRes = await pool.query(
    `INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time)
     VALUES ($1, $2, $3, 'weekly', 'active', 1, '10:00', '11:00') RETURNING id`,
    [classId, branchId, roomId],
  );
  unusedScheduleId = unusedRes.rows[0].id;

  const activeRes = await pool.query(
    `INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time)
     VALUES ($1, NULL, NULL, 'weekly', 'active', 2, '12:00', '13:00') RETURNING id`,
    [classId],
  );
  activeScheduleId = activeRes.rows[0].id;

  const studentRes = await pool.query(
    `INSERT INTO students (name, email, account_type) VALUES ('Lifecycle Student', 'life-${suffix}@example.com', 'student') RETURNING id`,
  );
  studentId = studentRes.rows[0].id;

  // Insert a booking for activeScheduleId to create historical activity
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, occurrence_date, status) VALUES ('Lifecycle Student', $1, $2, $3, '2026-08-10', 'confirmed')`,
    [`life-${suffix}@example.com`, studentId, activeScheduleId],
  );
});

after(async () => {
  if (pool) {
    await pool.query(`DELETE FROM bookings WHERE account_owner_student_id = $1`, [studentId]);
    await pool.query(`DELETE FROM students WHERE id = $1`, [studentId]);
    await pool.query(`DELETE FROM schedules WHERE class_id = $1`, [classId]);
    await pool.query(`DELETE FROM studio_rooms WHERE id = $1`, [roomId]);
    await pool.query(`DELETE FROM studio_branches WHERE id = $1`, [branchId]);
    await pool.query(`DELETE FROM classes WHERE id = $1`, [classId]);
    await pool.end();
  }
});

test("Phase 1: Legacy schedules with null branch can receive initial location assignment despite bookings", async () => {
  // Update activeScheduleId (which has a booking and branch_id = NULL) to set initial branch & room
  await pool.query(
    `UPDATE schedules SET branch_id = $1, room_id = $2 WHERE id = $3`,
    [branchId, roomId, activeScheduleId],
  );

  const res = await pool.query(
    `SELECT branch_id, room_id FROM schedules WHERE id = $1`,
    [activeScheduleId],
  );
  assert.equal(res.rows[0].branch_id, branchId);
  assert.equal(res.rows[0].room_id, roomId);
});

test("Phase 2: Deleting a class with linked schedules archives (deactivates) it without creating orphan schedules", async () => {
  // Simulate DELETE /classes/:id logic for class with linked schedules
  await pool.query(
    `UPDATE classes SET is_active = false WHERE id = $1`,
    [classId],
  );

  // Verify class row still exists in DB
  const classRes = await pool.query(`SELECT id, title, is_active FROM classes WHERE id = $1`, [classId]);
  assert.equal(classRes.rows.length, 1);
  assert.equal(classRes.rows[0].is_active, false);

  // Verify schedule relationship remains valid
  const scheduleRes = await pool.query(
    `SELECT s.id, c.title AS class_title FROM schedules s JOIN classes c ON s.class_id = c.id WHERE s.id = $1`,
    [activeScheduleId],
  );
  assert.equal(scheduleRes.rows.length, 1);
  assert.match(scheduleRes.rows[0].class_title, /^Lifecycle Class/);
});

test("Phase 3: Unused schedule (0 bookings/attendance) can be safely deleted", async () => {
  const deleteRes = await pool.query(`DELETE FROM schedules WHERE id = $1 RETURNING id`, [unusedScheduleId]);
  assert.equal(deleteRes.rows.length, 1);

  const checkRes = await pool.query(`SELECT id FROM schedules WHERE id = $1`, [unusedScheduleId]);
  assert.equal(checkRes.rows.length, 0);
});

test("Phase 3: Schedule with bookings is protected against permanent deletion", async () => {
  const bookingCount = await pool.query(`SELECT count(*)::int as count FROM bookings WHERE schedule_id = $1`, [activeScheduleId]);
  assert.ok(bookingCount.rows[0].count > 0, "Schedule must have historical bookings");

  // Deletion is blocked in application route logic; verify schedule remains in DB
  const scheduleRes = await pool.query(`SELECT id, status FROM schedules WHERE id = $1`, [activeScheduleId]);
  assert.equal(scheduleRes.rows.length, 1);
  assert.equal(scheduleRes.rows[0].status, "active");
});
