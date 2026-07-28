import { and, eq } from "drizzle-orm";
import { childrenTable, studentsTable } from "@workspace/db";
import type { EligibilityReason, ParticipantSelection, ParticipantType } from "@workspace/api-zod";

type SelectExecutor = {
  select: typeof import("@workspace/db").db.select;
};

export type ResolvedPackageParticipant = {
  participantType: ParticipantType;
  participantChildId: number | null;
  displayName: string;
  dateOfBirth: string | null;
};

export type ParticipantResolution =
  | { ok: true; account: typeof studentsTable.$inferSelect; participant: ResolvedPackageParticipant }
  | { ok: false; status: 400 | 404; reason: EligibilityReason };

function failure(
  code: EligibilityReason["code"],
  message: string,
  status: 400 | 404 = 400,
): ParticipantResolution {
  return { ok: false, status, reason: { code, message } };
}

export async function resolvePackageParticipant(
  executor: SelectExecutor,
  authenticatedStudentId: number,
  selection: ParticipantSelection,
): Promise<ParticipantResolution> {
  const [account] = await executor
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, authenticatedStudentId))
    .for("share")
    .limit(1);
  if (!account) return failure("PARTICIPANT_NOT_FOUND", "Authenticated account was not found.", 404);

  if (account.accountType !== "student" && account.accountType !== "parent") {
    return failure(
      account.accountType == null ? "ACCOUNT_TYPE_REQUIRED" : "ACCOUNT_TYPE_INVALID",
      "A valid account type is required before purchasing a package.",
    );
  }

  if (selection.participantType === "self") {
    if (selection.participantChildId != null) {
      return failure("PARTICIPANT_TYPE_INVALID", "Self purchases cannot include a child ID.");
    }
    return {
      ok: true,
      account,
      participant: {
        participantType: "self",
        participantChildId: null,
        displayName: account.name,
        dateOfBirth: account.dateOfBirth,
      },
    };
  }

  if (selection.participantType !== "child") {
    return failure("PARTICIPANT_TYPE_INVALID", "Participant type must be self or child.");
  }
  if (account.accountType === "student") {
    return failure("STUDENT_SELF_ONLY", "Student accounts may purchase packages only for themselves.");
  }
  if (!Number.isInteger(selection.participantChildId) || Number(selection.participantChildId) <= 0) {
    return failure("PARTICIPANT_REQUIRED", "A child must be selected for a child package purchase.");
  }

  const [child] = await executor
    .select()
    .from(childrenTable)
    .where(and(
      eq(childrenTable.id, Number(selection.participantChildId)),
      eq(childrenTable.parentId, account.id),
    ))
    .for("share")
    .limit(1);
  if (!child) {
    return failure(
      "PARTICIPANT_NOT_OWNED",
      "The selected child is unavailable for this account.",
      404,
    );
  }

  return {
    ok: true,
    account,
    participant: {
      participantType: "child",
      participantChildId: child.id,
      displayName: child.fullName,
      dateOfBirth: child.dateOfBirth,
    },
  };
}
