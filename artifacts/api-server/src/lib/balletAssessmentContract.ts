export type StoredChildDob = {
  dateOfBirth?: string | null;
  birthday?: string | null;
};

/**
 * Resolves the canonical DOB for a stored child profile.
 *
 * `dateOfBirth` is the current canonical column. `birthday` remains a
 * compatibility fallback for child rows created before the canonical field
 * was introduced.
 */
export function resolveStoredChildDob(child: StoredChildDob): string | null {
  return child.dateOfBirth ?? child.birthday ?? null;
}

/** Stable, channel-independent reference that requires no additional DB state. */
export function balletApplicationDisplayReference(applicationId: number): string {
  return `BALLET-${applicationId}`;
}
