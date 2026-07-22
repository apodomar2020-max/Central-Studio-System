import {
  countActiveBalletWeeklySchedules,
  normalizeBalletClasses,
  type BalletClass,
} from "./balletClassScheduleModel";

export type BalletMyClassesEntitlementState =
  | "no_application"
  | "application_pending"
  | "assessment_pending"
  | "assignment_pending"
  | "payment_pending"
  | "activation_pending"
  | "schedule_pending"
  | "active"
  | "rejected"
  | "cancelled"
  | "withdrawn";

export interface BalletMyClassesChild {
  selectorKey: string;
  childId: number;
  applicationId: number | null;
  childName: string;
  applicationStatus: string | null;
  entitlementState: BalletMyClassesEntitlementState;
  level: { id: number; name: string } | null;
  group: { id: number; name: string } | null;
  weeklyScheduleCount: number;
  classes: BalletClass[];
}

export interface BalletMyClassesResponse {
  children: BalletMyClassesChild[];
}

type UnknownRecord = Record<string, unknown>;
const ENTITLEMENT_STATES = new Set<BalletMyClassesEntitlementState>([
  "no_application", "application_pending", "assessment_pending", "assignment_pending",
  "payment_pending", "activation_pending", "schedule_pending", "active",
  "rejected", "cancelled", "withdrawn",
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function relation(value: unknown): { id: number; name: string } | null {
  const row = asRecord(value);
  const id = positiveInteger(row?.id);
  return id != null && typeof row?.name === "string" ? { id, name: row.name } : null;
}

export function normalizeMyBalletClassesResponse(value: unknown): BalletMyClassesResponse {
  const response = asRecord(value);
  const rows = Array.isArray(response?.children) ? response.children : [];
  const byChildId = new Map<number, BalletMyClassesChild>();

  for (const value of rows) {
    const row = asRecord(value);
    const childId = positiveInteger(row?.childId);
    if (!row || childId == null || typeof row.childName !== "string") continue;
    const entitlementState = ENTITLEMENT_STATES.has(row.entitlementState as BalletMyClassesEntitlementState)
      ? row.entitlementState as BalletMyClassesEntitlementState
      : "no_application";
    const classes = entitlementState === "active" ? normalizeBalletClasses(row.classes) : [];
    if (byChildId.has(childId)) continue;
    byChildId.set(childId, {
      selectorKey: `child:${childId}`,
      childId,
      applicationId: positiveInteger(row.applicationId),
      childName: row.childName,
      applicationStatus: typeof row.applicationStatus === "string" ? row.applicationStatus : null,
      entitlementState,
      level: relation(row.level),
      group: relation(row.group),
      weeklyScheduleCount: countActiveBalletWeeklySchedules(classes),
      classes,
    });
  }

  return { children: [...byChildId.values()] };
}

export function resolveBalletChildSelection(
  children: BalletMyClassesChild[],
  currentSelectorKey: string | null,
): string | null {
  if (currentSelectorKey && children.some((child) => child.selectorKey === currentSelectorKey)) return currentSelectorKey;
  return children.find((child) => child.entitlementState === "active")?.selectorKey
    ?? children[0]?.selectorKey
    ?? null;
}

export function selectedBalletChild(
  children: BalletMyClassesChild[],
  selectorKey: string | null,
): BalletMyClassesChild | null {
  return selectorKey == null ? null : children.find((child) => child.selectorKey === selectorKey) ?? null;
}
