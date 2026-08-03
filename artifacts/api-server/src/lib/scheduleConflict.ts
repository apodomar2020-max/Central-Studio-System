/**
 * Schedule conflict detection engine — Phase 2A (foundation only).
 *
 * A pure, deterministic library with NO database or Express dependency: it
 * operates entirely on plain `ScheduleOccupancy` records the caller already
 * has in hand. This is deliberate — Phase 2A builds and unit-tests the
 * detection logic in isolation; wiring it into routes/schedules.ts and
 * routes/adminBalletSchedules.ts (fetching candidates from `schedules` and
 * `ballet_schedules`, taking the appropriate row locks, mapping DB rows into
 * ScheduleOccupancy) is explicitly a later phase, not part of this file.
 *
 * Mirrors the existing conflict-check idiom already used for ballet
 * class-level duplicate/overlap checks (routes/adminBalletSchedules.ts:
 * findDuplicateScheduleId / findOverlappingScheduleId / assertScheduleSlotAvailable)
 * and the error shape of ScheduleLocationError (lib/scheduleLocation.ts) —
 * {status, code, message} — but generalized from "one class's own slots" to
 * "any two schedules sharing a physical room", across both the regular
 * Studio and Ballet systems.
 *
 * Conflict rule: two ACTIVE occupancies conflict when they share the same
 * branch AND room, and their day/date + time ranges overlap:
 *   - weekly vs weekly   — same dayOfWeek, and their effectiveFrom/effectiveUntil
 *                          windows overlap (an unset bound is unbounded)
 *   - one_time vs one_time — same date
 *   - weekly vs one_time  — the one_time's date falls on the weekly's dayOfWeek
 *                          and inside its effective window, if any
 * A schedule with no branch/room assigned never conflicts with anything —
 * there is no physical resource to double-book. A non-"active" schedule
 * (cancelled / expired / completed / deactivated) never blocks — it has
 * freed the room. Regular ("class") and Ballet ("ballet") schedules are
 * compared by the same rules; `source` is carried only for UI attribution,
 * not as a factor in whether a conflict exists.
 */
import { isoDateDayOfWeek } from "./occurrence";

export type ScheduleSource = "class" | "ballet" | "reservation";

export type ScheduleRecurrence =
  | { type: "weekly"; dayOfWeek: number; effectiveFrom: string | null; effectiveUntil: string | null }
  | { type: "one_time"; date: string };

/**
 * A single schedule's room-occupancy, normalized from either `schedules` or
 * `ballet_schedules`. `id: null` represents a not-yet-created candidate
 * (POST); existing occupancies being checked against always carry their real
 * row id, used to exclude a schedule from conflicting with its own prior
 * state on update.
 */
export interface ScheduleOccupancy {
  id: number | null;
  source: ScheduleSource;
  branchId: number | null;
  roomId: number | null;
  /** Raw status string from either table's status enum. Only "active" occupies a room. */
  status: string;
  startTime: string;
  endTime: string;
  recurrence: ScheduleRecurrence;
  /** For future UI (Phase 2D) — omitted/null when unknown. */
  classTitle?: string | null;
}

const ACTIVE_STATUS = "active";

function isOccupying(occupancy: ScheduleOccupancy): boolean {
  return occupancy.status === ACTIVE_STATUS;
}

function hasResolvedLocation(occupancy: ScheduleOccupancy): boolean {
  return occupancy.branchId != null && occupancy.roomId != null;
}

function sameLocation(a: ScheduleOccupancy, b: ScheduleOccupancy): boolean {
  return a.branchId === b.branchId && a.roomId === b.roomId;
}

function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Null bounds are unbounded — sentinel min/max keep this a plain string comparison. */
function effectiveRangesOverlap(
  aFrom: string | null, aUntil: string | null,
  bFrom: string | null, bUntil: string | null,
): boolean {
  const aStart = aFrom ?? "0000-01-01";
  const aEnd = aUntil ?? "9999-12-31";
  const bStart = bFrom ?? "0000-01-01";
  const bEnd = bUntil ?? "9999-12-31";
  return aStart <= bEnd && aEnd >= bStart;
}

