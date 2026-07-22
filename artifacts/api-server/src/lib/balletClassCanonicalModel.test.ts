import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("lib/db/migrations/0075_ballet_class_canonical_relationships.sql");
const classSchema = read("lib/db/src/schema/balletClasses.ts");
const scheduleSchema = read("lib/db/src/schema/balletSchedules.ts");
const schemaIndex = read("lib/db/src/schema/index.ts");
const classRoute = read("artifacts/api-server/src/routes/adminBalletClasses.ts");
const scheduleRoute = read("artifacts/api-server/src/routes/adminBalletSchedules.ts");
const groupRoute = read("artifacts/api-server/src/routes/adminBalletGroups.ts");
const instructorRoute = read("artifacts/api-server/src/routes/adminBalletInstructors.ts");
const applicationRoute = read("artifacts/api-server/src/routes/adminBallet.ts");
const publicBalletRoute = read("artifacts/api-server/src/routes/ballet.ts");
const classPage = read("artifacts/admin/src/pages/ballet/BalletClassesPage.tsx");
const schedulePage = read("artifacts/admin/src/pages/ballet/BalletSchedulesPage.tsx");

// ─── 0075 is a pure Expand migration ───────────────────────────────────────

test("0075 does not require an empty legacy catalogue", () => {
  assert.doesNotMatch(migration, /RAISE EXCEPTION/);
  assert.doesNotMatch(migration, /count\(\*\)\s*INTO/i);
});

test("0075 adds is_legacy defaulting true and nullable canonical relationships", () => {
  assert.match(migration, /ADD COLUMN "is_legacy" boolean NOT NULL DEFAULT true/);
  assert.match(migration, /ADD COLUMN "level_id" integer;/);
  assert.match(migration, /ADD COLUMN "group_id" integer;/);
  assert.doesNotMatch(migration, /ADD COLUMN "level_id" integer NOT NULL/);
  assert.doesNotMatch(migration, /ADD COLUMN "group_id" integer NOT NULL/);
  assert.doesNotMatch(migration, /instructor_id.*SET NOT NULL/);
});

test("0075 adds the composite Group/Level FK and the supporting unique constraint", () => {
  assert.match(migration, /ballet_groups_id_level_id_unique/);
  assert.match(migration, /ballet_classes_group_level_fk/);
  assert.match(migration, /ballet_classes_level_id_ballet_levels_id_fk/);
});

test("0075 backfills level_id only for classes with exactly one legacy Level link, never a Group", () => {
  assert.match(migration, /HAVING count\(\*\) = 1/);
  assert.match(migration, /INNER JOIN "ballet_levels"/);
  assert.doesNotMatch(migration, /SET\s+"group_id"/i);
});

test("0075 does not drop any legacy relationship table", () => {
  assert.doesNotMatch(migration, /DROP TABLE/i);
  for (const table of ["ballet_group_schedules", "ballet_class_groups", "ballet_class_levels"]) {
    assert.doesNotMatch(migration, new RegExp(`DROP TABLE "${table}"`));
  }
});

test("0075 preserves multiple schedules per class and defers Schedule shape CHECK constraints", () => {
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX "ballet_schedules_class_id_unique"/);
  assert.doesNotMatch(migration, /ballet_schedules_day_of_week_check/);
  assert.doesNotMatch(migration, /ballet_schedules_time_format_check/);
  assert.doesNotMatch(migration, /ballet_schedules_time_order_check/);
  assert.doesNotMatch(migration, /ballet_schedules_duration_positive_check/);
  assert.doesNotMatch(migration, /duration_mins.*SET NOT NULL/i);
});

// ─── Drizzle schema matches the Expand-window shape ────────────────────────

