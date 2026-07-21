export interface BalletStudentPreviewApplicationSource {
  id: number;
  childId: number | null;
  childName: string;
  childBirthday: string | null;
  childGender: string | null;
  status: string;
  assignedLevelId: number | null;
  assignedGroupId: number | null;
  resolvedSchedules: Array<unknown> | null;
  assessmentDate: string | null;
  preferredPackageId: number | null;
  preferredPaymentMethod: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BalletEligibleChildSource {
  id: string;
  fullName: string;
  birthday: string;
}

export interface BalletStudentPreviewDetailSource {
  currentPayment: {
    status?: string | null;
    subscriptionDisplayStatus?: string | null;
  } | null;
}

export type BalletJourneyStatus = "pending" | "needsFollowUp" | "accepted" | "assignedToLevel" | "active";
export type BalletJourneyStatusTone = "pending" | "warning" | "accepted" | "progress" | "active";
export type BalletStudentPreviewDetailKind = "assessment" | "package" | "payment" | "level" | "group" | "classes" | "subscription";

export interface BalletStudentPreviewDetailRow {
  kind: BalletStudentPreviewDetailKind;
  label: string;
  value: string;
}

export interface BalletStudentPreview {
  key: string;
  applicationId: number;
  childId: number | null;
  childName: string;
  childGender: string | null;
  applicationStatus: BalletJourneyStatus;
  statusLabel: string;
  statusTone: BalletJourneyStatusTone;
  levelName: string;
  groupName: string;
  weeklyClassCount: number | null;
  subscriptionState: string;
  detailRows: BalletStudentPreviewDetailRow[];
}

export const CURRENT_BALLET_APPLICATION_STATUSES = new Set<BalletJourneyStatus>([
  "pending",
  "needsFollowUp",
  "accepted",
  "assignedToLevel",
  "active",
]);

const STATUS_PRESENTATION: Record<BalletJourneyStatus, { label: string; tone: BalletJourneyStatusTone }> = {
  pending: { label: "Application Pending", tone: "pending" },
  needsFollowUp: { label: "Needs Follow-Up", tone: "warning" },
  accepted: { label: "Application Accepted", tone: "accepted" },
  assignedToLevel: { label: "Assigned to Level", tone: "progress" },
  active: { label: "Active Student", tone: "active" },
};

export function initialsForBalletStudent(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

function canonicalApplicationChildKey(application: BalletStudentPreviewApplicationSource): string {
  if (application.childId != null) return `child:${application.childId}`;
  return `legacy:${application.childName.trim().toLowerCase()}:${application.childBirthday ?? "unknown-birthday"}`;
}

function applicationUpdatedAt(application: BalletStudentPreviewApplicationSource): number {
  const updated = Date.parse(application.updatedAt);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(application.createdAt);
  return Number.isFinite(created) ? created : 0;
}

export function selectAuthoritativeBalletApplications(
  applications: BalletStudentPreviewApplicationSource[],
): BalletStudentPreviewApplicationSource[] {
  const selectedByChild = new Map<string, BalletStudentPreviewApplicationSource>();

  for (const application of applications) {
    if (!CURRENT_BALLET_APPLICATION_STATUSES.has(application.status as BalletJourneyStatus)) continue;
    const key = canonicalApplicationChildKey(application);
    const selected = selectedByChild.get(key);
    if (!selected) {
      selectedByChild.set(key, application);
      continue;
    }

    const applicationIsActive = application.status === "active";
    const selectedIsActive = selected.status === "active";
    if (
      (applicationIsActive && !selectedIsActive)
      || (applicationIsActive === selectedIsActive && applicationUpdatedAt(application) > applicationUpdatedAt(selected))
    ) {
      selectedByChild.set(key, application);
    }
  }

  return [...selectedByChild.values()];
}

function paymentMethodLabel(method: string | null): string | null {
  if (method === "inPerson") return "Pay at Studio";
  if (method === "kashier") return "Online Payment";
  if (method === "bankTransfer") return "Legacy Bank Transfer";
  return null;
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function selectCurrentBalletStudents(input: {
  applications: BalletStudentPreviewApplicationSource[];
  detailsByApplicationId: ReadonlyMap<number, BalletStudentPreviewDetailSource | null>;
  levelNameById: ReadonlyMap<number, string>;
  groupNameById: ReadonlyMap<number, string>;
  packageNameById?: ReadonlyMap<number, string>;
}): BalletStudentPreview[] {
  return selectAuthoritativeBalletApplications(input.applications)
    .map((application) => {
      const status = application.status as BalletJourneyStatus;
      const presentation = STATUS_PRESENTATION[status];
      const payment = input.detailsByApplicationId.get(application.id)?.currentPayment;
      const subscriptionDisplayStatus = payment?.subscriptionDisplayStatus?.trim();
      const levelName = application.assignedLevelId == null
        ? "Level not assigned"
        : input.levelNameById.get(application.assignedLevelId) ?? "Level not assigned";
      const groupName = application.assignedGroupId == null
        ? "Group not assigned"
        : input.groupNameById.get(application.assignedGroupId) ?? "Group not assigned";
      const weeklyClassCount = application.resolvedSchedules == null || application.resolvedSchedules.length === 0
        ? null
        : application.resolvedSchedules.length;
      const subscriptionState = subscriptionDisplayStatus || "Subscription unavailable";
      const detailRows: BalletStudentPreviewDetailRow[] = [];

      if (status === "active") {
        detailRows.push(
          { kind: "level", label: "Level", value: levelName },
          { kind: "group", label: "Group", value: groupName },
          {
            kind: "classes",
            label: "Classes",
            value: weeklyClassCount == null
              ? "Schedule unavailable"
              : `${weeklyClassCount} class${weeklyClassCount === 1 ? "" : "es"} / week`,
          },
          { kind: "subscription", label: "Subscription", value: subscriptionState },
        );
      } else if (status === "assignedToLevel") {
        if (application.assignedLevelId != null) detailRows.push({ kind: "level", label: "Level", value: levelName });
        if (application.assignedGroupId != null) detailRows.push({ kind: "group", label: "Group", value: groupName });
        if (payment?.status) detailRows.push({ kind: "payment", label: "Payment", value: payment.status });
        if (subscriptionDisplayStatus) detailRows.push({ kind: "subscription", label: "Subscription", value: subscriptionDisplayStatus });
      } else {
        if (application.assessmentDate) detailRows.push({ kind: "assessment", label: "Assessment", value: dateLabel(application.assessmentDate) });
        const packageName = application.preferredPackageId == null
          ? null
          : input.packageNameById?.get(application.preferredPackageId) ?? null;
        if (packageName) detailRows.push({ kind: "package", label: "Package", value: packageName });
        const methodLabel = paymentMethodLabel(application.preferredPaymentMethod);
        if (methodLabel) detailRows.push({ kind: "payment", label: "Payment", value: methodLabel });
      }

      return {
        key: canonicalApplicationChildKey(application),
        applicationId: application.id,
        childId: application.childId,
        childName: application.childName,
        childGender: application.childGender,
        applicationStatus: status,
        statusLabel: presentation.label,
        statusTone: presentation.tone,
        levelName,
        groupName,
        weeklyClassCount,
        subscriptionState,
        detailRows,
      };
    });
}

function applicationBelongsToChild(
  application: BalletStudentPreviewApplicationSource,
  child: BalletEligibleChildSource,
): boolean {
  const numericChildId = Number(child.id);
  if (Number.isInteger(numericChildId) && numericChildId > 0 && application.childId === numericChildId) {
    return true;
  }

  return application.childName.trim().toLowerCase() === child.fullName.trim().toLowerCase()
    && Boolean(child.birthday)
    && application.childBirthday === child.birthday;
}

export function selectEligibleBalletChildren<T extends BalletEligibleChildSource>(input: {
  children: T[];
  applications: BalletStudentPreviewApplicationSource[];
  blockingStatuses: ReadonlySet<string>;
}): T[] {
  return input.children.filter((child) => !input.applications.some((application) => (
    input.blockingStatuses.has(application.status) && applicationBelongsToChild(application, child)
  )));
}

export function shouldShowAddBalletChildCard(activeStudentCount: number, eligibleChildCount: number): boolean {
  return activeStudentCount === 1 && eligibleChildCount > 0;
}

export function parseEligibleBalletChildIds(value: string | string[] | undefined): number[] | null {
  if (value == null) return null;
  const joined = Array.isArray(value) ? value.join(",") : value;
  return [...new Set(
    joined
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((id) => Number.isInteger(id) && id > 0),
  )];
}

export function buildEffectiveEligibleBalletChildIds(
  routedEligibleChildIds: readonly number[] | null,
  sessionCreatedChildIds: ReadonlySet<number>,
): ReadonlySet<number> | null {
  if (routedEligibleChildIds == null) return null;
  return new Set([...routedEligibleChildIds, ...sessionCreatedChildIds]);
}

export function shouldLockSingleRoutedBalletChild(input: {
  hasRoutedAllowList: boolean;
  applicationsReady: boolean;
  visibleChildCount: number;
  sessionCreatedChildCount: number;
}): boolean {
  return input.hasRoutedAllowList
    && input.applicationsReady
    && input.visibleChildCount === 1
    && input.sessionCreatedChildCount === 0;
}
