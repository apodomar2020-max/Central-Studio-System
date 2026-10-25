import assert from "node:assert/strict";
import { test } from "node:test";
import { canCreateChildProfile, canStartBalletApplication, capacityErrorKind, createAccountRequestScope } from "../../services/accountCapacity";
import { selectAuthoritativeBalletApplications, selectEligibleBalletChildren } from "../../components/ballet/balletStudentPreviewModel";
import { capacityHarness, nodes, text } from "../accountCapacityHarness";
const child = (id = "1") => ({ id, fullName: "Test Child", birthday: "2018-01-01", age: 8, gender: "female" });
const user = (id = "owner") => ({ id, accountType: "parent", fullName: "Test Parent", profileCompleted: true });
const app = (id: number, status = "pending", childId: number | null = id): any => ({ id, childId, status, childName: "Test Child", childBirthday: "2018-01-01", updatedAt: "2026-10-01", createdAt: "2026-10-01" });
const context = (count: number, ready = true): any => ({ user: user(), children: Array.from({ length: count }, (_, i) => child(String(i + 1))), childrenReady: ready, refreshChildren: async () => {}, bookings: [], userPackages: [], refreshUserPackages: async () => {} });

for (const count of [0, 1, 3, 4, 5]) {
  test(`child capacity at ${count} profiles and unknown/offline state`, () => {
    assert.equal(canCreateChildProfile(count, true), count < 4);
    assert.equal(canCreateChildProfile(count, false), false);
  });
  for (const file of ["app/(tabs)/profile.tsx", "app/onboarding/children.tsx"]) test(`${file}: actual creation controls at ${count} profiles`, () => {
    const h = capacityHarness(file, { context: context(count) });
    const tree = h.render(h.module.default);
    const actions = nodes(tree, n => n.type === "TouchableOpacity" && /^(\+ Add Child|Add Child|Add (another|a) child|Save Child)$/.test(text(n)));
    assert.equal(actions.length, count < 4 ? 1 : 0);
    if (file.includes("profile") && count >= 4) assert.equal(nodes(tree, n => typeof n.type === "function" && n.type.name === "ChildCard").length, count);
  });
}

test("Profile and onboarding hide creation when child ownership/count is unknown", () => {
  for (const file of ["app/(tabs)/profile.tsx", "app/onboarding/children.tsx"]) {
    const h = capacityHarness(file, { context: context(0, false) });
    assert.equal(nodes(h.render(h.module.default), n => n.type === "TouchableOpacity" && /Add Child|Save Child/.test(text(n))).length, 0);
  }
});

test("Ballet capacity: saved profiles and current journeys have separate limits", () => {
  for (const current of [0, 1, 2, 3]) {
    assert.equal(canStartBalletApplication(current, 1, false), current < 2);
    assert.equal(canStartBalletApplication(current, 0, true), current < 2);
    assert.equal(canStartBalletApplication(current, 0, false), false);
    assert.equal(canStartBalletApplication(current, 1, true, false), false);
  }
  assert.equal(canStartBalletApplication(1, 3, canCreateChildProfile(4, true)), true);
  assert.equal(canCreateChildProfile(3, true), true); // Ballet capacity never removes Profile creation.
});

test("all five current statuses count; terminal history permits reapplication", () => {
  for (const status of ["pending", "needsFollowUp", "accepted", "assignedToLevel", "active", "rejected", "cancelled", "withdrawn"]) {
    const current = !["rejected", "cancelled", "withdrawn"].includes(status);
    assert.equal(selectAuthoritativeBalletApplications([app(1, status)]).length, current ? 1 : 0);
    assert.equal(selectEligibleBalletChildren({ children: [child()], applications: [app(1, status)], blockingStatuses: new Set(["pending", "needsFollowUp", "accepted", "assignedToLevel", "active"]) }).length, current ? 0 : 1);
  }
});

