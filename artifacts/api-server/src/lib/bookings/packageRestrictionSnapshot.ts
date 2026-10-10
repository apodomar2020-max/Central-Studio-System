/** Historical entitlements never consult mutable catalogue restrictions. */
export function evaluatePackageRestrictionSnapshot(
  order: {
    allowedDanceTypeIdsSnapshot: number[] | null;
    danceTypeRestrictionStateSnapshot: string | null;
  },
  danceTypeId: number | null,
): { ok: true } | { ok: false; code: "PACKAGE_CREDIT_INTEGRITY_MISMATCH" | "PACKAGE_DANCE_TYPE_MISMATCH"; message: string } {
  const ids = order.allowedDanceTypeIdsSnapshot;
  const state = order.danceTypeRestrictionStateSnapshot;
  const unavailable = {
    ok: false as const,
    code: "PACKAGE_CREDIT_INTEGRITY_MISMATCH" as const,
    message: "The selected package's historical restrictions could not be verified.",
  };
  if (ids == null || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return unavailable;
  if (state !== null && state !== "restricted" && state !== "unrestricted") return unavailable;
  if (state === "unrestricted") return ids.length === 0 ? { ok: true } : unavailable;
  // Old non-empty snapshots are affirmative restriction evidence. Old empty
  // snapshots are ambiguous: the former writer also captured [] for text-only
  // restrictions. Neither missing evidence nor today's catalogue can grant access.
  if (ids.length === 0) return unavailable;
  if (danceTypeId == null || !ids.includes(danceTypeId)) {
    return { ok: false, code: "PACKAGE_DANCE_TYPE_MISMATCH", message: "The selected package cannot be used for this dance type." };
  }
  return { ok: true };
}
