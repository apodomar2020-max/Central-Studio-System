/**
 * UI permission helpers (Phase 2 — UI visibility enforcement only).
 *
 * All checks go through AdminAuthContext.can(module, action), which already
 * returns true for Super Admin, so Super Admin bypass is automatic everywhere.
 * Missing permission => default deny for ordinary admins.
 *
 * NOTE: This is presentation-only. The backend is NOT guarded yet, so these
 * helpers must not be relied on for security — only for hiding/disabling UI.
 */
import React from "react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { AccessDenied } from "@/components/access-denied";

export type PermCheck = (module: string, action: string) => boolean;

/** A requirement satisfied if ANY of the listed [module, action] pairs is granted. */
export type PermRequirement = ReadonlyArray<readonly [string, string]>;
export type PermRequirementMode = "any" | "all";

/** True if `can` satisfies the requirement (empty/omitted requirement = always allowed). */
export function allows(
  can: PermCheck,
  req?: PermRequirement,
  mode: PermRequirementMode = "any",
): boolean {
  if (!req || req.length === 0) return true;
  const predicate = ([module, action]: readonly [string, string]) => can(module, action);
  return mode === "all" ? req.every(predicate) : req.some(predicate);
}

/**
 * RouteGuard — renders children only if the current admin satisfies `req`,
 * otherwise shows the Access Denied page. Super Admin always passes (via can()).
 */
export function RouteGuard({
  req,
  mode = "any",
  children,
}: {
  req: PermRequirement;
  mode?: PermRequirementMode;
  children: React.ReactNode;
}) {
  const { can } = useAdminAuth();
  if (!allows(can, req, mode)) {
    return <AccessDenied message="You do not have permission to access this page." />;
  }
  return <>{children}</>;
}
