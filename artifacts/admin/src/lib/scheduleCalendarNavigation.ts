/**
 * Calendar Phase 3 — pure navigation-target builders, deliberately kept
 * dependency-free (no React, no path aliases) so they can be imported both
 * by pages/calendar.tsx (via Vite) and directly by a plain node:test file
 * with no build step. Calendar owns no create/edit UI of its own — every
 * one of these functions only produces a URL into the existing Schedules
 * page (pages/schedules.tsx), which is the only place a schedule is ever
 * actually created or edited. See that file's deep-link `useEffect` for the
 * other half of this contract.
 */

export interface ScheduleCreateContext {
  date?: string | null;
  startTime?: string | null;
  branchId?: number | null;
  roomId?: number | null;
}

export function buildScheduleEditPath(scheduleId: number): string {
  return `/schedules?editScheduleId=${scheduleId}`;
}

export function buildScheduleCreatePath(context: ScheduleCreateContext): string {
  const params = new URLSearchParams();
  if (context.date) params.set("date", context.date);
  if (context.startTime) params.set("startTime", context.startTime);
  if (context.branchId != null) params.set("branchId", String(context.branchId));
  if (context.roomId != null) params.set("roomId", String(context.roomId));
  const query = params.toString();
  return query ? `/schedules?${query}` : "/schedules";
}

/** Ballet has its own separate schedule system (routes/adminBalletSchedules.ts,
 *  pages/ballet/BalletSchedulesPage.tsx) — this phase's deep-link contract
 *  (editScheduleId/date/startTime/branchId/roomId) is specified only for the
 *  regular Schedules page, so a Ballet card navigates to its own list page
 *  rather than inventing an equivalent deep-link contract nobody asked for. */
export function buildBalletScheduleListPath(): string {
  return "/ballet/schedules";
}

/** Rounds a raw pixel offset within the grid to the nearest 30-minute mark,
 *  clamped to the visible operating-hours window. */
export function pixelOffsetToTimeString(offsetMinutes: number, gridStartMin: number, gridEndMin: number): string {
  const clamped = Math.max(gridStartMin, Math.min(gridEndMin, gridStartMin + offsetMinutes));
  const rounded = Math.round(clamped / 30) * 30;
  const hours = Math.floor(rounded / 60) % 24;
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
