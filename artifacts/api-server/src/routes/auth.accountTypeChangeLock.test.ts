import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authRoute = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
const eligibility = readFileSync(new URL("../lib/accountTypeChangeEligibility.ts", import.meta.url), "utf8");

test("the account-type policy is available to mobile and enforced before a changed type is saved", () => {
  assert.match(authRoute, /router\.get\("\/auth\/account-type-change-policy"/);
  assert.match(authRoute, /parsed\.data\.accountType !== existing\.accountType/);
  assert.match(authRoute, /await getAccountTypeChangePolicy\(existing\.id\)/);
  assert.match(authRoute, /code: "ACCOUNT_TYPE_CHANGE_LOCKED"/);
});

test("only real child class history locks the general-class branch", () => {
  assert.match(eligibility, /innerJoin\(childrenTable, eq\(bookingsTable\.participantChildId, childrenTable\.id\)\)/);
  assert.match(eligibility, /eq\(childrenTable\.parentId, studentId\)/);
  assert.match(eligibility, /isNotNull\(bookingsTable\.classId\)/);
  assert.match(eligibility, /"pending"[\s\S]*"confirmed"[\s\S]*"attended"[\s\S]*"completed"/);
  assert.doesNotMatch(eligibility, /"cancelled"|"rejected"/);
});

test("any ballet application owned by the account locks the ballet branch", () => {
  assert.match(eligibility, /eq\(balletApplicationsTable\.parentStudentId, studentId\)/);
});

test("profile edits cannot replace analytics-only dance interests", () => {
  const profileBody = authRoute.slice(
    authRoute.indexOf("const ProfileBody"),
    authRoute.indexOf("// POST /api/auth/register"),
  );
  const profilePatch = authRoute.slice(
    authRoute.indexOf('router.patch("/auth/profile"'),
    authRoute.indexOf("// ─── PUT /api/auth/dance-interests"),
  );

  assert.doesNotMatch(profileBody, /danceTypeIds/);
  assert.doesNotMatch(profilePatch, /studentDanceInterestsTable|danceTypeIds/);
  assert.match(authRoute, /router\.put\("\/auth\/dance-interests"/);
});

test("profile city and nationality accept only canonical list values", () => {
  assert.match(authRoute, /city: ProfileCitySchema\.optional\(\)/);
  assert.match(authRoute, /nationality: ProfileNationalitySchema\.optional\(\)/);
});
