import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMyBalletClassesResponse,
  resolveBalletChildSelection,
  selectedBalletChild,
} from "./balletMyClassesModel";

const schedule = (id: number, dayOfWeek: number, overrides: Record<string, unknown> = {}) => ({
  id,
  dayOfWeek,
  startTime: "16:00",
  endTime: "17:00",
  durationMins: 60,
  status: "active",
  ...overrides,
});
const balletClass = (id: number, groupId: number, schedules: unknown[]) => ({
  id,
  title: `Class ${id}`,
  levelId: 20,
  groupId,
  classImageUrl: null,
  classVideoUrl: null,
  level: { id: 20, name: "Level One" },
  group: { id: groupId, name: `Group ${groupId}`, levelId: 20 },
  instructor: { id: 40, name: "Teacher", photoUrl: null, isActive: true },
  schedules,
  schedule: schedules[0] ?? null,
});
const child = (selectorKey: string, groupId: number, overrides: Record<string, unknown> = {}) => ({
  selectorKey,
  childId: Number(selectorKey.split(":")[1]),
  applicationId: Number(selectorKey.split(":")[1]) + 100,
  childName: `Child ${selectorKey}`,
  applicationStatus: "active",
  entitlementState: "active",
  level: { id: 20, name: "Level One" },
  group: { id: groupId, name: `Group ${groupId}` },
  weeklyScheduleCount: 999,
  classes: [balletClass(groupId, groupId, [schedule(groupId * 10, 0)])],
  ...overrides,
});

test("selected children remain isolated by stable selector key", () => {
  const response = normalizeMyBalletClassesResponse({ children: [child("child:1", 30), child("child:2", 31)] });
  assert.deepEqual(selectedBalletChild(response.children, "child:1")?.classes.map((item) => item.groupId), [30]);
  assert.deepEqual(selectedBalletChild(response.children, "child:2")?.classes.map((item) => item.groupId), [31]);
});

test("same Level and Group remain independently selectable", () => {
  const response = normalizeMyBalletClassesResponse({ children: [child("child:1", 30), child("child:2", 30)] });
  assert.equal(response.children.length, 2);
  assert.notEqual(response.children[0].selectorKey, response.children[1].selectorKey);
  assert.deepEqual(response.children.map((item) => item.weeklyScheduleCount), [1, 1]);
});

test("one Class with three Schedules remains one card with count three", () => {
  const response = normalizeMyBalletClassesResponse({ children: [child("child:1", 30, {
    classes: [balletClass(50, 30, [schedule(3, 4), schedule(1, 0), schedule(2, 2)])],
  })] });
  const selected = response.children[0];
  assert.equal(selected.classes.length, 1);
  assert.deepEqual(selected.classes[0].schedules.map((item) => item.id), [1, 2, 3]);
  assert.equal(selected.weeklyScheduleCount, 3);
});

test("array data wins over singular aliases and duplicate IDs do not inflate the count", () => {
  const response = normalizeMyBalletClassesResponse({ children: [child("child:1", 30, {
    classes: [{
      ...balletClass(50, 30, [schedule(1, 0), schedule(1, 0)]),
      schedule: schedule(99, 5),
    }],
  })] });
  assert.deepEqual(response.children[0].classes[0].schedules.map((item) => item.id), [1]);
  assert.equal(response.children[0].weeklyScheduleCount, 1);
});

test("cancelled and invalid Schedules are removed before the selected-child count", () => {
  const response = normalizeMyBalletClassesResponse({ children: [child("child:1", 30, {
    classes: [balletClass(50, 30, [
      schedule(1, 0),
      schedule(2, 1, { status: "cancelled" }),
      schedule(3, 2, { endTime: "15:00", durationMins: -60 }),
    ])],
  })] });
  assert.equal(response.children[0].weeklyScheduleCount, 1);
});

test("current non-active lifecycle states remain selectable without downloaded Class data", () => {
  const cases = [
    ["pending", "application_pending"],
    ["needsFollowUp", "assessment_pending"],
    ["accepted", "assignment_pending"],
    ["assignedToLevel", "payment_pending"],
    ["assignedToLevel", "activation_pending"],
    ["active", "schedule_pending"],
  ] as const;
  for (const [applicationStatus, entitlementState] of cases) {
    const response = normalizeMyBalletClassesResponse({ children: [child("child:1", 30, { applicationStatus, entitlementState })] });
    assert.equal(response.children.length, 1);
    assert.deepEqual(response.children[0].classes, []);
    assert.equal(response.children[0].weeklyScheduleCount, 0);
  }
});

test("stale general-account and terminal rows cannot populate the selector", () => {
  const response = normalizeMyBalletClassesResponse({ children: [
    child("child:1", 30, { applicationId: null, applicationStatus: null, entitlementState: "no_application" }),
    child("child:2", 30, { applicationStatus: "rejected", entitlementState: "rejected" }),
    child("child:3", 30, { applicationStatus: "cancelled", entitlementState: "cancelled" }),
    child("child:4", 30, { applicationStatus: "withdrawn", entitlementState: "withdrawn" }),
    child("child:5", 30, { applicationStatus: "pending", entitlementState: "application_pending", classes: [] }),
  ] });
  assert.deepEqual(response.children.map((item) => item.selectorKey), ["child:5"]);
});

test("selection is preserved after refresh and falls back deterministically", () => {
  const children = normalizeMyBalletClassesResponse({ children: [
    child("child:1", 30, { entitlementState: "application_pending", classes: [] }),
    child("child:2", 31),
  ] }).children;
  assert.equal(resolveBalletChildSelection(children, "child:1"), "child:1");
  assert.equal(resolveBalletChildSelection(children, "missing"), "child:2");
  assert.equal(resolveBalletChildSelection([], "child:1"), null);
});

test("duplicate selector rows collapse without combining two children", () => {
  const response = normalizeMyBalletClassesResponse({ children: [child("child:1", 30), child("child:1", 31)] });
  assert.equal(response.children.length, 1);
  assert.deepEqual(response.children[0].classes.map((item) => item.groupId), [30]);
});

test("duplicate API rows collapse by childId even when their supplied selector keys differ", () => {
  const response = normalizeMyBalletClassesResponse({ children: [
    child("child:1", 30),
    child("application:999", 31, { childId: 1 }),
  ] });
  assert.equal(response.children.length, 1);
  assert.equal(response.children[0].selectorKey, "child:1");
  assert.equal(response.children[0].weeklyScheduleCount, 1);
});

test("childId-less application compatibility rows are excluded", () => {
  const response = normalizeMyBalletClassesResponse({ children: [
    child("application:999", 30, { childId: null, childName: "Omar" }),
  ] });
  assert.deepEqual(response.children, []);
});

test("selector identity is derived only from childId", () => {
  const response = normalizeMyBalletClassesResponse({ children: [
    child("application:999", 30, { childId: 1, childName: "Omar" }),
  ] });
  assert.equal(response.children[0].selectorKey, "child:1");
});

test("same-name children remain separate when their canonical IDs differ", () => {
  const response = normalizeMyBalletClassesResponse({ children: [
    child("ignored", 30, { childId: 1, applicationId: 101, childName: "Omar" }),
    child("also-ignored", 31, { childId: 2, applicationId: 102, childName: "Omar" }),
  ] });
  assert.deepEqual(response.children.map((item) => item.selectorKey), ["child:1", "child:2"]);
});
