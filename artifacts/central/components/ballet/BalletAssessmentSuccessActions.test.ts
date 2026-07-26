import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// This is a source-string structural test suite, matching the established
// pattern in BalletStudentPreviewCard.test.ts: there is no runtime React
// Native component-rendering framework in this repo (no jest,
// react-test-renderer, or @testing-library/react-native — confirmed by
// inspecting package.json), so JSX/style structure is verified against the
// component source directly. Behavioral/state-transition logic (submission,
// eligibility, snapshots) is covered separately and exhaustively with real
// function-call tests in balletAssessmentStateModel.test.ts — this file
// only verifies UI structure and wiring, not state transitions.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const actionsSource = read("artifacts/central/components/ballet/BalletAssessmentSuccessActions.tsx");
const headerSource = read("artifacts/central/components/ballet/BalletAssessmentHeader.tsx");
const assessmentSource = read("artifacts/central/app/ballet/assessment.tsx");

const buttonStyleSource = actionsSource.slice(
  actionsSource.indexOf("  button: {"),
  actionsSource.indexOf("  primary:"),
);
const wrapStyleSource = actionsSource.slice(
  actionsSource.indexOf("  wrap: {"),
  actionsSource.indexOf("  mainActions:"),
);
const mainActionsStyleSource = actionsSource.slice(
  actionsSource.indexOf("  mainActions: {"),
  actionsSource.indexOf("  button: {"),
);
const cancelActionStyleSource = actionsSource.slice(
  actionsSource.indexOf("  cancelAction: {"),
  actionsSource.indexOf("  cancelText:"),
);

// ── 1 & 3: Home replaces Back only on the success screen ───────────────────

test("the success screen shows a compact Home action in the top-left, calling the existing Go To Home destination", () => {
  assert.match(assessmentSource, /<BalletAssessmentHeader onBack={goBack} homeAction={\(\) => router\.replace\("\/" as never\)} \/>/);
  assert.match(headerSource, /homeAction\?: \(\) => void/);
  assert.match(headerSource, /isHome \? "home-outline" : "chevron-back"/);
  assert.match(headerSource, /isHome \? "Home" : "Back"/);
});

test("normal assessment steps still render the standard Back header, unaffected by the success-screen Home mode", () => {
  assert.match(assessmentSource, /<BalletAssessmentHeader onBack={goBack} \/>/);
  // The default (non-success) header usage must not pass homeAction, so it
  // falls through to the original Back behavior.
  const normalHeaderUsages = assessmentSource.match(/<BalletAssessmentHeader onBack={goBack} \/>/g) ?? [];
  assert.equal(normalHeaderUsages.length, 1);
});

// ── 2: no large Go To Home button remains ───────────────────────────────────

test("the large Go To Home button is fully removed from the success actions component", () => {
  assert.doesNotMatch(actionsSource, /Go To Home/);
  assert.doesNotMatch(actionsSource, /onHome/);
  assert.doesNotMatch(actionsSource, /home-outline/);
});

// ── 4, 5, 6: Modify and Apply Another Child are equal, full-width buttons ──

test("Modify Application and Apply For Another Child are both rendered from the same full-width, equal-height button style", () => {
  assert.match(actionsSource, /styles\.button, styles\.primary/);
  assert.match(actionsSource, /styles\.button, styles\.secondary/);
  assert.match(buttonStyleSource, /width: "100%"/);
  assert.match(buttonStyleSource, /minHeight: 54/);
  // Only one minHeight declaration exists for these two buttons — proof
  // neither has a per-button size override.
  const minHeightDeclarations = actionsSource.match(/minHeight: \d+/g) ?? [];
  assert.equal(minHeightDeclarations.length, 1);
});

test("the two main actions render as a full-width column, not a row", () => {
  assert.match(mainActionsStyleSource, /width: "100%"/);
  assert.doesNotMatch(mainActionsStyleSource, /flexDirection: "row"/);
});

// ── 7, 8: Cancel Application is a plain text action ─────────────────────────

test("Cancel Application renders as a text action, not a button", () => {
  assert.match(actionsSource, /style={styles\.cancelAction}/);
  assert.doesNotMatch(actionsSource, /onPress={onCancel}[\s\S]{0,80}style={\[styles\.button/);
});

test("the Cancel action has no filled background and no border", () => {
  assert.doesNotMatch(cancelActionStyleSource, /backgroundColor/);
  assert.doesNotMatch(cancelActionStyleSource, /borderWidth/);
  assert.doesNotMatch(cancelActionStyleSource, /borderColor/);
});

// ── 9, 10: Cancel still calls the existing confirmation workflow and blocks repeat taps ──

test("Cancel still calls the existing confirmation workflow via the unchanged onCancel handler", () => {
  assert.match(actionsSource, /onPress={onCancel}/);
  assert.match(assessmentSource, /onCancel={confirmCancel}/);
});

test("cancellation loading disables the action to prevent repeated taps", () => {
  assert.match(actionsSource, /disabled={cancelLoading}/);
  assert.match(actionsSource, /cancelLoading \? "Cancelling…" : "Cancel Application"/);
});

// ── 11: root cause of the clipping is fixed ─────────────────────────────────

test("the success footer no longer inherits the row layout meant for the two-button step footer", () => {
  assert.match(assessmentSource, /successFooter: {\s*flexDirection: "column",?\s*}/);
  assert.match(assessmentSource, /styles\.footer, styles\.successFooter/);
  assert.match(wrapStyleSource, /width: "100%"/);
});

// ── 12: submission / success-state logic is untouched ──────────────────────

test("the Modify handler still restores the exact submitted snapshot fields before returning to Review, unchanged", () => {
  assert.match(assessmentSource, /setEditingApplicationId\(submittedApplicationId\);\s*setSelectedChild\(submittedSnapshot\.child\);\s*setSelectedAppointment\(submittedSnapshot\.appointment\);\s*setSelectedPackage\(submittedSnapshot\.pkg\);\s*setSubmittedApplicationId\(null\);\s*setSubmittedSnapshot\(null\);\s*setStep\("review"\);/);
  assert.match(assessmentSource, /onAnotherChild={resetForAnotherChild}/);
});
