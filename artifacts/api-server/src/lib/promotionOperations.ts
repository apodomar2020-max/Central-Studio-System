import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, promotionAdminOperationsTable as operations } from "@workspace/db";
import { hasRolePermission } from "@workspace/api-zod";
import {
  resolveOptionalAdminIdentity,
  type AdminRequest,
} from "../routes/adminAuth";
import { ExposableHttpError } from "./httpError";
import { promotionTimestampIdentity } from "./promotionRevision";

export type PromotionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export type PromotionOperationResult = {
  status: number;
  body: string | null;
  promotionId?: number;
  replayed?: boolean;
};
export type PromotionAction = "create" | "edit" | "delete";
export const PROMOTION_RESPONSE_LIMIT = 2 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class PromotionOperationError extends ExposableHttpError {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super(status, message);
  }
}
export const operationErrorResult = (
  status: number,
  code: string,
  error: string,
): PromotionOperationResult => ({
  status,
  body: JSON.stringify({ code, error }),
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function promotionRequestFingerprint(
  method: string,
  target: number | null,
  revision: string | null,
  body: Record<string, unknown>,
): string {
  const normalized = { ...body };
  for (const field of ["startDate", "endDate"])
    if (typeof normalized[field] === "string")
      normalized[field] = promotionTimestampIdentity(
        normalized[field] as string,
      );
  if (typeof normalized.code === "string")
    normalized.code = normalized.code.trim().toUpperCase();
  return createHash("sha256")
    .update(
      canonical({ version: 1, method, target, revision, body: normalized }),
    )
    .digest("hex");
}
export function parsePromotionOperationId(value: string): string {
  if (!UUID.test(value))
    throw new PromotionOperationError(
      400,
      "INVALID_OPERATION_ID",
      "Use a valid UUID operation identity.",
    );
  return value.toLowerCase();
}

async function authorize(
  req: AdminRequest,
  action: PromotionAction,
  client: PromotionTransaction | typeof db = db,
): Promise<void> {
  // Re-read token expiry/version, account and current RBAC after lock waits.
  const identity = await resolveOptionalAdminIdentity(req, client);
  if (!identity || identity.id !== req.adminUser?.id)
    throw new PromotionOperationError(
      401,
      "ADMIN_SESSION_INVALID",
      "Sign in again before reconciling this operation.",
    );
  if (
    !identity.isSuperAdmin &&
    !hasRolePermission(identity.permissions, "promotions", action)
  )
    throw new PromotionOperationError(
      403,
      "PROMOTION_PERMISSION_DENIED",
      "You no longer have permission for this operation.",
    );
  req.adminUser = identity;
}
function expiredResult(
  row: typeof operations.$inferSelect,
): PromotionOperationResult {
  return {
    status: 410,
    body: JSON.stringify({
      code: "OPERATION_EXPIRED",
      error:
        "This operation has expired and cannot execute again. Review the promotion's current state.",
      outcome: row.terminalOutcome,
      promotionId: row.resultPromotionId,
    }),
  };
}
async function expireLocked(
  tx: PromotionTransaction,
  row: typeof operations.$inferSelect,
): Promise<typeof operations.$inferSelect> {
  // Compare using PostgreSQL time, not an API instance's wall clock.
  const clock = await tx.execute<{ expired: boolean }>(
    sql`select ${row.expiresAt}::timestamptz <= clock_timestamp() as expired`,
  );
  if (row.state === "expired" || !clock.rows[0].expired) return row;
  const [expired] = await tx
    .update(operations)
    .set({
      state: "expired",
      terminalOutcome: row.terminalOutcome ?? "not_executed",
      completedAt: row.completedAt ?? sql`clock_timestamp()`,
      responseBody: null,
    })
    .where(eq(operations.operationId, row.operationId))
    .returning();
  return expired;
}
export async function executePromotionOperation(options: {
  req: AdminRequest;
  action: PromotionAction;
  target: number | null;
  normalizedBody: Record<string, unknown>;
  mutate: (tx: PromotionTransaction) => Promise<PromotionOperationResult>;
  knownError: (error: unknown) => PromotionOperationResult | null;
}): Promise<PromotionOperationResult> {
  const { req, action, target, normalizedBody, mutate, knownError } = options;
  const key = req.get("Idempotency-Key");
  if (!key) {
    if (process.env.PROMOTIONS_REQUIRE_IDEMPOTENCY === "true")
      throw new PromotionOperationError(
        428,
        "PROMOTION_OPERATION_REQUIRED",
        "Reload Promotions before saving.",
      );
    return db.transaction(mutate); // Legacy callers retain compatibility, not durable guarantees.
  }
  const id = parsePromotionOperationId(key);
  const revision = req.get("If-Match") ?? null;
  const fingerprint = promotionRequestFingerprint(
    req.method,
    target,
    revision,
    normalizedBody,
  );
  await authorize(req, action);
  // T0: immutable admission survives any rollback/crash of business execution.
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx
      .insert(operations)
      .values({
        operationId: id,
        actorAdminId: req.adminUser!.id,
        method: req.method,
        targetPromotionId: target,
        canonicalVersion: 1,
        requestFingerprint: fingerprint,
        expectedRevision: revision,
        expiresAt: sql`clock_timestamp() + interval '24 hours'`,
      })
      .onConflictDoNothing({ target: operations.operationId });
  });
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);
    let [row] = await tx
      .select()
      .from(operations)
      .where(eq(operations.operationId, id))
      .for("update");
    await authorize(req, action, tx);
    if (
      row.actorAdminId !== req.adminUser!.id ||
      row.method !== req.method ||
      row.targetPromotionId !== target ||
      row.canonicalVersion !== 1 ||
      row.requestFingerprint !== fingerprint ||
      row.expectedRevision !== revision
    )
      throw new PromotionOperationError(
        409,
        "OPERATION_KEY_REUSED",
        "This operation identity is already bound to a different request.",
      );
    row = await expireLocked(tx, row);
    if (row.state === "expired") return expiredResult(row);
    if (row.state !== "reserved")
      return {
        status: row.responseStatus!,
        body: row.responseBody,
        promotionId: row.resultPromotionId ?? undefined,
        replayed: true,
      };
    let result: PromotionOperationResult;
    try {
      result = await tx.transaction(async (savepoint) => {
        const response = await mutate(savepoint);
        if (response.status >= 400) throw new ReturnedRejection(response);
        if (
          response.body !== null &&
          Buffer.byteLength(response.body, "utf8") > PROMOTION_RESPONSE_LIMIT
        )
          throw new Error("Promotion response exceeds durable storage limit");
        return response;
      });
    } catch (error) {
      const rejection =
        error instanceof ReturnedRejection ? error.result : knownError(error);
      if (!rejection) throw error;
      result = rejection;
    }
    if (
      result.body !== null &&
      Buffer.byteLength(result.body, "utf8") > PROMOTION_RESPONSE_LIMIT
    )
      throw new Error("Promotion response exceeds durable storage limit");
    const rejected = result.status >= 400;
    await tx
      .update(operations)
      .set({
        state: rejected ? "rejected" : "succeeded",
        terminalOutcome: rejected ? "rejected" : "succeeded",
        responseStatus: result.status,
        responseBody: result.body,
        resultPromotionId: rejected ? null : result.promotionId!,
        completedAt: sql`clock_timestamp()`,
        expiresAt: sql`clock_timestamp() + interval '30 days'`,
      })
      .where(eq(operations.operationId, id));
    return result;
  });
}
class ReturnedRejection extends Error {
  constructor(readonly result: PromotionOperationResult) {
    super("Promotion rejected");
  }
}

