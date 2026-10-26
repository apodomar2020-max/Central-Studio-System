import { resolveNotificationRoute, type NotificationRoute } from "./notificationNavigation";

export interface NotificationIntent { key: string; data: unknown; owner: string | null }
export interface NotificationIntentState {
  account: string | null;
  pending: NotificationIntent | null;
  seen: string[];
}
export const initialNotificationIntentState: NotificationIntentState = { account: null, pending: null, seen: [] };
type Event = { type: "session"; account: string | null } | { type: "receive"; key: string; data: unknown } | { type: "consume"; key: string };

/** Initial restoration/login binds an anonymous intent; a known account change discards it. */
export function notificationIntentReducer(state: NotificationIntentState, event: Event): NotificationIntentState {
  if (event.type === "session") {
    if (state.account === event.account) return state;
    const switched = state.account !== null;
    return { ...state, account: event.account, pending: switched ? null : state.pending && { ...state.pending, owner: event.account } };
  }
  if (event.type === "consume") return state.pending?.key === event.key ? { ...state, pending: null } : state;
  if (state.seen.includes(event.key)) return state;
  return { ...state, seen: [...state.seen.slice(-127), event.key], pending: { key: event.key, data: event.data, owner: state.account } };
}

export function notificationNavigationReady(loading: boolean, account: string | null, verified: boolean, rootReady: boolean, pathname: string, inTabs = false): boolean {
  return !loading && !!account && verified && rootReady && (inTabs || (pathname !== "/" && pathname !== "/index"))
    && !/^\/(auth|onboarding)(\/|$)/.test(pathname) && pathname !== "/verify-email";
}

/** List destinations contain only the current session's data. Entity destinations must be server-authorized. */
export async function notificationIntentRoute(data: unknown, fetchVisible: () => Promise<Array<{ id: number; type?: string | null; metadata?: unknown }>>): Promise<NotificationRoute> {
  const route = resolveNotificationRoute(data);
  if (!route.startsWith("/ballet/application-status?id=")) return route;
  const id = data && typeof data === "object" ? (data as Record<string, unknown>).notificationId : null;
  if (!id) return "/notifications";
  try {
    const visible = (await fetchVisible()).find(row => String(row.id) === String(id));
    return visible ? resolveNotificationRoute(visible) : "/notifications";
  } catch { return "/notifications"; }
}
