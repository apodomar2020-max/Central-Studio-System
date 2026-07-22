import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { requireStudentAuth } from "../middlewares/studentAuth";
import {
  buildMyBalletClassesResponse,
  selectAuthoritativeBalletApplication,
  type BalletMyClassesApplicationRow,
  type BalletMyClassesAssignmentRow,
  type BalletMyClassesClassRow,
  type BalletMyClassesScheduleRow,
} from "./balletMyClasses";

const now = "2026-07-22T12:00:00.000Z";
const application = (id: number, childId: number | null, overrides: Partial<BalletMyClassesApplicationRow> = {}): BalletMyClassesApplicationRow => ({
  id,
  parentStudentId: 10,
  childId,
  childName: `Child ${childId ?? id}`,
  childBirthday: "2018-01-01",
  status: "active",
  assignedLevelId: 20,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const assignment = (applicationId: number, groupId = 30, overrides: Partial<BalletMyClassesAssignmentRow> = {}): BalletMyClassesAssignmentRow => ({
  id: applicationId + 100,
  applicationId,
  childId: applicationId - 10,
  levelId: 20,
  groupId,
  status: "active",
  levelName: "Level One",
  levelIsActive: true,
  groupName: `Group ${groupId}`,
  groupLevelId: 20,
  groupIsActive: true,
  ...overrides,
});
const balletClass = (id: number, groupId = 30, overrides: Partial<BalletMyClassesClassRow> = {}): BalletMyClassesClassRow => ({
  id,
  title: `Class ${id}`,
  levelId: 20,
  groupId,
  classImageUrl: null,
  classVideoUrl: null,
  isActive: true,
  isLegacy: false,
  levelName: "Level One",
  levelIsActive: true,
  groupName: `Group ${groupId}`,
  groupLevelId: 20,
  groupIsActive: true,
  instructorId: 40,
  instructorName: "Teacher",
  instructorPhotoUrl: null,
  instructorIsActive: true,
  ...overrides,
});
const schedule = (id: number, classId: number, dayOfWeek: number, overrides: Partial<BalletMyClassesScheduleRow> = {}): BalletMyClassesScheduleRow => ({
  id,
  classId,
  dayOfWeek,
  startTime: "16:00",
  endTime: "17:00",
  durationMins: 60,
  status: "active",
  ...overrides,
});

function build(overrides: Partial<Parameters<typeof buildMyBalletClassesResponse>[0]> = {}) {
  return buildMyBalletClassesResponse({
    parentStudentId: 10,
    children: [{ id: 1, parentId: 10, fullName: "Maya" }],
    applications: [application(11, 1)],
    assignments: [assignment(11)],
    activeSubscriptionApplicationIds: new Set([11]),
    classes: [balletClass(50)],
    schedules: [schedule(60, 50, 0)],
    ...overrides,
  });
}

test("authenticated endpoint requires verified student auth and derives identity from req.studentId", () => {
  const source = readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/ballet.ts"), "utf8");
  const route = source.slice(source.indexOf('"/ballet/classes/my"'), source.indexOf("// ─── GET /api/ballet/applications/my"));
  assert.match(route, /requireStudentAuth/);
  assert.match(route, /requireVerifiedStudent/);
  assert.match(route, /const parentStudentId = req\.studentId!/);
  assert.match(route, /eq\(childrenTable\.parentId, parentStudentId\)/);
  assert.match(route, /eq\(balletApplicationsTable\.parentStudentId, parentStudentId\)/);
  assert.doesNotMatch(route, /req\.(query|body|params).*parent|parentStudentId\s*=\s*req\.(query|body|params)/);
});

test("unauthenticated student request is rejected before an entitlement query can run", () => {
  let statusCode = 0;
  let body: unknown;
  let nextCalled = false;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  requireStudentAuth({} as never, response as never, (() => { nextCalled = true; }) as never);
  assert.equal(statusCode, 401);
  assert.equal(nextCalled, false);
  assert.match(JSON.stringify(body), /Student authentication required/);
});

test("account receives only owned children and foreign linked applications are ignored", () => {
  const result = build({
    children: [
      { id: 1, parentId: 10, fullName: "Maya" },
      { id: 2, parentId: 99, fullName: "Foreign Child" },
    ],
    applications: [application(11, 1), application(12, 2), application(13, 2, { parentStudentId: 99 })],
  });
  assert.deepEqual(result.children.map((child) => child.childId), [1]);
  assert.equal(JSON.stringify(result).includes("Foreign Child"), false);
});

test("response is minimal and excludes application contact, medical, and payment details", () => {
  const json = JSON.stringify(build());
  for (const field of ["parentEmail", "parentPhone", "medicalNotes", "emergencyContact", "paymentId", "subscriptionExpiresAt"]) {
    assert.equal(json.includes(field), false);
  }
});

test("children with no application remain selectable with no Classes", () => {
  const [child] = build({ applications: [], assignments: [], activeSubscriptionApplicationIds: new Set() }).children;
  assert.equal(child.entitlementState, "no_application");
  assert.equal(child.weeklyScheduleCount, 0);
  assert.deepEqual(child.classes, []);
});

test("one canonical child remains one selector entry across repeated applications", () => {
  const active = application(11, 1, { updatedAt: "2026-01-01T00:00:00.000Z" });
  const latestTerminal = application(12, 1, { status: "withdrawn", updatedAt: "2026-07-01T00:00:00.000Z" });
  const olderTerminal = application(13, 1, { status: "cancelled", updatedAt: "2025-12-01T00:00:00.000Z" });
  const result = build({ applications: [latestTerminal, active, olderTerminal] });
  assert.equal(result.children.length, 1);
  assert.equal(result.children[0].selectorKey, "child:1");
  assert.equal(result.children[0].applicationId, active.id);
  assert.equal(result.children[0].weeklyScheduleCount, 1);
});

test("authoritative application prioritizes active, then latest open, then latest terminal", () => {
  const active = application(11, 1, { updatedAt: "2025-01-01T00:00:00.000Z" });
  const latestOpen = application(12, 1, { status: "accepted", updatedAt: "2026-06-01T00:00:00.000Z" });
  const latestTerminal = application(13, 1, { status: "withdrawn", updatedAt: "2026-07-01T00:00:00.000Z" });
  assert.equal(selectAuthoritativeBalletApplication([latestTerminal, latestOpen, active])?.id, active.id);
  assert.equal(selectAuthoritativeBalletApplication([latestTerminal, latestOpen])?.id, latestOpen.id);
  assert.equal(selectAuthoritativeBalletApplication([latestTerminal])?.id, latestTerminal.id);
});

test("duplicate source rows for one owned childId collapse to one canonical selector", () => {
  const result = build({ children: [
    { id: 1, parentId: 10, fullName: "Maya" },
    { id: 1, parentId: 10, fullName: "Maya" },
    { id: 1, parentId: 10, fullName: "Maya Joined Again" },
  ] });
  assert.equal(result.children.length, 1);
  assert.equal(result.children[0].childId, 1);
});

test("different canonical child IDs remain separate even with identical names and birthdays", () => {
  const result = build({
    children: [
      { id: 1, parentId: 10, fullName: "Omar" },
      { id: 2, parentId: 10, fullName: "Omar" },
    ],
    applications: [
      application(11, 1, { childName: "Omar", childBirthday: "2018-01-01" }),
      application(12, 2, { childName: "Omar", childBirthday: "2018-01-01" }),
    ],
    assignments: [assignment(11), assignment(12, 30, { childId: 2 })],
    activeSubscriptionApplicationIds: new Set([11, 12]),
  });
  assert.deepEqual(result.children.map((child) => child.selectorKey), ["child:1", "child:2"]);
});

test("childId-less applications never create selector entries", () => {
  const result = build({
    applications: [application(11, 1), application(99, null, { childName: "Omar", status: "pending" })],
  });
  assert.deepEqual(result.children.map((child) => child.selectorKey), ["child:1"]);
  assert.equal(result.children.some((child) => child.applicationId === 99), false);
});

test("selected-child application flow reuses the canonical child instead of inserting another", () => {
  const routeSource = readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/ballet.ts"), "utf8");
  const submitRoute = routeSource.slice(routeSource.indexOf('"/ballet/applications"'), routeSource.indexOf("// ─── PATCH /api/ballet/applications/:id"));
  const mobileSource = readFileSync(resolve(process.cwd(), "artifacts/central/app/ballet/assessment.tsx"), "utf8");
  assert.match(submitRoute, /if \(childId != null\)[\s\S]*eq\(childrenTable\.id, childId\)[\s\S]*eq\(childrenTable\.parentId, parentStudentId\)/);
  assert.match(submitRoute, /if \(childId == null\)[\s\S]*insert\(childrenTable\)/);
  assert.match(mobileSource, /childId: selectedChildId/);
});

test("pending, assessment, placement, and terminal lifecycle states never receive current Classes", () => {
  const cases = [
    ["pending", "application_pending"],
    ["needsFollowUp", "assessment_pending"],
    ["accepted", "assignment_pending"],
    ["rejected", "rejected"],
    ["cancelled", "cancelled"],
    ["withdrawn", "withdrawn"],
  ] as const;
  for (const [status, expected] of cases) {
    const [child] = build({ applications: [application(11, 1, { status })] }).children;
    assert.equal(child.entitlementState, expected);
    assert.deepEqual(child.classes, []);
  }
});

test("Level-only, groupless, inactive relationship, payment, and activation gaps block entitlement", () => {
  assert.equal(build({ assignments: [] }).children[0].entitlementState, "assignment_pending");
  assert.equal(build({ assignments: [assignment(11, null as unknown as number)] }).children[0].entitlementState, "assignment_pending");
  assert.equal(build({ assignments: [assignment(11, 30, { groupLevelId: 99 })] }).children[0].entitlementState, "assignment_pending");
  assert.equal(build({ assignments: [assignment(11, 30, { childId: 999 })] }).children[0].entitlementState, "assignment_pending");
  assert.equal(build({ activeSubscriptionApplicationIds: new Set() }).children[0].entitlementState, "payment_pending");
  assert.equal(build({ applications: [application(11, 1, { status: "assignedToLevel" })] }).children[0].entitlementState, "activation_pending");
});

test("active child receives only Classes matching both assigned Level and Group", () => {
  const [child] = build({
    classes: [
      balletClass(50, 30),
      balletClass(51, 31),
      balletClass(52, 30, { levelId: 21, groupLevelId: 21 }),
    ],
    schedules: [schedule(60, 50, 0), schedule(61, 51, 1), schedule(62, 52, 2)],
  }).children;
  assert.deepEqual(child.classes.map((item) => item.id), [50]);
  assert.equal(child.weeklyScheduleCount, 1);
});

test("same-Level children in different Groups remain isolated", () => {
  const result = build({
    children: [{ id: 1, parentId: 10, fullName: "Maya" }, { id: 2, parentId: 10, fullName: "Nora" }],
    applications: [application(11, 1), application(12, 2)],
    assignments: [assignment(11, 30), assignment(12, 31)],
    activeSubscriptionApplicationIds: new Set([11, 12]),
    classes: [balletClass(50, 30), balletClass(51, 31)],
    schedules: [schedule(60, 50, 0), schedule(61, 51, 1)],
  });
  assert.deepEqual(result.children.map((child) => child.classes.map((item) => item.id)), [[50], [51]]);
});

test("changing the active assigned Group changes the entitled Classes", () => {
  const common = {
    classes: [balletClass(50, 30), balletClass(51, 31)],
    schedules: [schedule(60, 50, 0), schedule(61, 51, 1)],
  };
  const before = build({ ...common, assignments: [assignment(11, 30)] }).children[0];
  const after = build({ ...common, assignments: [assignment(11, 31)] }).children[0];
  assert.deepEqual(before.classes.map((item) => item.id), [50]);
  assert.deepEqual(after.classes.map((item) => item.id), [51]);
});

test("children in the same Level and Group receive the same Classes independently", () => {
  const result = build({
    children: [{ id: 1, parentId: 10, fullName: "Maya" }, { id: 2, parentId: 10, fullName: "Nora" }],
    applications: [application(11, 1), application(12, 2)],
    assignments: [assignment(11), assignment(12)],
    activeSubscriptionApplicationIds: new Set([11, 12]),
  });
  assert.deepEqual(result.children.map((child) => child.classes.map((item) => item.id)), [[50], [50]]);
  assert.notEqual(result.children[0].selectorKey, result.children[1].selectorKey);
});

test("one Class preserves three sorted Schedules and counts them once", () => {
  const [child] = build({ schedules: [schedule(63, 50, 4), schedule(61, 50, 0), schedule(62, 50, 2), schedule(62, 50, 2)] }).children;
  assert.equal(child.classes.length, 1);
  assert.deepEqual(child.classes[0].schedules.map((item) => item.id), [61, 62, 63]);
  assert.equal(child.weeklyScheduleCount, 3);
  assert.equal(child.classes[0].schedule?.id, 61);
});

test("cancelled, malformed, and invalid operational relationships are excluded", () => {
  const [child] = build({
    classes: [
      balletClass(50),
      balletClass(51, 30, { isLegacy: true }),
      balletClass(52, 30, { isActive: false }),
      balletClass(53, 30, { instructorIsActive: false }),
      balletClass(54, 30, { groupIsActive: false }),
    ],
    schedules: [
      schedule(60, 50, 0),
      schedule(61, 50, 1, { status: "cancelled" }),
      schedule(62, 50, 2, { endTime: "15:00", durationMins: -60 }),
      schedule(63, 51, 0), schedule(64, 52, 0), schedule(65, 53, 0), schedule(66, 54, 0),
    ],
  }).children;
  assert.deepEqual(child.classes.map((item) => item.id), [50]);
  assert.deepEqual(child.classes[0].schedules.map((item) => item.id), [60]);
});

test("active child without an operational Class receives schedule_pending", () => {
  const [child] = build({ schedules: [] }).children;
  assert.equal(child.entitlementState, "schedule_pending");
  assert.equal(child.weeklyScheduleCount, 0);
  assert.deepEqual(child.classes, []);
});
