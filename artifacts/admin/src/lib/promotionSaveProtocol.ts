import { customFetch } from "@workspace/api-client-react";
export const PROMOTION_PENDING_KEY = "central.promotions.pending.v1";
export type PendingPromotionOperation = {
  version: 1;
  actorId: number;
  id: string;
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: string;
  revision?: string;
  form?: Record<string, unknown>;
  editing?: Record<string, unknown> | null;
};
export type PromotionOperationStatus = {
  state: "pending" | "succeeded" | "rejected" | "expired";
  outcome?: string;
  status?: number;
  response?: { error?: string; code?: string };
  promotionId?: number;
};
export function clearPendingPromotionOperation() {
  try {
    sessionStorage.removeItem(PROMOTION_PENDING_KEY);
  } catch {
    /* Optional recovery storage must never prevent logout. */
  }
}
export function readPendingPromotionOperation(
  actorId: number,
): PendingPromotionOperation | null {
  try {
    const raw = sessionStorage.getItem(PROMOTION_PENDING_KEY);
    if (!raw) return null;
    const op = JSON.parse(raw) as PendingPromotionOperation;
    if (
      op.version !== 1 ||
      op.actorId !== actorId ||
      !/^[a-f0-9-]{36}$/i.test(op.id) ||
      !["POST", "PATCH", "DELETE"].includes(op.method) ||
      !/^\/api\/promotions(?:\/[1-9][0-9]*)?$/.test(op.path) ||
      (op.method === "POST") !== (op.path === "/api/promotions") ||
      (op.body !== undefined && typeof op.body !== "string") ||
      (op.revision !== undefined && typeof op.revision !== "string")
    )
      throw Error("Invalid pending operation");
    return op;
  } catch {
    clearPendingPromotionOperation();
    return null;
  }
}
export function persistPromotionOperation(op: PendingPromotionOperation) {
  // Fail before sending if the browser cannot retain recovery context.
  sessionStorage.setItem(PROMOTION_PENDING_KEY, JSON.stringify(op));
}
export async function requirePromotionSaveProtocol(token: string) {
  const protocol = await customFetch<{ version: number; idempotency: boolean }>(
    "/api/promotions/save-protocol",
    { cache: "no-store", headers: { "x-admin-token": token } },
  );
  if (protocol.version !== 1 || protocol.idempotency !== true)
    throw new Error(
      "Promotions save support is unavailable. Refresh this page before saving.",
    );
}
export function sendPromotionOperation(
  op: PendingPromotionOperation,
  token: string,
) {
  return customFetch(op.path, {
    method: op.method,
    headers: {
      "x-admin-token": token,
      "Idempotency-Key": op.id,
      ...(op.revision ? { "If-Match": op.revision } : {}),
    },
    body: op.body,
  });
}
export function reconcilePromotionSave(
  op: PendingPromotionOperation,
  token: string,
) {
  return customFetch<PromotionOperationStatus>(
    `/api/promotions/operations/${op.id}`,
    { cache: "no-store", headers: { "x-admin-token": token } },
  );
}
