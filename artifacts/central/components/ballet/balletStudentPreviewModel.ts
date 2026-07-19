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
}

export interface BalletEligibleChildSource {
  id: string;
  fullName: string;
  birthday: string;
}

export interface BalletStudentPreviewDetailSource {
  currentPayment: {
    subscriptionDisplayStatus?: string | null;
  } | null;
}

export interface BalletStudentPreview {
  key: string;
  applicationId: number;
  childId: number | null;
  childName: string;
  childGender: string | null;
  levelName: string;
  groupName: string;
  weeklyClassCount: number | null;
  subscriptionState: string;
}

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

export function selectActiveBalletStudents(input: {
  applications: BalletStudentPreviewApplicationSource[];
  detailsByApplicationId: ReadonlyMap<number, BalletStudentPreviewDetailSource | null>;
  levelNameById: ReadonlyMap<number, string>;
  groupNameById: ReadonlyMap<number, string>;
}): BalletStudentPreview[] {
  return input.applications
    .filter((application) => application.status === "active")
    .map((application) => {
      const subscriptionDisplayStatus = input.detailsByApplicationId
        .get(application.id)
        ?.currentPayment
        ?.subscriptionDisplayStatus
        ?.trim();

      return {
        key: `application:${application.id}:child:${application.childId ?? "legacy"}`,
        applicationId: application.id,
        childId: application.childId,
        childName: application.childName,
        childGender: application.childGender,
        levelName: application.assignedLevelId == null
          ? "Level not assigned"
          : input.levelNameById.get(application.assignedLevelId) ?? "Level not assigned",
        groupName: application.assignedGroupId == null
          ? "Group not assigned"
          : input.groupNameById.get(application.assignedGroupId) ?? "Group not assigned",
        weeklyClassCount: application.resolvedSchedules == null || application.resolvedSchedules.length === 0
          ? null
          : application.resolvedSchedules.length,
        subscriptionState: subscriptionDisplayStatus || "Subscription unavailable",
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