test("linked IDs remain distinct; only unlinked records use legacy snapshot fallback", () => {
  const apps = [app(1), app(2), app(3, "active", 1), app(4, "pending", null), app(5, "accepted", null)];
  assert.equal(selectAuthoritativeBalletApplications(apps).length, 3);
  const input = { children: [child("2")], blockingStatuses: new Set(["pending"]) };
  assert.equal(selectEligibleBalletChildren({ ...input, applications: [app(1)] }).length, 1);
  assert.equal(selectEligibleBalletChildren({ ...input, applications: [app(4, "pending", null)] }).length, 0);
});

test("422 capacity contracts stay distinct from duplicate 409 and unrelated validation", () => {
  assert.equal(capacityErrorKind({ status: 422, data: { code: "CHILD_PROFILE_LIMIT_REACHED", limit: 4, currentCount: 4 } }), "child");
  assert.equal(capacityErrorKind({ status: 422, data: { code: "BALLET_CHILD_LIMIT_REACHED", limit: 2, currentCount: 2 } }), "ballet");
  assert.equal(capacityErrorKind({ status: 409, data: { code: "DUPLICATE_APPLICATION" } }), null);
  assert.equal(capacityErrorKind({ status: 422, data: { code: "INVALID_CHILD" } }), null);
});

test("late responses and A → B → A account switches cannot reuse eligibility", () => {
  const scope = createAccountRequestScope();
  scope.setAccount("A"); const a = scope.capture(); const first = scope.beginRead(); const second = scope.beginRead();
  assert.equal(first(), false); assert.equal(second(), true);
  scope.invalidateReads(); assert.equal(second(), false); assert.equal(a(), true);
  scope.setAccount("B"); scope.setAccount("A"); assert.equal(a(), false);
  scope.setAccount(null); assert.equal(scope.capture()(), false);
});

test("Profile modal retains fields after rejected creation and closes only after a saved child", async () => {
  const h = capacityHarness("app/(tabs)/profile.tsx"); let saved = false, closed = 0;
  const props = { visible: true, canCreate: true, initial: child(), onClose: () => closed++, onSave: async () => saved };
  let tree = h.render(h.module.AddChildModal, props);
  nodes(tree, n => n.type === "TextInput" && n.props.value === "Test Child")[0].props.onChangeText("Entered Name");
  tree = h.render(h.module.AddChildModal, props);
  await nodes(tree, n => n.props.title === "Save")[0].props.onPress();
  assert.equal(closed, 0); assert.ok(nodes(h.render(h.module.AddChildModal, props), n => n.type === "TextInput" && n.props.value === "Entered Name").length);
  saved = true;
  await nodes(h.render(h.module.AddChildModal, props), n => n.props.title === "Save")[0].props.onPress();
  assert.equal(closed, 1);
});

test("editing at capacity remains enabled while an open creation form cannot save", () => {
  const h = capacityHarness("app/(tabs)/profile.tsx");
  const props = { visible: true, canCreate: false, onSave: async () => true, onClose() {} };
  assert.equal(nodes(h.render(h.module.AddChildModal, props), n => n.props.title === "Save")[0].props.disabled, true);
  assert.equal(nodes(h.render(h.module.AddChildModal, { ...props, initial: child() }), n => n.props.title === "Save")[0].props.disabled, false);
});

