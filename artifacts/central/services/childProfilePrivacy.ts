/**
 * Security Wave — Mobile SecureStore / Privacy Hardening.
 *
 * Children's medical/emergency-contact fields must never sit in AsyncStorage
 * (an unencrypted on-device store) as a durable offline cache. They stay in
 * React state for the current session (my-qr, the children/medical forms,
 * etc. all keep working normally in-memory) but every write of the local
 * "children" cache in contexts/AppContext.tsx passes through this stripped
 * shape instead — the full profile is re-fetched from the API on next load
 * rather than cached sensitive fields surviving an app restart.
 *
 * Kept as a standalone, dependency-free module (same pattern as
 * passwordRecoveryFlow.ts / logoutCoordinator.ts) so it is unit-testable in
 * pure Node — contexts/AppContext.tsx itself pulls in React Native and
 * cannot be imported by a plain node:test file.
 */

/** Minimal structural shape this function needs — duck-typed against
 *  AppContext.tsx's ChildProfile rather than importing that type, so this
 *  module stays free of any React Native import. */
export type ChildProfileLike = {
  medicalNotes?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
};

const SENSITIVE_CHILD_FIELDS = ["medicalNotes", "emergencyContactName", "emergencyContactPhone"] as const;

export function stripSensitiveChildFields<T extends ChildProfileLike>(
  list: T[],
): Omit<T, "medicalNotes" | "emergencyContactName" | "emergencyContactPhone">[] {
  return list.map((child) => {
    const copy: Record<string, unknown> = { ...child };
    for (const field of SENSITIVE_CHILD_FIELDS) delete copy[field];
    return copy as Omit<T, "medicalNotes" | "emergencyContactName" | "emergencyContactPhone">;
  });
}
