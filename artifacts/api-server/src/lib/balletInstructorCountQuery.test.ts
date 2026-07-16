import assert from "node:assert/strict";
import test from "node:test";

// Builds the real query object used by GET /api/ballet/summary and inspects
// its compiled SQL via .toSQL() — this never opens a network connection, so
// a fake DATABASE_URL is enough to satisfy @workspace/db's module-load-time
// check (matches the pattern in ./classCapacity.test.ts).
process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

test("active Ballet instructor count query has no JOIN — an instructor with no class/schedule is still counted", async () => {
  const { buildActiveBalletInstructorCountQuery } = await import("./balletInstructorCountQuery");
  const { sql } = buildActiveBalletInstructorCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  assert.equal(normalized.includes("join"), false, "must not join through classes/schedules");
  assert.equal(normalized.includes("ballet_classes"), false);
  assert.equal(normalized.includes("ballet_schedules"), false);
});

test("active Ballet instructor count query counts ballet_instructors rows directly — linking multiple classes cannot inflate it", async () => {
  const { buildActiveBalletInstructorCountQuery } = await import("./balletInstructorCountQuery");
  const { sql } = buildActiveBalletInstructorCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  // No join means no row fan-out; count(*) over ballet_instructors alone
  // is inherently one row per instructor regardless of how many classes
  // (or schedules) that instructor is linked to elsewhere.
  assert.match(normalized, /from\s+"ballet_instructors"/);
});

test("active Ballet instructor count query only ever reads ballet_instructors — a general Studio instructor cannot be counted", async () => {
  const { buildActiveBalletInstructorCountQuery } = await import("./balletInstructorCountQuery");
  const { sql } = buildActiveBalletInstructorCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  // The generic `instructors` table (Studio instructors not registered as
  // Ballet instructors) is never referenced by this query at all.
  assert.equal(/from\s+"instructors"/.test(normalized), false);
});

test("active Ballet instructor count query filters is_active = true — an inactive instructor is excluded", async () => {
  const { buildActiveBalletInstructorCountQuery } = await import("./balletInstructorCountQuery");
  const { sql, params } = buildActiveBalletInstructorCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  assert.match(normalized, /"is_active"\s*=/);
  assert.equal(params.includes(true), true);
});

test("active Ballet instructor count query has no LIMIT/OFFSET — pagination cannot affect the count", async () => {
  const { buildActiveBalletInstructorCountQuery } = await import("./balletInstructorCountQuery");
  const { sql } = buildActiveBalletInstructorCountQuery().toSQL();
  const normalized = sql.toLowerCase();

  assert.equal(normalized.includes("limit"), false);
  assert.equal(normalized.includes("offset"), false);
});