test("onboarding failed save preserves entered fields; fourth-child success clears them", async () => {
  let result: any = null;
  const h = capacityHarness("app/onboarding/children.tsx", { context: { ...context(3), addChild: async () => result } });
  let tree = h.render(h.module.default);
  nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Add another child")[0].props.onPress();
  tree = h.render(h.module.default);
  for (const [placeholder, value] of [["Child's full name", "Entered Name"], ["DD", "01"], ["MM", "01"], ["YYYY", "2018"]]) nodes(tree, n => n.type === "TextInput" && n.props.placeholder === placeholder)[0].props.onChangeText(value);
  tree = h.render(h.module.default);
  await nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Save Child")[0].props.onPress();
  tree = h.render(h.module.default);
  assert.ok(nodes(tree, n => n.type === "TextInput" && n.props.value === "Entered Name").length);
  result = child("4");
  await nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Save Child")[0].props.onPress();
  assert.equal(nodes(h.render(h.module.default), n => n.type === "TextInput").length, 0);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function providerHarness(fetch: any) {
  const h = capacityHarness("contexts/AppContext.tsx", { fetch });
  const value = () => h.render(h.module.AppContextProvider, {}).props.value;
  return { ...h, value };
}
function defaultResponse(url: string) { return url === "/api/my/bookings" ? { data: [] } : []; }

test("actual provider presents fifth-child 422, refreshes capacity and returns failure", async () => {
  let count = 3;
  const h = providerHarness(async (url: string, init: any) => {
    if (url !== "/api/children") return defaultResponse(url);
    if (init?.method === "POST") { count = 4; throw { status: 422, data: { error: "Limit reached", code: "CHILD_PROFILE_LIMIT_REACHED", limit: 4, currentCount: 4 } }; }
    return { children: Array.from({ length: count }, (_, i) => child(String(i + 1))) };
  });
  await h.value().setUser(user()); await tick();
  assert.equal(h.value().children.length, 3);
  assert.equal(await h.value().addChild(child("new")), null);
  assert.equal(h.value().children.length, 4);
  assert.equal(h.value().childrenReady, true);
  assert.equal(h.alerts.at(-1).title, "Child Profile Limit Reached");
  assert.match(h.alerts.at(-1).message, /four child profiles/);
});

test("actual provider creates fourth child and allows editing at four", async () => {
  const rows = [child("1"), child("2"), child("3")];
  const h = providerHarness(async (url: string, init: any) => {
    if (url === "/api/children" && init?.method === "POST") { rows.push(child("4")); return { child: rows[3] }; }
    if (url === "/api/children/1" && init?.method === "PATCH") return { child: { ...rows[0], fullName: "Updated" } };
    if (url === "/api/children") return { children: rows };
    return defaultResponse(url);
  });
  await h.value().setUser(user()); await tick();
  assert.equal((await h.value().addChild(child("new"))).id, "4"); await tick();
  assert.equal(h.value().children.length, 4);
  assert.equal(canCreateChildProfile(h.value().children.length, h.value().childrenReady), false);
  assert.equal(await h.value().updateChild(child("1")), true);
  assert.ok(h.requests.some(r => r.url === "/api/children/1" && r.init.method === "PATCH"));
});

test("actual provider ignores old account list responses and leaves new account records intact", async () => {
  let owner = "A"; let resolveA: (data: any) => void = () => {};
  const h = providerHarness(async (url: string) => {
    if (url === "/api/children") return owner === "A" ? new Promise(resolve => { resolveA = resolve; }) : { children: [child("B-child")] };
    return defaultResponse(url);
  });
  await h.value().setUser(user("A"));
  owner = "B"; await h.value().setUser(user("B")); await tick();
  resolveA({ children: [child("A-child")] }); await tick();
  assert.equal(h.value().children.length, 1);
  assert.equal(h.value().children[0].id, "B-child");
  assert.equal(h.storage.get("childrenOwner"), "B");
});

test("actual provider suppresses late creation success after account switch", async () => {
  let resolvePost: (data: any) => void = () => {};
  const h = providerHarness(async (url: string, init: any) => {
    if (url === "/api/children" && init?.method === "POST") return new Promise(resolve => { resolvePost = resolve; });
    return url === "/api/children" ? { children: [] } : defaultResponse(url);
  });
  await h.value().setUser(user("A")); await tick();
  const pending = h.value().addChild(child("new"));
  await h.value().setUser(user("B")); await tick();
  resolvePost({ child: child("A-created") });
  assert.equal(await pending, null);
  assert.equal(h.value().children.length, 0);
  assert.equal(h.alerts.length, 0);
});

test("offline refresh preserves this account's visible data and disables creation", async () => {
  let offline = false;
  const h = providerHarness(async (url: string) => {
    if (url === "/api/children") { if (offline) throw new TypeError("offline"); return { children: [child()] }; }
    return defaultResponse(url);
  });
  await h.value().setUser(user()); await tick();
  offline = true; await h.value().refreshChildren();
  assert.equal(h.value().children.length, 1);
  assert.equal(h.value().childrenReady, false);
});

for (const count of [0, 1, 3, 4, 5]) test(`Ballet assessment creation control at ${count} saved profiles`, async () => {
  const h = capacityHarness("app/ballet/assessment.tsx", { context: context(count), services: { fetchMyApplications: async () => [], fetchBalletPackages: async () => [], fetchAvailableAssessmentSchedules: async () => [] } });
  h.render(h.module.BalletAssessmentForm); await h.runEffects();
  const tree = h.render(h.module.BalletAssessmentForm);
  assert.equal(nodes(tree, n => n.type === "TouchableOpacity" && text(n).startsWith("Add Another Child")).length, count < 4 ? 1 : 0);
});

for (const count of [0, 1, 2]) test(`Ballet assessment entry and selection at ${count} current journeys`, async () => {
  const h = capacityHarness("app/ballet/assessment.tsx", { context: context(3), services: { fetchMyApplications: async () => Array.from({ length: count }, (_, i) => app(i + 1)), fetchBalletPackages: async () => [], fetchAvailableAssessmentSchedules: async () => [] } });
  h.render(h.module.BalletAssessmentForm); await h.runEffects();
  const tree = h.render(h.module.BalletAssessmentForm);
  const cards = nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentChildCard");
  assert.equal(cards.length, 3);
  assert.equal(cards[2].props.disabled, count >= 2);
  assert.equal(nodes(tree, n => n.type === "TouchableOpacity" && text(n).startsWith("Add Another Child")).length, count < 2 ? 1 : 0);
});

for (const scenario of [
  { profiles: 0, journeys: 0, show: true },
  { profiles: 1, journeys: 1, show: true }, // can create another profile
  { profiles: 4, journeys: 1, show: true }, // eligible saved sibling
  { profiles: 3, journeys: 2, show: false },
  { profiles: 4, journeys: 2, show: false },
]) test(`landing eligibility for ${scenario.profiles} profiles / ${scenario.journeys} current journeys`, async () => {
  const h = capacityHarness("app/ballet/index.tsx", { context: context(scenario.profiles), services: {
    fetchMyApplications: async () => Array.from({ length: scenario.journeys }, (_, i) => app(i + 1)),
    fetchBalletApplicationDetail: async () => ({ currentPayment: null }), fetchBalletLevels: async () => [], fetchBalletGroups: async () => [], fetchBalletPackages: async () => [], fetchBalletSettings: async () => ({}),
  } });
  let tree = h.render(h.module.default);
  let props = nodes(tree, n => n.type === "BalletStudentPreviewSection")[0].props;
  assert.equal(props.eligibilityReady, false);
  await h.runEffects(); tree = h.render(h.module.default);
  props = nodes(tree, n => n.type === "BalletStudentPreviewSection")[0].props;
  assert.equal(canStartBalletApplication(props.students.length, props.eligibleChildCount, props.canCreateProfile, props.eligibilityReady), scenario.show);
});

async function readyAssessmentForSubmission(error: any) {
  let posts = 0;
  const appointment = { scheduleId: 7, date: "2026-11-10", startTime: "15:00", endTime: "16:00", time: "3:00 PM", location: "Studio", ageMin: 4, ageMax: 12 };
  const h = capacityHarness("app/ballet/assessment.tsx", { context: context(1), services: {
    fetchMyApplications: async () => [], fetchBalletPackages: async () => [], fetchAvailableAssessmentSchedules: async () => [appointment],
    submitBalletApplication: async () => { posts++; throw error; },
  } });
  let tree = h.render(h.module.BalletAssessmentForm); await h.runEffects(); tree = h.render(h.module.BalletAssessmentForm);
  nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentChildCard")[0].props.onPress();
  tree = h.render(h.module.BalletAssessmentForm); await h.runEffects(); tree = h.render(h.module.BalletAssessmentForm);
  nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Continue")[0].props.onPress();
  tree = h.render(h.module.BalletAssessmentForm);
  nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentAppointmentCard")[0].props.onPress();
  tree = h.render(h.module.BalletAssessmentForm);
  nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Continue")[0].props.onPress();
  tree = h.render(h.module.BalletAssessmentForm);
  nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Continue")[0].props.onPress();
  tree = h.render(h.module.BalletAssessmentForm);
  await nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Submit")[0].props.onPress();
  assert.equal(posts, 1);
  return h;
}

test("Ballet 422 capacity rejection retains Review form and never shows success", async () => {
  const h = await readyAssessmentForSubmission({ status: 422, data: { code: "BALLET_CHILD_LIMIT_REACHED", limit: 2, currentCount: 2 } });
  const tree = h.render(h.module.BalletAssessmentForm);
  assert.equal(h.alerts.at(-1).title, "Ballet Limit Reached");
  assert.ok(nodes(tree, n => n.type === "TouchableOpacity" && text(n) === "Submit").length);
  assert.equal(nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentSuccessSummaryCard").length, 0);
});

test("Ballet duplicate 409 preserves existing return-to-child recovery", async () => {
  const h = await readyAssessmentForSubmission({ status: 409, data: { code: "DUPLICATE_APPLICATION", error: "Already applied" } });
  const tree = h.render(h.module.BalletAssessmentForm);
  assert.equal(h.alerts.at(-1).title, "Already Applied");
  assert.ok(nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentChildCard").length);
  assert.equal(nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentSuccessSummaryCard").length, 0);
});

test("foreground lifecycle refresh removes and restores Ballet eligibility from canonical status changes", async () => {
  let applications = [app(1)];
  const h = capacityHarness("app/ballet/assessment.tsx", { context: context(3), services: { fetchMyApplications: async () => applications, fetchBalletPackages: async () => [], fetchAvailableAssessmentSchedules: async () => [] } });
  h.render(h.module.BalletAssessmentForm); await h.runEffects();
  applications = [app(1), app(2)]; h.foreground(); await tick();
  let tree = h.render(h.module.BalletAssessmentForm);
  assert.equal(nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentChildCard")[2].props.disabled, true);
  applications = [app(1, "cancelled"), app(2, "withdrawn")]; h.foreground(); await tick();
  tree = h.render(h.module.BalletAssessmentForm);
  assert.equal(nodes(tree, n => n.type === "@/components/ballet/BalletAssessmentChildCard")[2].props.disabled, false);
  assert.ok(nodes(tree, n => n.type === "TouchableOpacity" && text(n).startsWith("Add Another Child")).length);
});

test("an older list snapshot cannot erase a newly created fourth child", async () => {
  let count = 3, deferRead = false; let finishOldRead: (data: any) => void = () => {};
  const rows = () => Array.from({ length: count }, (_, i) => child(String(i + 1)));
  const h = providerHarness(async (url: string, init: any) => {
    if (url !== "/api/children") return defaultResponse(url);
    if (init?.method === "POST") { count = 4; deferRead = false; return { child: child("4") }; }
    if (deferRead) return new Promise(resolve => { finishOldRead = resolve; });
    return { children: rows() };
  });
  await h.value().setUser(user()); await tick();
  deferRead = true; const oldRead = h.value().refreshChildren();
  await h.value().addChild(child("new")); await tick();
  finishOldRead({ children: [child("1"), child("2"), child("3")] }); await oldRead;
  assert.equal(h.value().children.length, 4);
  assert.equal(h.value().childrenReady, true);
});
