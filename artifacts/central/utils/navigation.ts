import { router } from "expo-router";

/**
 * Defensive navigation for admin/CMS-configured routes (e.g. the Hero tap path).
 *
 * Admin-entered routes can be empty, malformed, external, or point at a screen
 * that does not exist. `isSafeAppRoute` validates the target up front and
 * `safePush` navigates only when it is a known, well-formed INTERNAL path —
 * otherwise it ignores the request silently. This prevents crashes, thrown
 * exceptions, and expo-router "unmatched route" warnings/console errors.
 */

// Top-level segments that actually exist under `app/` (file-based routes).
// Keep in sync with the app directory. A configured route whose first segment
// is not here is treated as unavailable and ignored.
const KNOWN_ROOT_SEGMENTS = new Set([
  "(tabs)",
  "auth",
  "ballet",
  "booking",
  "class",
  "instructor",
  "onboarding",
  "dev",
  "attendance-history",
  "change-password",
  "credit-history",
  "edit-profile",
  "help-support",
  "my-qr",
  "notifications",
  "package-center",
  "privacy-policy",
  "two-factor-auth",
  "verify-email",
  "index",
]);

// Conservative path charset: internal paths, route groups, dynamic params,
// and query strings. Rejects spaces, control chars, and external schemes.
const SAFE_PATH = /^\/[A-Za-z0-9_\-/()[\].:?=&%]*$/;

/** True only for a non-empty, well-formed internal path to a known screen. */
export function isSafeAppRoute(route: string | null | undefined): route is string {
  if (typeof route !== "string") return false;
  const r = route.trim();
  if (!r) return false;
  if (r === "/") return true; // home/index
  if (!r.startsWith("/")) return false; // internal only — no http(s)/mailto/etc.
  if (!SAFE_PATH.test(r)) return false; // malformed (spaces/control/invalid chars)
  const firstSegment = r.slice(1).split(/[/?#]/)[0];
  return KNOWN_ROOT_SEGMENTS.has(firstSegment);
}

/**
 * Navigate to a CMS-configured route only if it is valid. Returns true if
 * navigation was attempted. Never throws — invalid routes are ignored safely.
 */
export function safePush(route: string | null | undefined): boolean {
  if (!isSafeAppRoute(route)) return false;
  try {
    router.push(route as never);
    return true;
  } catch {
    return false;
  }
}
