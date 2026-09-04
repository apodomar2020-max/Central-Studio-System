import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const actionsSource = read("artifacts/central/components/ballet/BalletAssessmentSuccessActions.tsx");
const packageCardSource = read("artifacts/central/components/ballet/BalletAssessmentPackageCard.tsx");
const iconSource = read("artifacts/central/components/ballet/BalletAssessmentIcon.tsx");
const childCardSource = read("artifacts/central/components/ballet/BalletAssessmentChildCard.tsx");
const appointmentCardSource = read("artifacts/central/components/ballet/BalletAssessmentAppointmentCard.tsx");
const summarySource = read("artifacts/central/components/ballet/BalletAssessmentSummaryCard.tsx");
const assessmentSource = read("artifacts/central/app/ballet/assessment.tsx");
const bookingFlowSource = read("artifacts/central/app/booking/flow.tsx");

test("the Child step keeps the top Back control while later steps use their footer Back button", () => {
  const usages = assessmentSource.match(/<BalletAssessmentHeader onBack=\{goBack\} showBack=\{step === "child"\} \/>/g) ?? [];
  assert.equal(usages.length, 1);
});

test("the success screen is one responsive scroll surface, including its action panel", () => {
  const successStart = assessmentSource.indexOf("if (submittedApplicationId != null && submittedSnapshot)");
  const successEnd = assessmentSource.indexOf("\n  return (\n    <View style={[styles.container", successStart);
  const successSource = assessmentSource.slice(successStart, successEnd);
  assert.match(successSource, /<ScrollView[\s\S]*<BalletAssessmentSuccessSummaryCard[\s\S]*<View style=\{styles\.successClosingCard\}>[\s\S]*<BalletAssessmentSuccessActions[\s\S]*<\/ScrollView>/);
  assert.match(successSource, /paddingBottom: Math\.max\(insets\.bottom, 12\) \+ 20/);
  assert.doesNotMatch(assessmentSource, /successFooter/);
});

test("success preserves the shared celebration animation and submission pop", () => {
  assert.match(assessmentSource, /<SuccessConfetti \/>/);
  assert.match(assessmentSource, /transform: \[\{ scale: successScale \}\]/);
  assert.match(assessmentSource, /successScale\.setValue\(0\)/);
  assert.match(assessmentSource, /Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)/);
});