export async function reconcilePromotionOperation(
  req: AdminRequest,
  key: string,
) {
  const id = parsePromotionOperationId(key);
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const [candidate] = await tx
      .select()
      .from(operations)
      .where(eq(operations.operationId, id));
    if (!candidate || candidate.actorAdminId !== req.adminUser!.id)
      throw new PromotionOperationError(
        404,
        "OPERATION_NOT_FOUND",
        "Operation not found for this account.",
      );
    const action =
      candidate.method === "POST"
        ? "create"
        : candidate.method === "PATCH"
          ? "edit"
          : "delete";
    await authorize(req, action, tx);
    // SKIP LOCKED distinguishes an in-flight execution without blocking the UI.
    const [locked] = await tx
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.operationId, id),
          eq(operations.actorAdminId, req.adminUser!.id),
        ),
      )
      .for("update", { skipLocked: true });
    if (!locked) return { operationId: id, state: "pending" };
    await authorize(req, action, tx);
    const row = await expireLocked(tx, locked);
    return {
      operationId: id,
      state: row.state === "reserved" ? "pending" : row.state,
      outcome: row.terminalOutcome,
      promotionId: row.resultPromotionId,
      status: row.responseStatus,
      response: row.responseBody === null ? null : JSON.parse(row.responseBody),
    };
  });
}

/** Explicit maintenance entry point; bounded, restart-safe, never deletes keys. */
export async function cleanupPromotionOperations(limit = 100): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Cleanup batch must be 1..1000");
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(operations)
      .where(
        sql`${operations.state} <> 'expired' and ${operations.expiresAt} <= clock_timestamp()`,
      )
      .orderBy(operations.expiresAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const row of rows) await expireLocked(tx, row);
    return rows.length;
  });
}
