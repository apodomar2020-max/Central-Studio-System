import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildBalletCancellationTargets,
  findFreshCancellationTarget,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./balletCancellationTargets.ts";
import {
  buildEffectiveEligibleBalletChildIds,
  shouldLockSingleRoutedBalletChild,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./balletStudentPreviewModel.ts";
import {
  decideChildEligibilityAction,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./balletAssessmentStateModel.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const dangerSource = read("artifacts/central/components/ballet/BalletProgramDangerZone.tsx");
const selectorSource = read("artifacts/central/components/ballet/BalletCancellationTargetSelector.tsx");
const assessmentSource = read("artifacts/central/app/ballet/assessment.tsx");
const statusSource = read("artifacts/central/app/ballet/application-status.tsx");

function application(id: number, childName: string, status: string, childId = id + 100) {
  return {
    id,
    childId,
    childName,
    status,
    assignedLevelId: status === "active" || status === "assignedToLevel" ? 3 : null,
    assignedGroupId: status === "active" ? 4 : null,
  } as any;
}

function detail(app: ReturnType<typeof application>, overrides: Record<string, unknown> = {}) {
  return {
    application: app,
    activeAssignment: app.status === "active"
      ? { id: app.id + 1000, applicationId: app.id, childId: app.childId, levelId: 3, groupId: 4, status: "active" }
      : app.status === "assignedToLevel"
        ? { id: app.id + 1000, applicationId: app.id, childId: app.childId, levelId: 3, groupId: null, status: "active" }
        : null,
    openCancellationRequest: null,
    currentPayment: app.status === "active"
      ? { subscriptionDisplayStatus: "Active" }
      : null,
    eligibleRefund: { eligible: true },
    refunds: [],
    ...overrides,
  } as any;
}

function lists(applications: ReturnType<typeof application>[], overrides = new Map<number, any>()) {
  const details = new Map<number, any>();
  for (const app of applications) details.set(app.id, overrides.get(app.id) ?? detail(app));
  return buildBalletCancellationTargets({
    applications: applications as any,
    detailsByApplicationId: details,
    levelNameById: new Map([[3, "Ballet Level 1"]]),
    groupNameById: new Map([[4, "Cyan Group"]]),
  });
}

test("Danger Zone no longer indexes the first application", () => {
  assert.doesNotMatch(dangerSource, /apps\s*\[\s*0\s*\]/);
  assert.doesNotMatch(dangerSource, /active\s*\?\?\s*apps/);
});

test("Danger Zone does not select the first active application implicitly", () => {
  assert.doesNotMatch(dangerSource, /apps\.find\(\(a\)\s*=>\s*ACTIVE_APPLICATION_STATUSES/);
  assert.match(dangerSource, /buildBalletCancellationTargets/);
});

test("one eligible Cancel Application target retains its exact application id", () => {
  const candidate = application(41, "Roda", "accepted");
  const result = lists([candidate]);
  assert.deepEqual(result.cancelApplication.map((target) => target.applicationId), [41]);
  assert.equal(result.cancelApplication[0]?.childName, "Roda");
});

test("one eligible Cancel Program target retains exact application and assignment ids", () => {
  const candidate = application(52, "Mariam", "active");
  const result = lists([candidate]);
  assert.equal(result.cancelProgram[0]?.applicationId, 52);
  assert.equal(result.cancelProgram[0]?.assignmentId, 1052);
});

test("child-specific confirmation copy is used for application and program cancellation", () => {
  assert.match(dangerSource, /Cancel \$\{target\.childName\}'s Application\?/);
  assert.match(dangerSource, /Cancel \$\{target\.childName\}'s Ballet Program\?/);
  assert.doesNotMatch(statusSource, /Cancel \$\{application\.childName\}/);
});

test("multiple eligible targets open a selector rather than choosing one", () => {
  assert.match(dangerSource, /if \(targets\.length === 1\)/);
  assert.match(dangerSource, /setSelector\(\{ kind, targets \}\)/);
  assert.match(dangerSource, /<BalletCancellationTargetSelector/);
});

test("the child selector starts without a default target", () => {
  assert.match(dangerSource, /setSelectedTarget\(null\);\s*setSelector/);
  assert.doesNotMatch(selectorSource, /targets\s*\[\s*0\s*\]/);
});

test("selector Continue remains disabled until one child is selected", () => {
  assert.match(selectorSource, /disabled=\{selectedApplicationId == null\}/);
  assert.match(selectorSource, /accessibilityState=\{\{ disabled: selectedApplicationId == null \}\}/);
});

test("selected pre-activation target id is sent to the canonical application cancellation endpoint", () => {
  assert.match(dangerSource, /cancelBalletApplication\(freshTarget\.applicationId/);
});

test("selected active target assignment id is sent to the canonical program cancellation endpoint", () => {
  assert.match(dangerSource, /requestBalletEnrollmentCancellation\(freshTarget\.assignmentId/);
});

test("success refreshes all application and landing-student state without mutating siblings", () => {
  assert.match(dangerSource, /await load\(\);\s*onChanged\?\.\(\)/);
  assert.doesNotMatch(dangerSource, /splice|filter\([^)]*childId|setBalletStudents/);
});

test("a stale target is rejected before the cancellation endpoint is called", () => {
  assert.ok(dangerSource.indexOf("findFreshCancellationTarget") < dangerSource.indexOf("cancelBalletApplication(freshTarget.applicationId"));
  assert.match(dangerSource, /is no longer eligible for this action\. Nothing was cancelled/);
});

test("active applications are excluded from Cancel Application candidates", () => {
  const result = lists([application(1, "Active Child", "active")]);
  assert.equal(result.cancelApplication.length, 0);
  assert.equal(result.cancelProgram.length, 1);
});

test("pre-activation applications are excluded from Cancel Program candidates", () => {
  for (const status of ["pending", "needsFollowUp", "accepted", "assignedToLevel"]) {
    const result = lists([application(2, "Applicant", status)]);
    assert.equal(result.cancelProgram.length, 0);
    assert.equal(result.cancelApplication.length, 1);
  }
});

test("an open cancellation request blocks a second program request", () => {
  const app = application(3, "Scheduled Child", "active");
  const result = lists([app], new Map([[3, detail(app, { openCancellationRequest: { id: 77, status: "pendingReview" } })]]));
  assert.equal(result.cancelProgram.length, 0);
  assert.equal(result.cancellationRequests.length, 1);
});

test("fresh-target lookup keeps application and assignment identity coupled", () => {
  const app = application(4, "Exact Child", "active");
  const result = lists([app]);
  assert.equal(findFreshCancellationTarget({ lists: result, kind: "cancelProgram", applicationId: 4, assignmentId: 1004 })?.childName, "Exact Child");
  assert.equal(findFreshCancellationTarget({ lists: result, kind: "cancelProgram", applicationId: 4, assignmentId: 9999 }), null);
});

test("generic application status is read-only when a multi-application route has no explicit id", () => {
  assert.match(statusSource, /setHasExplicitApplicationContext\(requested != null \|\| onlyApplication != null\)/);
  assert.match(statusSource, /Open a student from the Ballet Program page to view the correct application/);
});

test("mobile Ballet application details expose no cancellation controls or mutation endpoints", () => {
  assert.doesNotMatch(statusSource, /cancelBalletApplication|requestBalletEnrollmentCancellation|withdrawBalletEnrollmentCancellationRequest/);
  assert.doesNotMatch(statusSource, /Cancel Program|Cancel Application|Withdraw request/);
  assert.doesNotMatch(statusSource, /action\?: string|action=cancel/);
});

test("an unknown explicit application id does not fall back to another child", () => {
  assert.match(statusSource, /requestedApplicationIdParam != null && requested == null/);
  assert.match(statusSource, /setHasExplicitApplicationContext\(false\)/);
});

test("Add Another Child is visible without routed ids", () => {
  assert.match(assessmentSource, /<Text style=\{styles\.addChildText\}>Add Another Child<\/Text>/);
});

test("Add Another Child is not conditional on routed eligible ids", () => {
  const area = assessmentSource.slice(assessmentSource.indexOf("styles.addChildButton") - 180, assessmentSource.indexOf("styles.addChildText") + 160);
  assert.doesNotMatch(area, /routedEligibleChildIds\s*==\s*null/);
});

test("session-created ids are unioned with routed ids", () => {
  assert.deepEqual([...buildEffectiveEligibleBalletChildIds([7], new Set([19]))!], [7, 19]);
  assert.match(assessmentSource, /buildEffectiveEligibleBalletChildIds\(routedEligibleChildIds, sessionCreatedChildIds\)/);
});

test("a new child id is recorded before the session continues", () => {
  assert.match(assessmentSource, /setSessionCreatedChildIds\(\(current\) => new Set\(current\)\.add\(createdId\)\)/);
  assert.match(assessmentSource, /setSelectedChild\(created\)/);
});

// This invariant previously asserted on assessment.tsx's raw source for an
// inline `if (selectedChild && sessionCreatedChildIds.has(...)) return`
// early-exit. That exact logic has since moved into
// decideChildEligibilityAction (balletAssessmentStateModel.ts) as its own
// explicit branch — assessment.tsx now just computes
// `isSessionCreatedSelectedChild` and passes it in. Testing the pure
// function directly is a behavioral assertion of the real business
// invariant, not a brittle match on source text/structure that can drift
// out of sync with a legitimate refactor.
test("a session-created selection is not cleared, changed, or bounced by routed synchronization", () => {
  const action = decideChildEligibilityAction({
    hasRoutedAllowList: true,
    applicationsReady: true,
    hasSubmittedSnapshot: false,
    hasEditingApplication: false,
    isSubmissionInFlight: false,
    selectedChildId: "9",
    isSessionCreatedSelectedChild: true,
    step: "child",
    visibleChildIds: [],
  });
  assert.deepEqual(action, { type: "none" });
});

test("creating a child clears the prior single-routed-child lock only for this session", () => {
  assert.equal(shouldLockSingleRoutedBalletChild({ hasRoutedAllowList: true, applicationsReady: true, visibleChildCount: 1, sessionCreatedChildCount: 0 }), true);
  assert.equal(shouldLockSingleRoutedBalletChild({ hasRoutedAllowList: true, applicationsReady: true, visibleChildCount: 2, sessionCreatedChildCount: 1 }), false);
});

test("excluded existing children remain outside the effective route allow-list", () => {
  assert.deepEqual([...buildEffectiveEligibleBalletChildIds([7], new Set([19]))!], [7, 19]);
  assert.equal(buildEffectiveEligibleBalletChildIds([7], new Set([19]))!.has(8), false);
});

test("Add Child modal uses keyboard avoidance and a scrollable form", () => {
  assert.match(assessmentSource, /<KeyboardAvoidingView[\s\S]*style=\{styles\.modalOverlay\}/);
  assert.match(assessmentSource, /<ScrollView[\s\S]*style=\{styles\.modalScroll\}[\s\S]*keyboardShouldPersistTaps="handled"/);
});

test("name and date of birth have separate vertical form sections", () => {
  assert.match(assessmentSource, /<View style=\{styles\.formSection\}>[\s\S]*label="Child Name"[\s\S]*<\/View>\s*<View style=\{styles\.formSection\}>[\s\S]*Date of Birth/);
  assert.match(assessmentSource, /birthRow: \{ flexDirection: "row"/);
});

test("Day Month and Year are distinct inputs with field-owned labels", () => {
  assert.match(assessmentSource, /<Field label="Day"/);
  assert.match(assessmentSource, /<Field label="Month"/);
  assert.match(assessmentSource, /<Field label="Year"/);
});

test("gender controls render below date of birth and Save Child stays in the scroll form", () => {
  const dobIndex = assessmentSource.indexOf("Date of Birth");
  const genderIndex = assessmentSource.indexOf(">Gender<", dobIndex);
  const saveIndex = assessmentSource.indexOf(">Save Child<", genderIndex);
  const scrollEnd = assessmentSource.indexOf("</ScrollView>", saveIndex);
  assert.ok(dobIndex >= 0 && genderIndex > dobIndex && saveIndex > genderIndex && scrollEnd > saveIndex);
});

test("the repaired child form has no absolute positioning or negative margins", () => {
  const modalStyles = assessmentSource.slice(
    assessmentSource.indexOf("modalOverlay:"),
    assessmentSource.indexOf("successGlow:"),
  );
  assert.doesNotMatch(modalStyles, /position:\s*"absolute"|margin(?:Top|Bottom|Left|Right)?:\s*-/);
});
