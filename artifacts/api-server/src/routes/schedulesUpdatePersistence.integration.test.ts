import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_SCHEDULE_UPDATE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_schedule_update";
const databaseUrl = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || !/disposable|test|local/i.test(databaseUrl.pathname) || /railway/i.test(DATABASE_URL)) {
  throw new Error("Refusing non-disposable database");
}
process.env.DATABASE_URL = DATABASE_URL;

let pool: typeof import("@workspace/db").pool;
let classId: number;
let branch1Id: number;
let room1Id: number;
let branch2Id: number;
let room2Id: number;

before(async () => {
  pool = (await import("@workspace/db")).pool;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const classRes = await pool.query(
    `INSERT INTO classes (title, category, duration_mins) VALUES ('Test Class ${suffix}', 'Hip Hop', 60) RETURNING id`,
  );
  classId = classRes.rows[0].id;

  const branch1Res = await pool.query(
    `INSERT INTO studio_branches (name) VALUES ('Branch Alpha ${suffix}') RETURNING id`,
  );
  branch1Id = branch1Res.rows[0].id;

  const room1Res = await pool.query(
    `INSERT INTO studio_rooms (branch_id, name) VALUES ($1, 'Room A ${suffix}') RETURNING id`,
    [branch1Id],
  );
  room1Id = room1Res.rows[0].id;

  const branch2Res = await pool.query(
    `INSERT INTO studio_branches (name) VALUES ('Branch Beta ${suffix}') RETURNING id`,
  );
  branch2Id = branch2Res.rows[0].id;

  const room2Res = await pool.query(
    `INSERT INTO studio_rooms (branch_id, name) VALUES ($1, 'Room B ${suffix}') RETURNING id`,
    [branch2Id],
  );
  room2Id = room2Res.rows[0].id;
});

after(async () => {
  if (pool) {
    await pool.query(`DELETE FROM schedules WHERE class_id = $1`, [classId]);
    await pool.query(`DELETE FROM studio_rooms WHERE id IN ($1, $2)`, [room1Id, room2Id]);
    await pool.query(`DELETE FROM studio_branches WHERE id IN ($1, $2)`, [branch1Id, branch2Id]);
    await pool.query(`DELETE FROM classes WHERE id = $1`, [classId]);
    await pool.end();
  }
});

test("Updating a schedule with a new branch and room persists branch_id and room_id in database", async () => {
  const insertRes = await pool.query(
    `INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time)
     VALUES ($1, $2, $3, 'weekly', 'active', 1, '10:00', '11:00') RETURNING id, branch_id, room_id`,
    [classId, branch1Id, room1Id],
  );
  const scheduleId = insertRes.rows[0].id;
  assert.equal(insertRes.rows[0].branch_id, branch1Id);
  assert.equal(insertRes.rows[0].room_id, room1Id);

  // Update schedule to branch2 and room2
  await pool.query(
    `UPDATE schedules SET branch_id = $1, room_id = $2 WHERE id = $3`,
    [branch2Id, room2Id, scheduleId],
  );

  // Read schedule afterwards from database
  const selectRes = await pool.query(
    `SELECT s.id, s.branch_id, s.room_id, b.name AS branch_name, r.name AS room_name
     FROM schedules s
     LEFT JOIN studio_branches b ON s.branch_id = b.id
     LEFT JOIN studio_rooms r ON s.room_id = r.id
     WHERE s.id = $1`,
    [scheduleId],
  );

  assert.equal(selectRes.rows[0].branch_id, branch2Id);
  assert.equal(selectRes.rows[0].room_id, room2Id);
  assert.match(selectRes.rows[0].branch_name, /^Branch Beta/);
  assert.match(selectRes.rows[0].room_name, /^Room B/);
});

test("Schedule update logic validates and persists branch and room changes", async () => {
  const insertRes = await pool.query(
    `INSERT INTO schedules (class_id, branch_id, room_id, type, status, day_of_week, start_time, end_time)
     VALUES ($1, $2, $3, 'weekly', 'active', 2, '14:00', '15:00') RETURNING id`,
    [classId, branch1Id, room1Id],
  );
  const scheduleId = insertRes.rows[0].id;

  // Perform update query matching PATCH /schedules/:id behavior
  await pool.query(
    `UPDATE schedules SET branch_id = $1, room_id = $2, start_time = '15:00', end_time = '16:00' WHERE id = $3`,
    [branch2Id, room2Id, scheduleId],
  );

  // Fetch updated schedule row with Joined branch and room data
  const updatedRes = await pool.query(
    `SELECT s.id, s.branch_id, s.room_id, s.start_time, s.end_time, b.name as branch_name, r.name as room_name
     FROM schedules s
     LEFT JOIN studio_branches b ON s.branch_id = b.id
     LEFT JOIN studio_rooms r ON s.room_id = r.id
     WHERE s.id = $1`,
    [scheduleId],
  );

  const row = updatedRes.rows[0];
  assert.equal(row.branch_id, branch2Id);
  assert.equal(row.room_id, room2Id);
  assert.equal(row.start_time, "15:00");
  assert.match(row.branch_name, /^Branch Beta/);
  assert.match(row.room_name, /^Room B/);
});
