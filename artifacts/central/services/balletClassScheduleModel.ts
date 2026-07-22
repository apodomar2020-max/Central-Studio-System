export interface BalletClassSchedule {
  id: number | null;
  classId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  durationMins: number;
  status: "active";
}

export interface BalletClass {
  id: number;
  title: string;
  classImageUrl: string | null;
  classVideoUrl: string | null;
  instructor: { id: number; name: string; photoUrl: string | null; isActive?: boolean };
  groupId: number;
  levelId: number;
  schedules: BalletClassSchedule[];
  /** @deprecated Compatibility alias only. New code must use schedules[]. */
  schedule: BalletClassSchedule | null;
}

type ClassFilter = { groupId?: number; levelId?: number };
type UnknownRecord = Record<string, unknown>;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function minuteOfDay(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function scheduleKey(schedule: BalletClassSchedule): string {
  return schedule.id != null
    ? `id:${schedule.id}`
    : `slot:${schedule.classId}:${schedule.dayOfWeek}:${schedule.startTime}:${schedule.endTime}`;
}

function compareSchedules(a: BalletClassSchedule, b: BalletClassSchedule): number {
  return a.dayOfWeek - b.dayOfWeek
    || a.startTime.localeCompare(b.startTime)
    || a.endTime.localeCompare(b.endTime)
    || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER);
}

function normalizeSchedule(value: unknown, parentClassId: number): BalletClassSchedule | null {
  const row = asRecord(value);
  if (!row) return null;

  const dayOfWeek = Number(row.dayOfWeek);
  const startTime = typeof row.startTime === "string" ? row.startTime.trim() : "";
  const endTime = typeof row.endTime === "string" ? row.endTime.trim() : "";
  const durationMins = Number(row.durationMins);
  const status = typeof row.status === "string" ? row.status : "active";
  const derivedDuration = minuteOfDay(endTime) - minuteOfDay(startTime);

  if (status !== "active"
    || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6
    || !TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)
    || endTime <= startTime
    || !Number.isFinite(durationMins) || durationMins <= 0
    || durationMins !== derivedDuration) return null;

  return {
    id: positiveInteger(row.id),
    classId: positiveInteger(row.classId) ?? parentClassId,
    dayOfWeek,
    startTime,
    endTime,
    durationMins,
    status: "active",
  };
}

function deduplicateSchedules(schedules: BalletClassSchedule[]): BalletClassSchedule[] {
  const byKey = new Map<string, BalletClassSchedule>();
  for (const schedule of schedules) {
    const key = scheduleKey(schedule);
    if (!byKey.has(key)) byKey.set(key, schedule);
  }
  return [...byKey.values()].sort(compareSchedules);
}

function normalizeClass(value: unknown): BalletClass | null {
  const row = asRecord(value);
  if (!row) return null;

  const id = positiveInteger(row.id);
  const levelId = positiveInteger(row.levelId);
  const groupId = positiveInteger(row.groupId);
  const instructor = asRecord(row.instructor);
  const instructorId = positiveInteger(instructor?.id);
  if (id == null || levelId == null || groupId == null || instructorId == null
    || row.isLegacy === true || row.isActive === false || instructor?.isActive === false) return null;

  const level = asRecord(row.level);
  const group = asRecord(row.group);
  if (level?.isActive === false || group?.isActive === false
    || (positiveInteger(level?.id) != null && positiveInteger(level?.id) !== levelId)
    || (positiveInteger(group?.id) != null && positiveInteger(group?.id) !== groupId)
    || (positiveInteger(group?.levelId) != null && positiveInteger(group?.levelId) !== levelId)) return null;

  const scheduleSource = Array.isArray(row.schedules)
    ? row.schedules
    : row.schedule != null
      ? [row.schedule]
      : [];
  const schedules = deduplicateSchedules(
    scheduleSource.map((schedule) => normalizeSchedule(schedule, id)).filter((schedule): schedule is BalletClassSchedule => schedule != null),
  );

  return {
    id,
    title: typeof row.title === "string" ? row.title : "Ballet Class",
    classImageUrl: typeof row.classImageUrl === "string" ? row.classImageUrl : null,
    classVideoUrl: typeof row.classVideoUrl === "string" ? row.classVideoUrl : null,
    instructor: {
      id: instructorId,
      name: typeof instructor?.name === "string" ? instructor.name : "Ballet Instructor",
      photoUrl: typeof instructor?.photoUrl === "string" ? instructor.photoUrl : null,
      isActive: instructor?.isActive !== false,
    },
    groupId,
    levelId,
    schedules,
    schedule: schedules[0] ?? null,
  };
}

export function normalizeBalletClasses(values: unknown): BalletClass[] {
  if (!Array.isArray(values)) return [];
  const byClassId = new Map<number, BalletClass>();

  for (const value of values) {
    const item = normalizeClass(value);
    if (!item) continue;
    const existing = byClassId.get(item.id);
    if (!existing) {
      byClassId.set(item.id, item);
      continue;
    }
    const schedules = deduplicateSchedules([...existing.schedules, ...item.schedules]);
    byClassId.set(item.id, { ...existing, schedules, schedule: schedules[0] ?? null });
  }

  return [...byClassId.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);
}

export function selectOperationalBalletClasses(classes: BalletClass[], filter: ClassFilter = {}): BalletClass[] {
  return classes.filter((item) => item.schedules.length > 0
    && (filter.groupId == null || item.groupId === filter.groupId)
    && (filter.levelId == null || item.levelId === filter.levelId));
}

export function countActiveBalletWeeklySchedules(classes: BalletClass[]): number {
  return classes.reduce((total, item) => total + item.schedules.length, 0);
}

export function groupBalletSchedulesByGroupId(classes: BalletClass[]): Map<number, BalletClassSchedule[]> {
  const result = new Map<number, BalletClassSchedule[]>();
  for (const item of selectOperationalBalletClasses(classes)) {
    result.set(item.groupId, deduplicateSchedules([...(result.get(item.groupId) ?? []), ...item.schedules]));
  }
  return result;
}
