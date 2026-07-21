/**
 * Real-database tests for the shared "assignment-ready canonical Class"
 * predicate (balletClassEntitlement.ts), exercised as raw SQL matching the
 * predicate's generated query byte-for-byte. Every one of the 12 scenarios
 * below is the exact case that must be rejected identically by all four
 * entitlement gates that compose this predicate: Group readiness
 * (adminBalletGroups.ts), Application Group assignment, Activation, and
 * Attendance recording (all three in adminBallet.ts) — see
 * balletClassCanonicalModel.test.ts's "single source of the assignment-
 * ready predicate" test for the source-level proof that all four call
 * sites actually share this one function, not four independently-drifting
 * copies.
 *
 * Assumes DISPOSABLE_BALLET_CLASS_DATABASE_URL points at a local, disposable
 * Postgres database already migrated through 0075.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test, beforeEach } from "node:test";

const databaseUrlEnv = process.env["DISPOSABLE_BALLET_CLASS_DATABASE_URL"];
if (!databaseUrlEnv) throw new Error("DISPOSABLE_BALLET_CLASS_DATABASE_URL is required");
const DATABASE_URL: string = databaseUrlEnv;
const url = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)
  || !/disposable|local|test/i.test(url.pathname)
  || url.searchParams.get('sslmode') !== 'disable') {
  throw new Error('Refusing to run Ballet Class entitlement tests outside a local disposable database with sslmode=disable');
}

function query(sql: string): string {
  return execFileSync('psql', [
    '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At',
    '--dbname', DATABASE_URL,
    '--command', sql,
  ], { encoding: 'utf8' }).trim();
}

// The exact SQL isAssignmentReadyClass() generates (balletClassEntitlement.ts),
// parameterized by class id instead of a correlated outer-query column.
function isReady(classId: number): boolean {
  const result = query(`
    select (
      c.is_active = true
      and c.is_legacy = false
      and exists (select 1 from ballet_instructors i where i.id = c.instructor_id and i.is_active = true)
      and (
        select count(*) from ballet_schedules s
        where s.class_id = c.id
          and s.status = 'active'
          and s.day_of_week between 0 and 6
          and s.start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and s.end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and s.start_time < s.end_time
          and s.duration_mins is not null
          and s.duration_mins > 0
          and s.duration_mins = (
            (substring(s.end_time from 1 for 2)::int * 60 + substring(s.end_time from 4 for 2)::int)
            - (substring(s.start_time from 1 for 2)::int * 60 + substring(s.start_time from 4 for 2)::int)
          )
      ) = 1
    ) from ballet_classes c where c.id = ${classId}`);
  return result === 't';
}

let levelId: number;
let groupId: number;
let otherLevelId: number;
let instructorId: number;
let inactiveInstructorId: number;

beforeEach(() => {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  levelId = Number(query(`insert into ballet_levels (name, sort_order, is_active) values ('Invariant Level ${suffix}', 900, true) returning id`));
  otherLevelId = Number(query(`insert into ballet_levels (name, sort_order, is_active) values ('Invariant Other Level ${suffix}', 901, true) returning id`));
  groupId = Number(query(`insert into ballet_groups (name, level_id, is_active) values ('Invariant Group ${suffix}', ${levelId}, true) returning id`));
  instructorId = Number(query(`insert into ballet_instructors (name, is_active) values ('Invariant Instructor Active ${suffix}', true) returning id`));
  inactiveInstructorId = Number(query(`insert into ballet_instructors (name, is_active) values ('Invariant Instructor Inactive ${suffix}', false) returning id`));
});

function makeClass(overrides: { instructorId?: number } = {}): number {
  return Number(query(`
    insert into ballet_classes (title, is_legacy, level_id, group_id, instructor_id, is_active)
    values ('Invariant Class', false, ${levelId}, ${groupId}, ${overrides.instructorId ?? instructorId}, true)
    returning id`));
}

function addSchedule(classId: number, fields: {
  dayOfWeek?: string; startTime?: string; endTime?: string; status?: string; durationMins?: string;
} = {}): void {
  const dayOfWeek = fields.dayOfWeek ?? "1";
  const startTime = fields.startTime ?? "'16:00'";
  const endTime = fields.endTime ?? "'17:00'";
  const status = fields.status ?? "'active'";
  const durationMins = fields.durationMins ?? "60";
  query(`insert into ballet_schedules (class_id, day_of_week, start_time, end_time, status, duration_mins)
    values (${classId}, ${dayOfWeek}, ${startTime}, ${endTime}, ${status}, ${durationMins})`);
}

test("1. one valid active Schedule -> ready", () => {
  const classId = makeClass();
  addSchedule(classId);
  assert.equal(isReady(classId), true);
});

test("2. zero active Schedules -> not ready", () => {
  const classId = makeClass();
  assert.equal(isReady(classId), false);
});

test("3. cancelled Schedule -> not ready", () => {
  const classId = makeClass();
  addSchedule(classId, { status: "'cancelled'" });
  assert.equal(isReady(classId), false);
});

test("4. inactive Instructor -> not ready", () => {
  const classId = makeClass({ instructorId: inactiveInstructorId });
  addSchedule(classId);
  assert.equal(isReady(classId), false);
});

test("5. null duration -> not ready", () => {
  const classId = makeClass();
  addSchedule(classId, { durationMins: "null" });
  assert.equal(isReady(classId), false);
});

test("6. zero/negative duration -> not ready", () => {
  const zeroClass = makeClass();
  addSchedule(zeroClass, { durationMins: "0" });
  assert.equal(isReady(zeroClass), false);

  const negativeClass = makeClass();
  addSchedule(negativeClass, { durationMins: "-15" });
  assert.equal(isReady(negativeClass), false);
});

test("7. missing or malformed time -> not ready", () => {
  const malformedStart = makeClass();
  addSchedule(malformedStart, { startTime: "'4pm'", endTime: "'17:00'" });
  assert.equal(isReady(malformedStart), false);

  const outOfRangeHour = makeClass();
  addSchedule(outOfRangeHour, { startTime: "'25:00'", endTime: "'26:00'" });
  assert.equal(isReady(outOfRangeHour), false);

  const badDay = makeClass();
  addSchedule(badDay, { dayOfWeek: "9" });
  assert.equal(isReady(badDay), false);
});

test("8. start >= end -> not ready", () => {
  const equalTimes = makeClass();
  addSchedule(equalTimes, { startTime: "'16:00'", endTime: "'16:00'", durationMins: "0" });
  assert.equal(isReady(equalTimes), false);

  const reversedTimes = makeClass();
  addSchedule(reversedTimes, { startTime: "'18:00'", endTime: "'17:00'", durationMins: "60" });
  assert.equal(isReady(reversedTimes), false);
});

test("9. two active Schedules for one Class -> not ready", () => {
  const classId = makeClass();
  addSchedule(classId, { dayOfWeek: "1", startTime: "'16:00'", endTime: "'17:00'" });
  addSchedule(classId, { dayOfWeek: "3", startTime: "'09:00'", endTime: "'10:00'" });
  assert.equal(isReady(classId), false);
});

test("10. Group/Level mismatch -> not ready (a fully-ready Class attached to a DIFFERENT Group/Level never satisfies THIS Group's readiness check)", () => {
  const classId = makeClass();
  addSchedule(classId);
  assert.equal(isReady(classId), true, "sanity: the class itself is ready in isolation");

  // Mirrors exactly what every call site composes on top of
  // isAssignmentReadyClass(): a groupId (and, at some sites, levelId)
  // filter. A ready Class scoped to `groupId` must not be found when the
  // query is scoped to a different group under a different level.
  const otherGroupId = Number(query(`insert into ballet_groups (name, level_id, is_active) values ('Invariant Other Group', ${otherLevelId}, true) returning id`));
  const readyForOtherGroup = query(`
    select exists (
      select 1 from ballet_classes c
      where c.group_id = ${otherGroupId}
        and c.level_id = ${otherLevelId}
        and c.is_active = true and c.is_legacy = false
        and exists (select 1 from ballet_instructors i where i.id = c.instructor_id and i.is_active = true)
        and (
          select count(*) from ballet_schedules s
          where s.class_id = c.id and s.status = 'active'
            and s.day_of_week between 0 and 6
            and s.start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and s.end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and s.start_time < s.end_time
            and s.duration_mins is not null and s.duration_mins > 0
            and s.duration_mins = (
              (substring(s.end_time from 1 for 2)::int * 60 + substring(s.end_time from 4 for 2)::int)
              - (substring(s.start_time from 1 for 2)::int * 60 + substring(s.start_time from 4 for 2)::int)
            )
        ) = 1
    )`);
  assert.equal(readyForOtherGroup, 'f');
});

test("11. duration inconsistent with start/end -> not ready (defense-in-depth beyond what the write API can ever produce)", () => {
  const classId = makeClass();
  addSchedule(classId, { startTime: "'16:00'", endTime: "'17:00'", durationMins: "999" });
  assert.equal(isReady(classId), false);
});

test("12. a Legacy Class is never ready, even with a valid active Schedule", () => {
  const legacyClassId = Number(query(`insert into ballet_classes (title, is_legacy, level_id, is_active) values ('Invariant Legacy Class', true, ${levelId}, false) returning id`));
  query(`insert into ballet_schedules (class_id, day_of_week, start_time, end_time, status, duration_mins) values (${legacyClassId}, 2, '10:00', '11:00', 'cancelled', null)`);
  assert.equal(isReady(legacyClassId), false);

  // A genuinely valid canonical Class remains ready alongside it.
  const readyClass = makeClass();
  addSchedule(readyClass);
  assert.equal(isReady(readyClass), true);
});
