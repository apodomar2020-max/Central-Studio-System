export type BalletMyClassesEntitlementState =
  | "no_application"
  | "application_pending"
  | "assessment_pending"
  | "assignment_pending"
  | "payment_pending"
  | "activation_pending"
  | "schedule_pending"
  | "active"
  | "rejected"
  | "cancelled"
  | "withdrawn";

export interface BalletMyClassesChildRow {
  id: number;
  parentId: number;
  fullName: string;
}

export interface BalletMyClassesApplicationRow {
  id: number;
  parentStudentId: number | null;
  childId: number | null;
  childName: string;
  childBirthday: string | null;
  status: string;
  assignedLevelId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BalletMyClassesAssignmentRow {
  id: number;
  applicationId: number;
  childId: number | null;
  levelId: number;
  groupId: number | null;
  status: string;
  levelName: string;
  levelIsActive: boolean;
  groupName: string | null;
  groupLevelId: number | null;
  groupIsActive: boolean | null;
}

export interface BalletMyClassesClassRow {
  id: number;
  title: string;
  levelId: number | null;
  groupId: number | null;
  classImageUrl: string | null;
  classVideoUrl: string | null;
  isActive: boolean;
  isLegacy: boolean;
  levelName: string;
  levelIsActive: boolean;
  groupName: string;
  groupLevelId: number;
  groupIsActive: boolean;
  instructorId: number | null;
  instructorName: string | null;
  instructorPhotoUrl: string | null;
  instructorIsActive: boolean | null;
}

export interface BalletMyClassesScheduleRow {
  id: number;
  classId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  durationMins: number | null;
  status: string;
}

export interface BalletMyClassesSchedule {
  id: number;
  classId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  durationMins: number;
  status: "active";
}

export interface BalletMyClassesClass {
  id: number;
  title: string;
  levelId: number;
  groupId: number;
  classImageUrl: string | null;
  classVideoUrl: string | null;
  level: { id: number; name: string };
  group: { id: number; name: string };
  instructor: { id: number; name: string; photoUrl: string | null };
  schedules: BalletMyClassesSchedule[];
  /** @deprecated Compatibility alias only. New clients use schedules[]. */
  schedule: BalletMyClassesSchedule | null;
}

export interface BalletMyClassesChild {
  selectorKey: string;
  childId: number | null;
  applicationId: number | null;
  childName: string;
  applicationStatus: string | null;
  entitlementState: BalletMyClassesEntitlementState;
  level: { id: number; name: string } | null;
  group: { id: number; name: string } | null;
  weeklyScheduleCount: number;
  classes: BalletMyClassesClass[];
}

interface BuildInput {
  parentStudentId: number;
  children: BalletMyClassesChildRow[];
  applications: BalletMyClassesApplicationRow[];
  assignments: BalletMyClassesAssignmentRow[];
  activeSubscriptionApplicationIds: ReadonlySet<number>;
  classes: BalletMyClassesClassRow[];
  schedules: BalletMyClassesScheduleRow[];
}

const OPEN_APPLICATION_STATUSES = new Set(["pending", "needsFollowUp", "accepted", "assignedToLevel", "active"]);
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function applicationPriority(application: BalletMyClassesApplicationRow): number {
  if (application.status === "active") return 3;
  if (OPEN_APPLICATION_STATUSES.has(application.status)) return 2;
  return 1;
}

export function selectAuthoritativeBalletApplication(
  applications: BalletMyClassesApplicationRow[],
): BalletMyClassesApplicationRow | null {
  return applications.slice().sort((a, b) => (
    applicationPriority(b) - applicationPriority(a)
    || timestamp(b.updatedAt) - timestamp(a.updatedAt)
    || timestamp(b.createdAt) - timestamp(a.createdAt)
    || b.id - a.id
  ))[0] ?? null;
}

function validAssignment(
  application: BalletMyClassesApplicationRow,
  assignments: BalletMyClassesAssignmentRow[],
): BalletMyClassesAssignmentRow | null {
  return assignments
    .filter((assignment) => assignment.applicationId === application.id
      && assignment.status === "active"
      && (application.childId == null || assignment.childId === application.childId)
      && assignment.groupId != null
      && assignment.levelId === application.assignedLevelId
      && assignment.levelIsActive
      && assignment.groupIsActive === true
      && assignment.groupLevelId === assignment.levelId)
    .sort((a, b) => b.id - a.id)[0] ?? null;
}

function scheduleMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function normalizeSchedule(row: BalletMyClassesScheduleRow): BalletMyClassesSchedule | null {
  const startTime = row.startTime.trim();
  const endTime = row.endTime.trim();
  const duration = scheduleMinutes(endTime) - scheduleMinutes(startTime);
  if (row.status !== "active"
    || !Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 0 || row.dayOfWeek > 6
    || !TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)
    || endTime <= startTime
    || row.durationMins == null || row.durationMins <= 0 || row.durationMins !== duration) return null;
  return { ...row, startTime, endTime, durationMins: row.durationMins, status: "active" };
}

function compareSchedules(a: BalletMyClassesSchedule, b: BalletMyClassesSchedule): number {
  return a.dayOfWeek - b.dayOfWeek
    || a.startTime.localeCompare(b.startTime)
    || a.endTime.localeCompare(b.endTime)
    || a.id - b.id;
}

