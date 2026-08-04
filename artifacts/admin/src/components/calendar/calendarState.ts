import { format, parseISO, isValid } from "date-fns";

export type CalendarViewMode = "week" | "day" | "resource";

export interface CalendarUrlState {
  view: CalendarViewMode;
  date: string; // yyyy-MM-dd
  branchId: number | null;
  roomId: number | null;
}

const STORAGE_KEY = "admin_calendar_preferred_state";

export function getTodayString(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function parseCalendarUrlState(search: string): CalendarUrlState {
  const searchStr = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(searchStr);

  const rawView = params.get("view");
  let view: CalendarViewMode = "week";
  if (rawView === "day" || rawView === "resource" || rawView === "week") {
    view = rawView;
  }

  // 2. Focused Date
  const rawDate = params.get("date");
  let date = getTodayString();
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const parsed = parseISO(rawDate);
    if (isValid(parsed)) {
      date = rawDate;
    }
  }

  // 3. Branch ID
  const rawBranch = params.get("branchId");
  const branchId = rawBranch && !isNaN(Number(rawBranch)) ? Number(rawBranch) : null;

  // 4. Room ID
  const rawRoom = params.get("roomId");
  const roomId = rawRoom && !isNaN(Number(rawRoom)) ? Number(rawRoom) : null;

  return { view, date, branchId, roomId };
}

export function buildCalendarUrl(
  updates: Partial<CalendarUrlState>,
  current?: CalendarUrlState,
): string {
  const merged: CalendarUrlState = {
    view: updates.view ?? current?.view ?? "week",
    date: updates.date ?? current?.date ?? getTodayString(),
    branchId: updates.branchId !== undefined ? updates.branchId : (current?.branchId ?? null),
    roomId: updates.roomId !== undefined ? updates.roomId : (current?.roomId ?? null),
  };

  const params = new URLSearchParams();
  if (merged.view !== "week") {
    params.set("view", merged.view);
  }
  if (merged.date) {
    params.set("date", merged.date);
  }
  if (merged.branchId != null) {
    params.set("branchId", String(merged.branchId));
  }
  if (merged.roomId != null) {
    params.set("roomId", String(merged.roomId));
  }

  const query = params.toString();
  return query ? `/calendar?${query}` : "/calendar";
}

export function savePreferredCalendarState(state: Partial<CalendarUrlState>): void {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    const prev = existing ? JSON.parse(existing) : {};
    const updated = { ...prev, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors
  }
}

export function getPreferredCalendarState(): Partial<CalendarUrlState> | null {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    return existing ? JSON.parse(existing) : null;
  } catch {
    return null;
  }
}
