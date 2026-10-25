/** One registry for intentional route modals; component sheets are unrelated. */
export const AUTH_MODAL_SCREENS = [
  { name: "auth/login", animation: "slide_from_bottom" },
  { name: "auth/register", animation: "slide_from_bottom" },
  { name: "auth/complete-profile", animation: "slide_from_bottom" },
  { name: "auth/forgot-password", animation: "slide_from_bottom" },
  { name: "auth/otp-verification", animation: "slide_from_right" },
  { name: "auth/reset-password", animation: "slide_from_bottom" },
] as const;

const authModalNames = new Set<string>(AUTH_MODAL_SCREENS.map(({ name }) => name));

export function normalRoutePresentation(platform: string) {
  return platform === "ios" ? { presentation: "card" as const } : {};
}

type RootStack = {
  index?: number;
  routes: readonly { key?: string; name: string; state?: RootStack }[];
};

/**
 * A push into the root stack cannot cover an outstanding UIKit modal. Once the
 * active root route leaves the auth flow, remove its obsolete modal history in
 * the same reset as the destination. Keep route keys, params and nested tab state
 * intact; never choose a destination or change authentication state here.
 */
export function completedAuthModalHistory<State extends RootStack>(
  state: State | undefined,
  platform: string,
): State | null {
  if (platform !== "ios" || !state) return null;
  const active = state.routes[state.index ?? 0];
  if (!active || authModalNames.has(active.name)) return null;

  const routes = state.routes.filter((route) => !authModalNames.has(route.name));
  // Expo Router 57 wraps the application's stack in a generated __root slot.
  // Traverse only the active branch, preserving that wrapper and nested tabs.
  const child = completedAuthModalHistory(active.state, platform);
  if (routes.length === state.routes.length && !child) return null;

  return {
    ...state,
    routes: child ? routes.map((route) => route === active ? { ...route, state: child } : route) : routes,
    index: routes.indexOf(active),
  };
}