test("all children stay visible while existing Ballet applicants are disabled", () => {
  assert.match(assessmentSource, /applicationsState === "ready" && children\.map\(\(child\) =>/);
  assert.match(assessmentSource, /const disabled = outsideRoutedSelection \|\| \(status != null && BLOCKING_CHILD_APPLICATION_STATUSES\.has\(status\)\)/);
  assert.match(assessmentSource, /disabled=\{disabled\}/);
  assert.match(assessmentSource, /if \(disabled \|\| lockedOut\) return/);
});

test("a blocking application wins over terminal history for the same child", () => {
  assert.match(assessmentSource, /matching\.find\(\(app\) => BLOCKING_CHILD_APPLICATION_STATUSES\.has\(app\.status\)\)\?\.status/);
});

test("success actions match the reference destinations", () => {
  assert.match(actionsSource, /onModify: \(\) => void/);
  assert.match(actionsSource, /onRemind: \(\) => void/);
  assert.match(actionsSource, /onHome: \(\) => void/);
  assert.match(actionsSource, />Modify<\/Text>/);
  assert.match(actionsSource, />Remind Me<\/Text>/);
  assert.match(actionsSource, />Back to home<\/Text>/);
  assert.match(assessmentSource, /onHome=\{\(\) => router\.replace\("\/\(tabs\)\/" as never\)\}/);
  assert.match(assessmentSource, /calendar\.google\.com\/calendar\/render/);
});

test("Ballet cancellation remains admin and system only", () => {
  assert.doesNotMatch(actionsSource, /Cancel Application|Cancel Program|onCancel|cancelLoading/);
  assert.doesNotMatch(assessmentSource, /cancelBalletApplication|requestBalletEnrollmentCancellation|submitCancelApplication/);
});

test("Modify restores only the submitted child and appointment before returning to Review", () => {
  assert.match(assessmentSource, /setEditingApplicationId\(submittedApplicationId\);\s*setSelectedChild\(submittedSnapshot\.child\);\s*setSelectedAppointment\(submittedSnapshot\.appointment\);\s*setSubmittedApplicationId\(null\);\s*setSubmittedSnapshot\(null\);\s*setStep\("review"\);/);
  assert.doesNotMatch(assessmentSource, /setSelectedPackage/);
});

test("plans are informational carousel cards and cannot be selected", () => {
  assert.match(packageCardSource, /return \(\s*<View style=\{styles\.card\}/);
  assert.doesNotMatch(packageCardSource, /TouchableOpacity|Pressable|onPress|selected/);
  assert.match(assessmentSource, /<ScrollView horizontal[\s\S]*packages\.map\(\(pkg\) => <BalletAssessmentPackageCard key=\{pkg\.id\} pkg=\{pkg\} \/>\)/);
  assert.doesNotMatch(assessmentSource, /selectedPackage|setSelectedPackage/);
});

test("Ballet step headings use the regular class-booking title scale and readable supporting copy", () => {
  assert.match(bookingFlowSource, /stepTitle: \{ fontSize: 22, fontFamily: "Archivo_700Bold"/);
  assert.match(assessmentSource, /stepTitle: \{[\s\S]*?fontFamily: "Archivo_700Bold",[\s\S]*?fontSize: 22,/);
  assert.match(assessmentSource, /stepSubtitle: \{[\s\S]*?fontSize: 14,[\s\S]*?lineHeight: 18,/);
});

test("Ballet plan cards share the regular package dimensions and use the artwork as the card background", () => {
  assert.match(packageCardSource, /PACKAGE_CARD_HEIGHT, PACKAGE_CARD_WIDTH/);
  assert.match(packageCardSource, /style=\{StyleSheet\.absoluteFill\} contentFit="cover"/);
  assert.match(packageCardSource, /backgroundColor: "transparent"/);
  assert.doesNotMatch(packageCardSource, /colors=\{\["#050607", "#060708"\]\}/);
});

test("the supplied Ballet assessment SVG set replaces generic review icons", () => {
  for (const name of ["edit", "info", "payment", "price", "shoes"]) {
    assert.match(iconSource, new RegExp(`ballet-assessment-${name}\\.svg`));
  }
  assert.match(summarySource, /BalletAssessmentIcon name="edit"/);
  assert.match(summarySource, /BalletAssessmentIcon name="payment"/);
  assert.match(summarySource, /BalletAssessmentIcon name="price"/);
  assert.doesNotMatch(summarySource, /create-outline|pricetag-outline|card-outline/);
  assert.match(assessmentSource, /BalletAssessmentIcon name="shoes"/);
  assert.match(assessmentSource, /BalletAssessmentIcon name="info"/);
});

test("small Ballet assessment copy is raised to readable mobile sizes", () => {
  assert.match(childCardSource, /name: \{[^\n]*fontSize: 20, lineHeight: 23/);
  assert.match(childCardSource, /age: \{[^\n]*fontSize: 13, lineHeight: 16/);
  assert.match(appointmentCardSource, /level: \{[^\n]*fontSize: 21, lineHeight: 25/);
  assert.match(appointmentCardSource, /meta: \{[^\n]*fontSize: 13, lineHeight: 17/);
  assert.match(assessmentSource, /addChildHint: \{[^\n]*fontSize: 12\.5, lineHeight: 16/);
  assert.match(assessmentSource, /noteText: \{[^\n]*fontSize: 13, lineHeight: 18/);
  assert.match(assessmentSource, /assessmentFeeDescription: \{[^\n]*fontSize: 12, lineHeight: 16/);
});

test("no preferred package is sent during assessment submission or editing", () => {
  const updateStart = assessmentSource.indexOf("await updateBalletApplication");
  const updateEnd = assessmentSource.indexOf("});", updateStart) + 3;
  const submitStart = assessmentSource.indexOf("const result = await submitBalletApplication");
  const submitEnd = assessmentSource.indexOf("});", submitStart) + 3;
  assert.doesNotMatch(assessmentSource.slice(updateStart, updateEnd), /preferredPackageId/);
  assert.doesNotMatch(assessmentSource.slice(submitStart, submitEnd), /preferredPackageId/);
});

test("success buttons use reference-like fully rounded sizing", () => {
  assert.match(actionsSource, /outlineButton: \{[^}]*height: 50[^}]*borderRadius: 25/);
  assert.match(actionsSource, /homeButton: \{[^}]*height: 52[^}]*borderRadius: 26/);
});