function operationalClasses(
  assignment: BalletMyClassesAssignmentRow,
  classes: BalletMyClassesClassRow[],
  schedules: BalletMyClassesScheduleRow[],
): BalletMyClassesClass[] {
  const schedulesByClassId = new Map<number, Map<number, BalletMyClassesSchedule>>();
  for (const row of schedules) {
    const schedule = normalizeSchedule(row);
    if (!schedule) continue;
    const classSchedules = schedulesByClassId.get(schedule.classId) ?? new Map<number, BalletMyClassesSchedule>();
    if (!classSchedules.has(schedule.id)) classSchedules.set(schedule.id, schedule);
    schedulesByClassId.set(schedule.classId, classSchedules);
  }

  return classes
    .filter((row) => row.levelId === assignment.levelId
      && row.groupId === assignment.groupId
      && row.isActive
      && !row.isLegacy
      && row.levelIsActive
      && row.groupIsActive
      && row.groupLevelId === row.levelId
      && row.instructorId != null
      && row.instructorName != null
      && row.instructorIsActive === true)
    .map((row): BalletMyClassesClass | null => {
      const classSchedules = [...(schedulesByClassId.get(row.id)?.values() ?? [])].sort(compareSchedules);
      if (classSchedules.length === 0 || row.levelId == null || row.groupId == null || row.instructorId == null || row.instructorName == null) return null;
      return {
        id: row.id,
        title: row.title,
        levelId: row.levelId,
        groupId: row.groupId,
        classImageUrl: row.classImageUrl,
        classVideoUrl: row.classVideoUrl,
        level: { id: row.levelId, name: row.levelName },
        group: { id: row.groupId, name: row.groupName },
        instructor: { id: row.instructorId, name: row.instructorName, photoUrl: row.instructorPhotoUrl },
        schedules: classSchedules,
        schedule: classSchedules[0] ?? null,
      };
    })
    .filter((row): row is BalletMyClassesClass => row != null)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);
}

function terminalState(status: string): BalletMyClassesEntitlementState | null {
  if (status === "rejected" || status === "cancelled" || status === "withdrawn") return status;
  return null;
}

function buildChild(
  child: { selectorKey: string; childId: number | null; childName: string },
  application: BalletMyClassesApplicationRow | null,
  input: BuildInput,
): BalletMyClassesChild {
  if (!application) {
    return { ...child, applicationId: null, applicationStatus: null, entitlementState: "no_application", level: null, group: null, weeklyScheduleCount: 0, classes: [] };
  }

  const terminal = terminalState(application.status);
  if (terminal) {
    return { ...child, applicationId: application.id, applicationStatus: application.status, entitlementState: terminal, level: null, group: null, weeklyScheduleCount: 0, classes: [] };
  }

  const assignment = validAssignment(application, input.assignments);
  const level = assignment ? { id: assignment.levelId, name: assignment.levelName } : null;
  const group = assignment?.groupId != null && assignment.groupName
    ? { id: assignment.groupId, name: assignment.groupName }
    : null;
  const base = { ...child, applicationId: application.id, applicationStatus: application.status, level, group };

  if (application.status === "pending") return { ...base, entitlementState: "application_pending", weeklyScheduleCount: 0, classes: [] };
  if (application.status === "needsFollowUp") return { ...base, entitlementState: "assessment_pending", weeklyScheduleCount: 0, classes: [] };
  if (application.status === "accepted") return { ...base, entitlementState: "assignment_pending", weeklyScheduleCount: 0, classes: [] };
  if (!assignment) return { ...base, entitlementState: "assignment_pending", weeklyScheduleCount: 0, classes: [] };
  if (!input.activeSubscriptionApplicationIds.has(application.id)) return { ...base, entitlementState: "payment_pending", weeklyScheduleCount: 0, classes: [] };
  if (application.status !== "active") return { ...base, entitlementState: "activation_pending", weeklyScheduleCount: 0, classes: [] };

  const classes = operationalClasses(assignment, input.classes, input.schedules);
  const weeklyScheduleCount = classes.reduce((total, item) => total + item.schedules.length, 0);
  return {
    ...base,
    entitlementState: weeklyScheduleCount > 0 ? "active" : "schedule_pending",
    weeklyScheduleCount,
    classes,
  };
}

export function buildMyBalletClassesResponse(input: BuildInput): { children: BalletMyClassesChild[] } {
  const ownedChildren = input.children
    .filter((child) => child.parentId === input.parentStudentId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id - b.id);
  const ownedApplications = input.applications.filter((application) => application.parentStudentId === input.parentStudentId);

  const children = ownedChildren.map((child) => buildChild(
    { selectorKey: `child:${child.id}`, childId: child.id, childName: child.fullName },
    selectAuthoritativeBalletApplication(ownedApplications.filter((application) => application.childId === child.id)),
    input,
  ));

  const legacyByIdentity = new Map<string, BalletMyClassesApplicationRow[]>();
  for (const application of ownedApplications) {
    if (application.childId != null) continue;
    const key = `${application.childName.trim().toLowerCase()}:${application.childBirthday ?? "unknown"}`;
    const rows = legacyByIdentity.get(key) ?? [];
    rows.push(application);
    legacyByIdentity.set(key, rows);
  }
  for (const applications of legacyByIdentity.values()) {
    const application = selectAuthoritativeBalletApplication(applications);
    if (!application) continue;
    children.push(buildChild(
      { selectorKey: `application:${application.id}`, childId: null, childName: application.childName },
      application,
      input,
    ));
  }

  return { children };
}
