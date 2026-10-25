/** UI mirrors only; the API transaction remains the capacity authority. */
import { userFacingErrorCode } from "../utils/userFacingError";

export const CHILD_PROFILE_LIMIT = 4;
export const BALLET_CHILD_LIMIT = 2;
export const CHILD_LIMIT_MESSAGE = "You can have up to four child profiles on this account. Existing profiles can still be viewed and edited.";
export const BALLET_LIMIT_MESSAGE = "This account already has two children with current Ballet journeys. You can view and manage their applications.";

export function canCreateChildProfile(childCount: number, ready: boolean): boolean {
  return ready && childCount >= 0 && childCount < CHILD_PROFILE_LIMIT;
}

export function canStartBalletApplication(currentChildCount: number, eligibleChildCount: number, canCreateProfile: boolean, ready = true): boolean {
  return ready && currentChildCount >= 0 && currentChildCount < BALLET_CHILD_LIMIT
    && (eligibleChildCount > 0 || canCreateProfile);
}

export function capacityErrorKind(error: unknown): "child" | "ballet" | null {
  if (!error || typeof error !== "object" || (error as { status?: number }).status !== 422) return null;
  const code = userFacingErrorCode(error);
  return code === "CHILD_PROFILE_LIMIT_REACHED" ? "child"
    : code === "BALLET_CHILD_LIMIT_REACHED" ? "ballet" : null;
}

/** Account generations also protect A → B → A switches and out-of-order reads. */
export function createAccountRequestScope() {
  let accountId: string | null = null;
  let generation = 0;
  let readRevision = 0;
  return {
    setAccount(next: string | null) {
      if (next === accountId) return false;
      accountId = next;
      generation++;
      readRevision++;
      return true;
    },
    capture() {
      const owner = accountId;
      const epoch = generation;
      return () => owner != null && owner === accountId && epoch === generation;
    },
    beginRead() {
      const current = this.capture();
      const revision = ++readRevision;
      return () => current() && revision === readRevision;
    },
    invalidateReads() { readRevision++; },
  };
}
