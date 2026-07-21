import type {
  BalletApplication,
  BalletApplicationDetail,
} from "@/services/balletAssessmentService";

export const PRE_ACTIVATION_CANCELLATION_STATUSES = new Set([
  "pending",
  "needsFollowUp",
  "accepted",
  "assignedToLevel",
]);

export interface BalletCancellationTarget {
  applicationId: number;
  childId: number | null;
  childName: string;
  applicationStatus: string;
  assignmentId: number | null;
  assignmentStatus: string | null;
  levelName: string | null;
  groupName: string | null;
  subscriptionState: string | null;
  refundEligible: boolean;
}

export interface BalletCancellationTargetLists {
  cancelApplication: BalletCancellationTarget[];
  cancelProgram: BalletCancellationTarget[];
  cancellationRequests: BalletCancellationTarget[];
}

function toTarget(
  application: BalletApplication,
  detail: BalletApplicationDetail,
  levelNameById: ReadonlyMap<number, string>,
  groupNameById: ReadonlyMap<number, string>,
): BalletCancellationTarget {
  return {
    applicationId: application.id,
    childId: application.childId,
    childName: application.childName,
    applicationStatus: application.status,
    assignmentId: detail.activeAssignment?.id ?? null,
    assignmentStatus: detail.activeAssignment?.status ?? null,
    levelName: application.assignedLevelId == null
      ? null
      : levelNameById.get(application.assignedLevelId) ?? null,
    groupName: application.assignedGroupId == null
      ? null
      : groupNameById.get(application.assignedGroupId) ?? null,
    subscriptionState: detail.currentPayment?.subscriptionDisplayStatus ?? null,
    refundEligible: detail.eligibleRefund?.eligible === true,
  };
}

export function buildBalletCancellationTargets(input: {
  applications: BalletApplication[];
  detailsByApplicationId: ReadonlyMap<number, BalletApplicationDetail | null>;
  levelNameById?: ReadonlyMap<number, string>;
  groupNameById?: ReadonlyMap<number, string>;
}): BalletCancellationTargetLists {
  const levelNames = input.levelNameById ?? new Map<number, string>();
  const groupNames = input.groupNameById ?? new Map<number, string>();
  const result: BalletCancellationTargetLists = {
    cancelApplication: [],
    cancelProgram: [],
    cancellationRequests: [],
  };

  for (const application of input.applications) {
    const detail = input.detailsByApplicationId.get(application.id);
    if (!detail || detail.application.id !== application.id) continue;
    const authoritativeApplication = detail.application;
    const target = toTarget(authoritativeApplication, detail, levelNames, groupNames);

    if (PRE_ACTIVATION_CANCELLATION_STATUSES.has(authoritativeApplication.status)) {
      result.cancelApplication.push(target);
    }

    if (
      authoritativeApplication.status === "active"
      && target.assignmentId != null
      && target.assignmentStatus === "active"
      && !detail.openCancellationRequest
    ) {
      result.cancelProgram.push(target);
    }

    if (detail.openCancellationRequest) {
      result.cancellationRequests.push(target);
    }
  }

  return result;
}

export function findFreshCancellationTarget(input: {
  lists: BalletCancellationTargetLists;
  kind: "cancelApplication" | "cancelProgram";
  applicationId: number;
  assignmentId: number | null;
}): BalletCancellationTarget | null {
  const candidates = input.kind === "cancelApplication"
    ? input.lists.cancelApplication
    : input.lists.cancelProgram;
  return candidates.find((candidate) => (
    candidate.applicationId === input.applicationId
    && (input.kind === "cancelApplication" || candidate.assignmentId === input.assignmentId)
  )) ?? null;
}
