import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

test("weekly Ballet metric counts Schedule rows, never unique Class rows", async () => {
  const { buildActiveBalletWeeklyScheduleCountQuery } = await import("./balletWeeklyScheduleCountQuery");
  const { sql } = buildActiveBalletWeeklyScheduleCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  assert.match(normalized, /count\([^)]*ballet_schedules[^)]*id/);
  assert.doesNotMatch(normalized, /count\s*\(\s*distinct[^)]*ballet_classes/);
});

test("weekly Ballet metric enforces canonical active Class relationships", async () => {
  const { buildActiveBalletWeeklyScheduleCountQuery } = await import("./balletWeeklyScheduleCountQuery");
  const { sql } = buildActiveBalletWeeklyScheduleCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  assert.match(normalized, /ballet_classes/);
  assert.match(normalized, /is_legacy/);
  assert.match(normalized, /ballet_levels/);
  assert.match(normalized, /ballet_groups/);
  assert.match(normalized, /ballet_instructors/);
});

test("weekly Ballet metric uses the complete active Schedule shape predicate", async () => {
  const { buildActiveBalletWeeklyScheduleCountQuery } = await import("./balletWeeklyScheduleCountQuery");
  const { sql } = buildActiveBalletWeeklyScheduleCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  for (const clause of ["status", "day_of_week", "start_time", "end_time", "duration_mins"]) {
    assert.match(normalized, new RegExp(clause));
  }
  assert.match(normalized, /duration_mins[^)]*>/);
});

test("public summary and Classes routes use the shared operational predicates", () => {
  const source = readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/ballet.ts"), "utf8");

  assert.match(source, /buildActiveBalletWeeklyScheduleCountQuery\(\)/);
  assert.match(source, /weeklySchedules:\s*weeklySchedules\?\.total/);
  assert.match(source, /classes:\s*weeklySchedules\?\.total/);
  assert.match(source, /\.where\(isOperationalBalletClass\(\)\)/);
  assert.match(source, /scheduleShapeCondition\(\)/);
});
