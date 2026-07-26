import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildEffectiveEligibleBalletChildIds,
  parseEligibleBalletChildIds,
  selectAuthoritativeBalletApplications,
  selectCurrentBalletStudents,
  selectEligibleBalletChildren,
  shouldShowAddBalletChildCard,
  shouldLockSingleRoutedBalletChild,
  type BalletStudentPreviewApplicationSource,
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
} from "./balletStudentPreviewModel.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const cardSource = read("artifacts/central/components/ballet/BalletStudentPreviewCard.tsx");
const landingSource = read("artifacts/central/app/ballet/index.tsx");
const assessmentSource = read("artifacts/central/app/ballet/assessment.tsx");
const detailRowSource = cardSource.slice(
  cardSource.indexOf("function DetailRow"),
  cardSource.indexOf("export function BalletStudentPreviewCard"),
);
const realCardSource = cardSource.slice(
  cardSource.indexOf("export function BalletStudentPreviewCard"),
  cardSource.indexOf("export function AddBalletChildCard"),
);
const addCardSource = cardSource.slice(
  cardSource.indexOf("export function AddBalletChildCard"),
  cardSource.indexOf("export function BalletStudentPreviewSection"),
);
const cardStyleSource = cardSource.slice(
  cardSource.indexOf("  card: {"),
  cardSource.indexOf("  cardMain:"),
);
const cardMainStyleSource = cardSource.slice(
  cardSource.indexOf("  cardMain:"),
  cardSource.indexOf("  visualPanel:"),
);
const visualPanelStyleSource = cardSource.slice(
  cardSource.indexOf("  visualPanel:"),
  cardSource.indexOf("  informationPanel:"),
);
const artworkImageStyleSource = cardSource.slice(
  cardSource.indexOf("  artworkImage:"),
  cardSource.indexOf("  informationPanel:"),
);
const informationPanelStyleSource = cardSource.slice(
  cardSource.indexOf("  informationPanel:"),
  cardSource.indexOf("  identity:"),
);
const footerDividerStyleSource = cardSource.slice(
  cardSource.indexOf("  footerDivider:"),
  cardSource.indexOf("  comingSoon:"),
);
const comingSoonStyleSource = cardSource.slice(
  cardSource.indexOf("  comingSoon:"),
  cardSource.indexOf("  comingSoonText:"),
);

