/**
 * GET /api/admin/ballet/students — Data Tables Enhancement query-schema and
 * dedup-safety regression coverage.
 *
 * These are lightweight (no live DB) tests, matching the established style
 * of adminBalletSchedules.test.ts: schema-level validation via direct
 * import, plus source-text assertions that guard the load-bearing safety
 * invariant — search/filter conditions must apply to the OUTER query
 * (after "where rn = 1"), never inside the currentBalletStudentsCte's
 * partition/order, which would corrupt which historical assignment wins
 * the per-student dedup.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

const routeSource = () => readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/adminBallet.ts"), "utf8");

test("StudentsListQuerySchema accepts valid optional controls and rejects out-of-enum values", async () => {
  const { StudentsListQuerySchema } = await import("./adminBallet");

  assert.equal(StudentsListQuerySchema.safeParse({}).success, true, "all controls are optional — bare pagination must still work");

  const full = StudentsListQuerySchema.safeParse({
    page: "2",
    limit: "20",
    search: "maria",
    levelId: "3",
    groupId: "7",
    paymentStatus: "paid",
    subscriptionStatus: "active",
    sort: "name",
  });
  assert.equal(full.success, true);

  assert.equal(StudentsListQuerySchema.safeParse({ paymentStatus: "bogus" }).success, false, "paymentStatus must be allow-listed");
  assert.equal(StudentsListQuerySchema.safeParse({ subscriptionStatus: "bogus" }).success, false, "subscriptionStatus must be allow-listed");
  assert.equal(StudentsListQuerySchema.safeParse({ sort: "bogus" }).success, false, "sort must be allow-listed");
  assert.equal(StudentsListQuerySchema.safeParse({ levelId: "not-a-number" }).success, false);
});

test("StudentsListQuerySchema defaults sort to dateJoined (preserves the pre-existing default ordering)", async () => {
  const { StudentsListQuerySchema } = await import("./adminBallet");
  const parsed = StudentsListQuerySchema.safeParse({});
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.sort, "dateJoined");
});

test("search/level/group/payment/subscription conditions apply to the outer query only, never inside the CTE's partition/order", () => {
  const source = routeSource();

  const cteStart = source.indexOf("const currentBalletStudentsCte = sql`");
  assert.notEqual(cteStart, -1, "currentBalletStudentsCte definition must exist");
  const cteEnd = source.indexOf("`;", cteStart);
  const cteBody = source.slice(cteStart, cteEnd);

  // The CTE's own text must never reference the new filter params directly —
  // it must stay defined purely by ballet_applications.status/assignment
  // status, exactly as before this change.
  for (const forbidden of ["outerConditions", "whereClause", "paymentStatus", "subscriptionStatus", "searchClauses"]) {
    assert.ok(!cteBody.includes(forbidden), `CTE body must not reference "${forbidden}" — filters belong to the outer query only`);
  }

  // The outer paginated query and the count query must both apply
  // whereClause AFTER "where rn = 1", not before/inside it.
  const outerQueryMatches = [...source.matchAll(/where rn = 1 \$\{whereClause\}/g)];
  assert.ok(outerQueryMatches.length >= 2, "both the page query and the count query must filter after \"where rn = 1\"");
});

test("payment/subscription filters resolve matching applicationIds before the outer query runs (resolved-IDs pattern, not post-pagination filtering)", () => {
  const source = routeSource();
  const handlerStart = source.indexOf('router.get("/admin/ballet/students"');
  assert.notEqual(handlerStart, -1);
  const handlerBody = source.slice(handlerStart, handlerStart + 4000);

  const candidatesIdx = handlerBody.indexOf("getLatestPaymentByApplicationIds(candidateIds)");
  const pageQueryIdx = handlerBody.indexOf("db.execute<BalletStudentListRow>");
  assert.notEqual(candidatesIdx, -1, "must resolve candidate applicationIds' payments before running the paginated query");
  assert.ok(candidatesIdx < pageQueryIdx, "candidate resolution must happen before the paginated page query, not after");
});
