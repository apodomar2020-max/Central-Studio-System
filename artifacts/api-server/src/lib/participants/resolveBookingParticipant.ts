import type { ParticipantSelection } from "@workspace/api-zod";
import { resolvePackageParticipant } from "./resolvePackageParticipant";

/**
 * Booking-specific entry point for the canonical DB-authoritative participant
 * resolver. Keeping this adapter separate prevents booking code from depending
 * on purchase policy while retaining one implementation for account type,
 * ownership and authoritative DOB resolution.
 */
export async function resolveBookingParticipant(
  executor: Parameters<typeof resolvePackageParticipant>[0],
  authenticatedStudentId: number,
  selection: ParticipantSelection,
) {
  return resolvePackageParticipant(executor, authenticatedStudentId, selection);
}