function application(overrides: Partial<BalletStudentPreviewApplicationSource> = {}): BalletStudentPreviewApplicationSource {
  return {
    id: 20,
    childId: 8,
    childName: "Mariam Ahmed",
    childBirthday: "2015-04-12",
    childGender: "female",
    status: "active",
    assignedLevelId: 3,
    assignedGroupId: 7,
    resolvedSchedules: [{ id: 1 }, { id: 2 }],
    assessmentDate: "2026-08-04",
    preferredPackageId: 12,
    preferredPaymentMethod: "inPerson",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function select(applications: BalletStudentPreviewApplicationSource[]) {
  return selectCurrentBalletStudents({
    applications,
    detailsByApplicationId: new Map([
      [20, { currentPayment: { status: "paid", subscriptionDisplayStatus: "Active" } }],
      [21, { currentPayment: { status: "paid", subscriptionDisplayStatus: "Renewed" } }],
    ]),
    levelNameById: new Map([[3, "Primary Ballet"]]),
    groupNameById: new Map([[7, "Cyan Group"]]),
    packageNameById: new Map([[12, "Eight Classes"]]),
  });
}

const children = [
  { id: "8", fullName: "Mariam Ahmed", birthday: "2015-04-12" },
  { id: "9", fullName: "Nour Ali", birthday: "2017-06-08" },
];
const blockingStatuses = new Set(["pending", "needsFollowUp", "accepted", "assignedToLevel", "active"]);

test("every non-terminal Ballet application lifecycle status renders a card with the correct label", () => {
  const cases = [
    ["pending", "Application Pending"],
    ["needsFollowUp", "Needs Follow-Up"],
    ["accepted", "Application Accepted"],
    ["assignedToLevel", "Assigned to Level"],
    ["active", "Active Student"],
  ] as const;

  for (const [status, expectedLabel] of cases) {
    const [student] = select([application({ status })]);
    assert.equal(student?.statusLabel, expectedLabel);
  }
});

test("terminal Ballet application records do not render student journey cards", () => {
  for (const status of ["rejected", "cancelled", "withdrawn"]) {
    assert.deepEqual(select([application({ status })]), []);
  }
});

test("non-active applications are never labelled Active Student", () => {
  for (const status of ["pending", "needsFollowUp", "accepted", "assignedToLevel"]) {
    const [student] = select([application({ status })]);
    assert.notEqual(student?.statusLabel, "Active Student");
  }
});

test("one child with several application records renders one authoritative card", () => {
  const records = [
    application({ id: 31, status: "cancelled", updatedAt: "2026-01-01T00:00:00.000Z" }),
    application({ id: 32, status: "pending", updatedAt: "2026-07-01T00:00:00.000Z" }),
    application({ id: 33, status: "accepted", updatedAt: "2026-07-03T00:00:00.000Z" }),
  ];
  const selected = selectAuthoritativeBalletApplications(records);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.id, 33);
});

test("an active record wins over a newer non-terminal record for the same child", () => {
  const selected = selectAuthoritativeBalletApplications([
    application({ id: 41, status: "active", updatedAt: "2026-06-01T00:00:00.000Z" }),
    application({ id: 42, status: "needsFollowUp", updatedAt: "2026-07-10T00:00:00.000Z" }),
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.id, 41);
});

test("latest updated non-terminal record wins when a child has no active record", () => {
  const selected = selectAuthoritativeBalletApplications([
    application({ id: 51, status: "pending", updatedAt: "2026-07-01T00:00:00.000Z" }),
    application({ id: 52, status: "accepted", updatedAt: "2026-07-11T00:00:00.000Z" }),
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.id, 52);
});

test("canonical child id is primary while legacy identity falls back to name and birthday", () => {
  const distinctChildIds = selectAuthoritativeBalletApplications([
    application({ id: 61, childId: 8, childName: "Same Name", status: "pending" }),
    application({ id: 62, childId: 9, childName: "Same Name", status: "accepted" }),
  ]);
  assert.equal(distinctChildIds.length, 2);

  const legacy = selectAuthoritativeBalletApplications([
    application({ id: 63, childId: null, childName: "Legacy Child", childBirthday: "2015-04-12", status: "pending", updatedAt: "2026-07-01T00:00:00.000Z" }),
    application({ id: 64, childId: null, childName: "Legacy Child", childBirthday: "2015-04-12", status: "accepted", updatedAt: "2026-07-02T00:00:00.000Z" }),
  ]);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]?.id, 64);
});

test("pre-activation cards use application information and omit active-only rows", () => {
  const [student] = select([application({ status: "accepted", resolvedSchedules: null, assignedGroupId: null })]);
  assert.deepEqual(student?.detailRows.map((row) => row.label), ["Assessment", "Package", "Payment"]);
  assert.equal(student?.detailRows.some((row) => row.label === "Subscription" || row.label === "Classes"), false);
});

test("assigned-to-level cards show only available placement, payment, and subscription state", () => {
  const [student] = select([application({ status: "assignedToLevel", assignedGroupId: null })]);
  assert.deepEqual(student?.detailRows.map((row) => row.label), ["Level", "Payment", "Subscription"]);
});

test("a newly returned non-terminal application immediately becomes a landing journey card", () => {
  assert.deepEqual(select([]), []);
  const [student] = select([application({ id: 71, childId: 19, childName: "New Child", status: "pending" })]);
  assert.equal(student?.childId, 19);
  assert.equal(student?.statusLabel, "Application Pending");
});

test("application submission and landing focus both trigger an authoritative applications refresh", () => {
  assert.match(assessmentSource, /void loadApplications\(\);/);
  assert.match(landingSource, /useFocusEffect\([\s\S]*fetchMyApplications\(ctrl\.signal\)/);
  assert.match(landingSource, /selectAuthoritativeBalletApplications\(apps\)/);
});

test("the real student card uses one unified two-column premium surface", () => {
  assert.match(realCardSource, /style=\{styles\.cardMain\}/);
  assert.match(realCardSource, /style=\{styles\.visualPanel\}/);
  assert.match(realCardSource, /style=\{styles\.informationPanel\}/);
  assert.match(realCardSource, /style=\{styles\.footerDivider\}/);
  assert.match(cardSource, /cardMain: \{ flexDirection: "row"/);
});

test("metadata rows are not wrapped in a nested dark details card", () => {
  assert.match(cardSource, /details: \{\}/);
  assert.doesNotMatch(realCardSource, /styles\.detailCard|styles\.detailsPanel/);
});

test("the left panel uses the exact static local ballerina asset", () => {
  assert.equal(existsSync(resolve(process.cwd(), "artifacts/central/assets/images/ballerina-card.png")), true);
  assert.match(cardSource, /const BALLERINA_ARTWORK = require\("\.\.\/\.\.\/assets\/images\/ballerina-card\.png"\);/);
  assert.doesNotMatch(cardSource, /require\("\.\.\/\.\.\/assets\/images\/ballerina\.(?:png|webp)"\)/);
  assert.match(realCardSource, /<Image[\s\S]*source=\{BALLERINA_ARTWORK\}/);
  assert.match(realCardSource, /style=\{styles\.artworkImage\}/);
  assert.match(realCardSource, /resizeMode="cover"/);
});

test("the main ballerina artwork has no circular, rounded, bordered, or inset surface", () => {
  assert.doesNotMatch(realCardSource, /BallerinaShoesIcon|artworkRing|initialsBadge/);
  assert.doesNotMatch(visualPanelStyleSource, /margin|padding|borderWidth|borderRadius/);
  assert.doesNotMatch(cardMainStyleSource, /gap|padding|margin/);
});

test("the outer card is the only clipping surface and artwork is flush to its edges", () => {
  assert.match(cardStyleSource, /overflow: "hidden"/);
  assert.doesNotMatch(cardStyleSource, /padding|margin/);
  assert.match(visualPanelStyleSource, /width: "36%"/);
  assert.match(visualPanelStyleSource, /position: "relative"/);
  assert.match(visualPanelStyleSource, /alignSelf: "stretch"/);
  assert.match(visualPanelStyleSource, /overflow: "hidden"/);
  assert.match(cardMainStyleSource, /alignItems: "stretch"/);
  assert.match(artworkImageStyleSource, /flex: 1/);
  assert.match(artworkImageStyleSource, /width: "100%"/);
  assert.match(artworkImageStyleSource, /height: "100%"/);
});

test("the image is an in-flow layer with no opaque artwork overlay", () => {
  assert.doesNotMatch(realCardSource, /StyleSheet\.absoluteFillObject/);
  assert.doesNotMatch(realCardSource, /<LinearGradient/);
  assert.doesNotMatch(artworkImageStyleSource, /opacity|tintColor|zIndex/);
});

test("the details panel keeps padding independent from the flush artwork", () => {
  assert.match(informationPanelStyleSource, /paddingTop: 12/);
  assert.match(informationPanelStyleSource, /paddingRight: 12/);
  assert.match(informationPanelStyleSource, /paddingBottom: 10/);
  assert.match(informationPanelStyleSource, /paddingLeft: 12/);
});

test("the artwork content row extends directly to the full-width footer divider", () => {
  assert.match(realCardSource, /<View style=\{styles\.cardMain\}>[\s\S]*<\/View>\s*<View style=\{styles\.footerDivider\} \/>/);
  assert.match(cardSource, /footerDivider: \{ height: 1, backgroundColor:/);
  assert.doesNotMatch(cardSource, /footerDivider: \{[^}]*margin/);
});

test("the real student card remains completely non-clickable", () => {
  assert.doesNotMatch(realCardSource, /Pressable|Touchable|\bLink\b|router\.|onPress|accessibilityRole=["']button["']/);
});

test("the section uses a horizontal snapping FlatList carousel", () => {
  assert.match(cardSource, /<FlatList[\s\S]*horizontal/);
  assert.match(cardSource, /snapToInterval=\{cardWidth \+ CARD_GAP\}/);
  assert.match(cardSource, /decelerationRate="fast"/);
});

test("metadata rows keep icon, label, and value in one horizontal row", () => {
  assert.match(detailRowSource, /<Ionicons[\s\S]*<Text style=\{styles\.detailLabel\}>\{label\}<\/Text>[\s\S]*<Text style=\{styles\.detailValue\}>\{value\}<\/Text>/);
  assert.match(cardSource, /detailRow: \{[\s\S]*flexDirection: "row"[\s\S]*alignItems: "center"/);
});

test("metadata values align to the far right", () => {
  assert.match(cardSource, /detailValue: \{[\s\S]*marginLeft: "auto"[\s\S]*textAlign: "right"/);
});

test("multiple students are carousel data rather than a vertical card list", () => {
  assert.match(cardSource, /students\.map\(\(student\) => \(\{/);
  assert.doesNotMatch(cardSource, /<View style=\{styles\.list\}>/);
});

test("one active student plus an eligible child appends the CTA card", () => {
  assert.equal(shouldShowAddBalletChildCard(1, 1), true);
  assert.match(cardSource, /studentItems\.push\(\{ kind: "addChild", key: "add-child" \}\)/);
});

test("only the Add Another Child card is clickable", () => {
  assert.match(addCardSource, /<TouchableOpacity/);
  assert.match(addCardSource, /onPress=\{onPress\}/);
  assert.match(addCardSource, /accessibilityRole="button"/);
});

test("the currently active child is excluded from another application", () => {
  const eligible = selectEligibleBalletChildren({
    children,
    applications: [application()],
    blockingStatuses,
  });
  assert.deepEqual(eligible.map((child) => child.id), ["9"]);
});

test("a child with any non-terminal application is excluded", () => {
  for (const status of blockingStatuses) {
    const eligible = selectEligibleBalletChildren({
      children,
      applications: [application({ id: 21, childId: 9, childName: "Nour Ali", childBirthday: "2017-06-08", status })],
      blockingStatuses,
    });
    assert.deepEqual(eligible.map((child) => child.id), ["8"]);
  }
});

test("no eligible child hides the CTA card", () => {
  assert.equal(shouldShowAddBalletChildCard(1, 0), false);
  assert.equal(shouldShowAddBalletChildCard(2, 1), false);
});

test("one routed eligible child is preselected and locked in the existing assessment flow", () => {
  assert.deepEqual(parseEligibleBalletChildIds("9"), [9]);
  assert.equal(shouldLockSingleRoutedBalletChild({
    hasRoutedAllowList: true,
    applicationsReady: true,
    visibleChildCount: 1,
    sessionCreatedChildCount: 0,
  }), true);
  assert.match(assessmentSource, /decideChildEligibilityAction\(\{/);
  assert.match(assessmentSource, /action\.type === "preselect"/);
  assert.match(assessmentSource, /locked=\{routedChildLocked\}/);
  assert.match(landingSource, /pathname: "\/ballet\/assessment"/);
});

test("multiple routed children remain limited to the eligible identifier list", () => {
  assert.deepEqual(parseEligibleBalletChildIds("9,10,9,invalid"), [9, 10]);
  assert.deepEqual([...buildEffectiveEligibleBalletChildIds([9, 10], new Set())!], [9, 10]);
  assert.match(assessmentSource, /computeVisibleAssessmentChildren\(\{/);
  assert.match(assessmentSource, /effectiveEligibleChildIds,/);
  assert.match(assessmentSource, /blockingStatuses: BLOCKING_CHILD_APPLICATION_STATUSES,/);
});

test("the canonical numeric child id is derived through the validated normalization helper, never coerced inline", () => {
  assert.match(assessmentSource, /fetchAvailableAssessmentSchedules\(signal, child\.birthday, childId\)/);
  assert.match(assessmentSource, /const childId = parseCanonicalChildId\(child\.id\) \?\? undefined;/);
  assert.match(assessmentSource, /const selectedChildId = parseCanonicalChildId\(selectedChild_\.id\);/);
  assert.doesNotMatch(assessmentSource, /fetchAvailableAssessmentSchedules\(signal, child\.birthday, child\.id\)/);
  assert.doesNotMatch(assessmentSource, /Number\(selectedChild_\.id\)/);
});

test("the submission draft is built before the submission lock and the POST, and success finalizes it rather than rebuilding from state", () => {
  assert.match(assessmentSource, /const draftSnapshot = buildAssessmentSubmissionDraft\(\{[\s\S]{0,400}submittingRef\.current = true;/);
  assert.match(assessmentSource, /finalizeAssessmentSubmissionSnapshot\(draftSnapshot,/);
  assert.match(assessmentSource, /isSubmissionInFlight: submitting,/);
});

test("the actual student card has no chevron", () => {
  assert.doesNotMatch(realCardSource, /chevron/);
});

test("the coming-soon footer remains centered below a divider", () => {
  assert.match(realCardSource, /styles\.footerDivider/);
  assert.match(realCardSource, /Dedicated child profile coming soon\./);
  assert.match(cardSource, /justifyContent: "center"/);
});

test("long names and narrow Samsung-width cards use shrink-safe responsive layout", () => {
  assert.match(cardSource, /cardWidth = Math\.min\(Math\.max\(viewportWidth - 52, 286\), 360\)/);
  assert.match(informationPanelStyleSource, /flex: 1/);
  assert.match(informationPanelStyleSource, /minWidth: 0/);
  assert.match(cardSource, /name: \{[\s\S]*flexShrink: 1/);
});

test("the real card no longer uses the previous oversized fixed or minimum height", () => {
  assert.doesNotMatch(cardStyleSource, /height: 266|minHeight: 266/);
  assert.match(cardStyleSource, /alignSelf: "flex-start"/);
});

test("pending and active cards share a common content-region minimum height sized for the Active layout", () => {
  assert.match(informationPanelStyleSource, /minHeight: \d+/);
  const [, minHeightValue] = informationPanelStyleSource.match(/minHeight: (\d+)/) ?? [];
  assert.ok(minHeightValue && Number(minHeightValue) >= 180, "informationPanel minHeight should fit a 4-row Active layout");
  // The outer card itself stays content-driven; only the inner content
  // region carries the shared minimum, so it can't regress into an
  // oversized fixed outer shell.
  assert.doesNotMatch(cardStyleSource, /minHeight/);
});

test("the footer stays outside the shared content-region minimum height and compact", () => {
  assert.doesNotMatch(footerDividerStyleSource, /minHeight|height: (?!1\b)/);
  assert.doesNotMatch(comingSoonStyleSource, /minHeight/);
});

test("an empty resolved schedule is unavailable instead of misleading zero classes", () => {
  const [student] = select([application({ resolvedSchedules: [] })]);
  assert.equal(student?.weeklyClassCount, null);
  assert.equal(student?.detailRows.find((row) => row.kind === "classes")?.value, "Schedule unavailable");
  assert.doesNotMatch(realCardSource, /0 weekly classes/);
});

test("existing Apply Now placement and Ballet navigation cards remain unchanged", () => {
  const applyIndex = landingSource.indexOf("✦ Apply Now");
  const studentsIndex = landingSource.indexOf("<BalletStudentPreviewSection");
  const navigationIndex = landingSource.indexOf("{/* ── Navigation cards ── */}");
  assert.ok(applyIndex >= 0 && studentsIndex > applyIndex);
  assert.ok(navigationIndex > studentsIndex);
  assert.match(landingSource, /NAV_CARDS\.map/);
});
