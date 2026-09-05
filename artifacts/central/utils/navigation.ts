import { router } from "expo-router";

import { claimNavigationTarget, releaseNavigationTarget } from "@/utils/navigationPressGate";

type RouterPushArguments = Parameters<typeof router.push>;

/**
 * Drop rapid duplicate pushes to the same destination before Expo Router can
 * add duplicate screens to the native stack. Different destinations are not
 * blocked, and replace/back behavior remains untouched.
 */
export function pushOnce(...args: RouterPushArguments): boolean {
  const target = args[0];
  if (!claimNavigationTarget(target)) return false;

  try {
    router.push(...args);
    return true;
  } catch (error) {
    releaseNavigationTarget(target);
    throw error;
  }
}

/**
 * Defensive navigation for admin/CMS-configured routes (e.g. the Hero tap path).
 * Only known internal app paths are accepted.
 */
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
  "verify-email",
  "index",
]);

const SAFE_PATH = /^\/[A-Za-z0-9_\-/()[\].:?=&%]*$/;

export function isSafeAppRoute(route: string | null | undefined): route is string {
  if (typeof route !== "string") return false;
  const normalized = route.trim();
  if (!normalized) return false;
  if (normalized === "/") return true;
  if (!normalized.startsWith("/") || !SAFE_PATH.test(normalized)) return false;
  const firstSegment = normalized.slice(1).split(/[/?#]/)[0];
  return KNOWN_ROOT_SEGMENTS.has(firstSegment);
}

export function safePush(route: string | null | undefined): boolean {
  if (!isSafeAppRoute(route)) return false;
  try {
    return pushOnce(route as never);
  } catch {
    return false;
  }
}
