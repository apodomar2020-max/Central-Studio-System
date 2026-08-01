export interface ScheduleLocationEntity { name?: string | null }

export interface ScheduleLocationSource {
  branch?: ScheduleLocationEntity | null;
  room?: ScheduleLocationEntity | null;
  legacyLocation?: string | null;
  classLocation?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function scheduleLocationLabel(source: ScheduleLocationSource): string | null {
  const branchName = clean(source.branch?.name);
  const roomName = clean(source.room?.name);
  if (branchName && roomName) return `${branchName} · ${roomName}`;
  return clean(source.legacyLocation) ?? clean(source.classLocation);
}