test("ballet_classes schema keeps canonical relationships nullable and adds isLegacy", () => {
  assert.match(classSchema, /isLegacy:\s*boolean\("is_legacy"\)\.notNull\(\)\.default\(true\)/);
  assert.match(classSchema, /levelId:\s*integer\("level_id"\)\.references/);
  assert.match(classSchema, /groupId:\s*integer\("group_id"\)/);
  assert.doesNotMatch(classSchema, /levelId:.*\.notNull\(\)/);
  assert.doesNotMatch(classSchema, /groupId:.*\.notNull\(\)/);
  assert.doesNotMatch(classSchema, /instructorId:.*\.notNull\(\)/);
});

test("ballet_schedules schema is untouched by the canonical model during Expand", () => {
  assert.doesNotMatch(scheduleSchema, /uniqueIndex\("ballet_schedules_class_id_unique"/);
  assert.doesNotMatch(scheduleSchema, /check\(/);
  assert.match(scheduleSchema, /durationMins:\s*integer\("duration_mins"\),/);
});

test("legacy join tables remain exported from the schema barrel", () => {
  assert.match(schemaIndex, /export \* from ".\/balletClassGroups"/);
  assert.match(schemaIndex, /export \* from ".\/balletClassLevels"/);
  assert.match(schemaIndex, /export \* from ".\/balletGroupSchedules"/);
});

// ─── API enforces canonical vs legacy at the application layer ────────────

test("class create and edit are transactional, class create is class-only, and canonical create is explicitly non-legacy", () => {
  assert.match(classRoute, /db\.transaction/);
  assert.match(classRoute, /tx\.insert\(balletClassesTable\)/);
  assert.doesNotMatch(classRoute, /tx\.insert\(balletSchedulesTable\)/);
  assert.match(classRoute, /isLegacy:\s*false/);
  assert.match(classRoute, /for update/);
  assert.doesNotMatch(classRoute, /tx\.update\(balletSchedulesTable\)/);
  assert.match(classRoute, /schedules:\s*\[\]/);
  assert.match(classRoute, /schedule:\s*null/);
});

test("legacy Classes are rejected from the canonical edit form with the documented message", () => {
  assert.match(classRoute, /existingClass\.isLegacy/);
  assert.match(classRoute, /This Class uses the retired Ballet Class model\. Create a new Class to resume the program\./);
  assert.match(classRoute, /LEGACY:/);
});

test("legacy-owned schedules are rejected from the standalone schedule edit route", () => {
  assert.match(scheduleRoute, /owningClass\?\.isLegacy/);
  assert.match(scheduleRoute, /LEGACY_SCHEDULE/);
  assert.match(scheduleRoute, /This Class uses the retired Ballet Class model/);
});

test("backend enforces active and matching relationships", () => {
  assert.match(classRoute, /selected level is inactive/);
  assert.match(classRoute, /selected group is inactive/);
  assert.match(classRoute, /group does not belong to the selected level/);
  assert.match(classRoute, /selected instructor is inactive/);
  assert.match(groupRoute, /Cannot change this group's level while it has/);
  assert.match(instructorRoute, /Cannot deactivate this instructor while.*active Ballet class/s);
});

test("balletClassEntitlement.ts is the single source of the assignment-ready predicate, imported (not reimplemented) at every gate", () => {
  const entitlementModule = read("artifacts/api-server/src/lib/balletClassEntitlement.ts");
  // The "at least one" invariant must be a correlated COUNT subquery, never a
  // join — a join against ballet_schedules would multiply a Class with 2+
  // active Schedules into 2+ output rows instead of preserving one Class as
  // one readiness signal.
  assert.match(entitlementModule, /select count\(\*\) from ballet_schedules s/);
  assert.match(entitlementModule, /\)\s*>=\s*1`/);
  assert.match(entitlementModule, /hasActiveLevelAndGroup/);
  assert.doesNotMatch(entitlementModule, /\.innerJoin\(/);
  for (const clause of [
    "day_of_week between 0 and 6",
    "start_time <",
    "duration_mins is not null",
    "duration_mins > 0",
    "duration_mins = (",
  ]) {
    assert.match(entitlementModule, new RegExp(clause.replace(/[()]/g, "\\$&")));
  }

  assert.match(groupRoute, /import \{ isAssignmentReadyClass \} from "\.\.\/lib\/balletClassEntitlement"/);
  assert.match(applicationRoute, /import \{ isAssignmentReadyClass, scheduleShapeCondition \} from "\.\.\/lib\/balletClassEntitlement"/);

  // All 4 gates call isAssignmentReadyClass(): Group readiness (1 site),
  // Activation, Application Group assignment, Attendance (3 sites in
  // adminBallet.ts) — never a bespoke inline reimplementation.
  const groupRouteCalls = (groupRoute.match(/isAssignmentReadyClass\(\)/g) ?? []).length;
  const applicationRouteCalls = (applicationRoute.match(/isAssignmentReadyClass\(\)/g) ?? []).length;
  assert.equal(groupRouteCalls, 1, "Group readiness must call isAssignmentReadyClass exactly once");
  assert.equal(applicationRouteCalls, 3, "Activation, assign-group, and Attendance must each call isAssignmentReadyClass");
  assert.match(applicationRoute, /scheduleShapeCondition\(\)/, "Attendance must additionally validate the specific submitted Schedule row");
});

test("assign-level uses an allowlist so an already-active application can never be reset to assignedToLevel", () => {
  assert.match(applicationRoute, /fromStatus !== "accepted" && fromStatus !== "assignedToLevel"/);
});

test("assign-group is bounded to assignedToLevel/active applications and requires an assignment-ready Class", () => {
  assert.match(applicationRoute, /app\.status !== "assignedToLevel" && app\.status !== "active"/);
});

test("public Ballet class response returns all schedules plus a deterministic deprecated alias", () => {
  assert.match(publicBalletRoute, /schedulesByClass/);
  assert.match(publicBalletRoute, /schedules,/);
  assert.match(publicBalletRoute, /schedule:\s+schedules\[0\] \?\? null/);
  assert.match(publicBalletRoute, /orderBy\(asc\(balletSchedulesTable\.dayOfWeek\), asc\(balletSchedulesTable\.startTime\), asc\(balletSchedulesTable\.id\)\)/);
  assert.doesNotMatch(publicBalletRoute, /const scheduleByClass/);
  assert.doesNotMatch(publicBalletRoute, /if \(!scheduleByClass\.has/);
});

// ─── Admin UI reflects legacy vs canonical ─────────────────────────────────

test("Admin Class form is single-select, class-owned only, and marks legacy rows read-only", () => {
  assert.doesNotMatch(classPage, /Checkbox/);
  assert.doesNotMatch(classPage, /name="levelIds"|name="groupIds"/);
  for (const name of ["levelId", "groupId", "instructorId"]) assert.match(classPage, new RegExp(`name="${name}"`));
  for (const name of ["dayOfWeek", "startTime", "endTime"]) assert.doesNotMatch(classPage, new RegExp(`name="${name}"`));
  assert.match(classPage, /selectableGroups.*levelId === selectedLevelId/);
  assert.doesNotMatch(classPage, /input-ballet-class-duration/);
  assert.match(classPage, /Historical Class/);
  assert.match(classPage, /item\.isLegacy/);
  assert.match(classPage, /No schedules/);
  assert.match(classPage, /schedules\.length === 1/);
});

test("Schedules page creates one schedule at a time and keeps already-scheduled classes selectable", () => {
  assert.match(schedulePage, /button-add-ballet-schedule|openCreate|createMutation/);
  assert.match(schedulePage, /name="classId"/);
  assert.match(schedulePage, /eligibleClasses/);
  assert.doesNotMatch(schedulePage, /schedulesFor\(item\)\.length === 0/);
  assert.match(schedulePage, /count === 0 \? "No schedules"/);
  assert.match(schedulePage, /isLegacySchedule/);
  assert.match(schedulePage, /Historical Class/);
});