function dateWithinWeeklyWindow(date: string, effectiveFrom: string | null, effectiveUntil: string | null): boolean {
  if (effectiveFrom && effectiveFrom > date) return false;
  if (effectiveUntil && effectiveUntil < date) return false;
  return true;
}

function recurrenceOverlaps(a: ScheduleRecurrence, b: ScheduleRecurrence): boolean {
  if (a.type === "weekly" && b.type === "weekly") {
    return a.dayOfWeek === b.dayOfWeek && effectiveRangesOverlap(a.effectiveFrom, a.effectiveUntil, b.effectiveFrom, b.effectiveUntil);
  }
  if (a.type === "one_time" && b.type === "one_time") {
    return a.date === b.date;
  }
  const weekly = a.type === "weekly" ? a : (b as Extract<ScheduleRecurrence, { type: "weekly" }>);
  const oneTime = a.type === "one_time" ? a : (b as Extract<ScheduleRecurrence, { type: "one_time" }>);
  if (isoDateDayOfWeek(oneTime.date) !== weekly.dayOfWeek) return false;
  return dateWithinWeeklyWindow(oneTime.date, weekly.effectiveFrom, weekly.effectiveUntil);
}

function isSameRow(a: ScheduleOccupancy, b: ScheduleOccupancy): boolean {
  return a.id != null && b.id != null && a.id === b.id && a.source === b.source;
}

function occupanciesConflict(a: ScheduleOccupancy, b: ScheduleOccupancy): boolean {
  if (isSameRow(a, b)) return false;
  if (!isOccupying(a) || !isOccupying(b)) return false;
  if (!hasResolvedLocation(a) || !hasResolvedLocation(b)) return false;
  if (!sameLocation(a, b)) return false;
  if (!timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) return false;
  return recurrenceOverlaps(a.recurrence, b.recurrence);
}

/**
 * Returns the first existing occupancy that conflicts with `candidate`, or
 * null if none do. Pure — does not throw, does not touch a database.
 */
export function findScheduleConflict(
  candidate: ScheduleOccupancy,
  existing: readonly ScheduleOccupancy[],
): ScheduleOccupancy | null {
  for (const other of existing) {
    if (occupanciesConflict(candidate, other)) return other;
  }
  return null;
}

export type ScheduleConflictErrorCode = "SCHEDULE_TIME_CONFLICT";

export interface ScheduleConflictDetails {
  scheduleId: number;
  source: ScheduleSource;
  classTitle: string | null;
}

/** Mirrors ScheduleLocationError's {status, code, message} shape (lib/scheduleLocation.ts). */
export class ScheduleConflictError extends Error {
  constructor(
    public readonly status: 409,
    public readonly code: ScheduleConflictErrorCode,
    message: string,
    public readonly conflict: ScheduleConflictDetails,
  ) {
    super(message);
  }
}

function describeConflict(conflict: ScheduleOccupancy): ScheduleConflictDetails {
  return {
    // occupanciesConflict only ever matches existing rows, which always carry a real id.
    scheduleId: conflict.id as number,
    source: conflict.source,
    classTitle: conflict.classTitle ?? null,
  };
}

/**
 * Throws ScheduleConflictError if `candidate` overlaps an existing active
 * occupancy in the same branch/room; otherwise returns normally.
 */
export function assertNoScheduleConflict(
  candidate: ScheduleOccupancy,
  existing: readonly ScheduleOccupancy[],
): void {
  const conflict = findScheduleConflict(candidate, existing);
  if (!conflict) return;
  const details = describeConflict(conflict);
  const label = details.classTitle ? ` (${details.classTitle})` : "";
  throw new ScheduleConflictError(
    409,
    "SCHEDULE_TIME_CONFLICT",
    `This room is already booked for an overlapping time${label}.`,
    details,
  );
}
