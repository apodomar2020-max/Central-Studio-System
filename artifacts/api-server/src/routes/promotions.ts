import { blockStudentJwt } from "../middlewares/auth";
import { Router, type IRouter, type Request, type Response, type RequestHandler } from "express";
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  promotionCodesTable,
  promotionRedemptionsTable,
  promotionsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import {
  createPromotionRedemptions,
  resolveClassPromotionContext,
  resolvePackagePromotionContext,
  validateClassPromotion,
  validatePackagePromotion,
  writePromotionAuditLog,
} from "../lib/promotionService";
import { adminActivityActor, diffFields, logActivityWithActorStrict } from "../lib/activityLog";

import { promotionRevision } from "../lib/promotionRevision";
import { executePromotionOperation, reconcilePromotionOperation, PromotionOperationError, operationErrorResult, type PromotionAction, type PromotionTransaction, type PromotionOperationResult } from "../lib/promotionOperations";
import type { DbClient } from "../lib/dbTypes";
import { ExposableHttpError } from "../lib/httpError";

const router: IRouter = Router();

const INT_MAX = 2_147_483_647;
const positiveInteger = z.number().int().positive().max(INT_MAX);
// Retain numeric-string API compatibility without coercing null/booleans/blank to zero.
const numericInput = z.union([z.number(), z.string().trim().min(1)])
  .transform(Number).pipe(z.number().finite());
const limitInput = numericInput.pipe(positiveInteger).nullable();
const moneyValue = z.number().finite().nonnegative()
  .refine((value) => Number.isSafeInteger(Math.round(value * 100)), "Amount is outside the supported range.");

function validTimestamp(value: string): boolean {
  // Accept ISO offsets and PostgreSQL's string timestamp representation on merged PATCH.
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, minute, second, offset] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(h) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return false;
  if (offset !== "Z") {
    const digits = offset.slice(1).replace(":", "");
    if (Number(digits.slice(0, 2)) > 15 || Number(digits.slice(2) || 0) > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

const timestampInput = z.string().refine(validTimestamp, "Use a valid timestamp with a timezone.").nullable();
const rulesInput = z.object({
  verifiedStudentOnly: z.boolean().optional(),
  firstPackagePurchaseOnly: z.boolean().optional(),
  minimumBasketAmount: moneyValue.optional(),
  packageIds: z.array(positiveInteger).optional(),
  branches: z.array(z.string().trim().min(1).refine((value) => !value.includes("\0"), "Branch cannot contain null characters.")).optional(),
  maxGlobalUses: positiveInteger.optional(),
  maxUsesPerUser: positiveInteger.optional(),
}).strict();

// No creation defaults here: PATCH omission must preserve the locked database value.
const PromotionFields = z.object({
  name: z.string().trim().min(1).refine((value) => !value.includes("\0"), "Name cannot contain null characters."),
  description: z.string().trim().refine((value) => !value.includes("\0"), "Description cannot contain null characters.").nullable().optional(),
  type: z.enum(["automatic", "manual"]),
  discountType: z.enum(["percentage", "fixed_amount"]),
  discountValue: numericInput.pipe(moneyValue).refine((value) => value > 0, "Discount must be greater than zero."),
  priority: numericInput.pipe(z.number().int().min(-2_147_483_648).max(INT_MAX)),
  isExclusive: z.boolean(),
  isStackable: z.boolean(),
  isActive: z.boolean(),
  startDate: timestampInput.optional(),
  endDate: timestampInput.optional(),
  rulesConfig: rulesInput,
  code: z.string().trim().refine((value) => !value.includes("\0"), "Code cannot contain null characters.").optional(),
  maxUses: limitInput.optional(),
  usesPerUser: limitInput.optional(),
});
const PromotionBodySchema = PromotionFields.extend({
  description: PromotionFields.shape.description.default(null),
  startDate: timestampInput.default(null),
  endDate: timestampInput.default(null),
  code: PromotionFields.shape.code.default(""),
  maxUses: limitInput.default(null),
  usesPerUser: limitInput.default(null),
  type: PromotionFields.shape.type.default("automatic"),
  discountType: PromotionFields.shape.discountType.default("percentage"),
  priority: PromotionFields.shape.priority.default(0),
  isExclusive: z.boolean().default(false),
  isStackable: z.boolean().default(false),
  isActive: z.boolean().default(true),
  rulesConfig: rulesInput.default({}),
});

class PromotionWriteError extends ExposableHttpError {
  constructor(status: number, readonly code: string, message: string) {
    super(status, message);
  }
}

function knownPromotionError(error: unknown): PromotionOperationResult | null {
  if (error instanceof PromotionWriteError || error instanceof PromotionOperationError) return operationErrorResult(error.status, error.code, error.message);
  const pg = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  if ((pg?.code ?? pg?.cause?.code) === "23505" && (pg?.constraint ?? pg?.cause?.constraint) === "promotion_codes_code_unique") return operationErrorResult(409, "CODE_ALREADY_IN_USE", "This promo code is already in use.");
  return null;
}
function promotionWrite(handler: (req: AdminRequest, res: Response) => Promise<void>): RequestHandler {
  return async (req, res, next) => {
    try { await handler(req,res); }
    catch (error) {
      const result = knownPromotionError(error);
      if (result) { res.status(result.status).type("application/json").send(result.body); return; }
      next(error);
    }
  };
}
function promotionOperationWrite(action: PromotionAction, mutate: (req: AdminRequest, tx: PromotionTransaction) => Promise<PromotionOperationResult>): RequestHandler {
  return promotionWrite(async (req,res) => {
    const params = action === "create" ? null : PromotionParams.safeParse(req.params);
    if (params && !params.success) { res.status(400).json({error:params.error.message, operationRecorded:false}); return; }
    const target = params?.success ? params.data.id : null;
    let normalizedBody: Record<string,unknown> = {};
    if (req.method !== "DELETE") {
      const schema = action === "create" ? PromotionBodySchema : PromotionFields.partial();
      // Only durable callers require strict request envelopes. Legacy behavior
      // remains compatible; unknown fields cannot disappear from key binding.
      const parsed = (req.get("Idempotency-Key") ? schema.strict() : schema).safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ code:"INVALID_PROMOTION", error:parsed.error.message, operationRecorded:false }); return; }
      normalizedBody = parsed.data;
    } else if (req.get("Idempotency-Key") && req.body != null && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) {
      res.status(400).json({ code:"INVALID_PROMOTION", error:"Deactivation accepts no request body.", operationRecorded:false }); return;
    }
    const result = await executePromotionOperation({ req, action, target, normalizedBody, mutate: tx=>mutate(req,tx), knownError:knownPromotionError });
    res.set("Promotion-Save-Protocol","1");
    if (req.get("Idempotency-Key")) res.set("Promotion-Operation-Id",req.get("Idempotency-Key")!);
    if (result.replayed) res.set("Promotion-Operation-Replayed","true");
    if (result.status === 204) { res.status(204).end(); return; }
    res.status(result.status).type("application/json").send(result.body);
  });
}

function parsePromotion(value: unknown): z.infer<typeof PromotionFields> {
  const parsed = PromotionFields.safeParse(value);
  if (!parsed.success) {
    throw new PromotionWriteError(400, "INVALID_PROMOTION", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const data = parsed.data;
  if (data.discountType === "percentage" && data.discountValue > 100) {
    throw new PromotionWriteError(400, "INVALID_DISCOUNT", "Percentage discounts cannot exceed 100.");
  }
  if (data.startDate && data.endDate && Date.parse(data.endDate) < Date.parse(data.startDate)) {
    throw new PromotionWriteError(400, "INVALID_DATE_RANGE", "End date cannot precede start date.");
  }
  if (data.type === "manual" && (!data.code || normalizeCode(data.code).length < 3)) {
    throw new PromotionWriteError(400, "INVALID_CODE", "Manual promotions require a promo code of at least 3 characters.");
  }
  if (data.type === "automatic" && (data.code?.trim() || data.maxUses != null || data.usesPerUser != null)) {
    throw new PromotionWriteError(400, "INVALID_ACTIVATION_CONFIGURATION", "Automatic promotions cannot have a promo code or code usage limits.");
  }
  return data;
}

function assertSingleClassRules(rules: unknown): void {
  if (rules && typeof rules === "object" && (Object.prototype.hasOwnProperty.call(rules, "packageIds")
    || Object.prototype.hasOwnProperty.call(rules, "firstPackagePurchaseOnly"))) {
    throw new PromotionWriteError(409, "LEGACY_PROMOTION_REVIEW_REQUIRED",
      "Package-specific conditions are incompatible with Direct Single Class promotions. Existing rules are preserved; deactivate this promotion and create a new one.");
  }
}

async function assertCodeAvailable(client: DbClient, text: string, ownCodeId?: number): Promise<void> {
  // Existing SQL/imported strings need not be canonical. Use exactly the same
  // JS normalization as checkout, rather than a locale-dependent SQL approximation.
  const rows = await client.select({ id: promotionCodesTable.id, code: promotionCodesTable.code }).from(promotionCodesTable);
  if (rows.some((row) => row.id !== ownCodeId && normalizeCode(row.code) === normalizeCode(text))) {
    throw new PromotionWriteError(409, "CODE_ALREADY_IN_USE", "This promo code is already in use.");
  }
  // This precheck is advisory; the unique index remains authoritative for concurrent writes.
}

function legacyConflict(): never {
  throw new PromotionWriteError(409, "LEGACY_PROMOTION_REVIEW_REQUIRED", "This promotion's code configuration needs review. You can deactivate it; existing codes and history will be preserved.");
}

// Optional during compatibility rollout; enable only after updated Admin clients
// are deployed and old sessions have been refreshed. Never accept a wildcard.
function checkRevision(req: AdminRequest, revision: string, unchanged = false): void {
  const expected = req.get("If-Match");
  if (!expected) {
    if (process.env.PROMOTIONS_REQUIRE_REVISION === "true") {
      throw new PromotionWriteError(428, "PROMOTION_REVISION_REQUIRED", "Reload Promotions before saving changes.");
    }
    return;
  }
  if (unchanged && /^"[a-f0-9]{64}"$/.test(expected)) return;
  if (expected !== `"${revision}"`) {
    throw new PromotionWriteError(409, "PROMOTION_CHANGED", "This promotion changed since you opened it. Your entries are preserved. Reload the promotion and review the latest values before saving.");
  }
}

const PromotionParams = z.object({ id: z.coerce.number().int().positive().max(INT_MAX) });
const ValidatePromotionBody = z.object({
  packageId: z.coerce.number().int().positive().optional(),
  scheduleId: z.coerce.number().int().positive().optional(),
  promoCode: z.string().trim().min(1).optional().nullable(),
}).superRefine((value, ctx) => {
  const contextCount = Number(value.packageId != null) + Number(value.scheduleId != null);
  if (contextCount !== 1) {
    ctx.addIssue({
      code: "custom",
      message: "Choose exactly one package or class schedule.",
      path: ["context"],
    });
  }
});
type StudentRequest = Request & { studentId?: number };

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const PROMOTION_ACTIVITY_FIELDS = [
  "name",
  "description",
  "type",
  "discountType",
  "discountValue",
  "priority",
  "isExclusive",
  "isStackable",
  "isActive",
  "startDate",
  "endDate",
  "rulesConfig",
] as const;

const PROMOTION_CODE_ACTIVITY_FIELDS = ["code", "promotionId", "maxUses", "usesPerUser"] as const;

function promotionActivitySnapshot(row: typeof promotionsTable.$inferSelect): Record<string, unknown> {
  return {
    name: row.name,
    description: row.description,
    type: row.type,
    discountType: row.discountType,
    discountValue: row.discountValue,
    priority: row.priority,
    isExclusive: row.isExclusive,
    isStackable: row.isStackable,
    isActive: row.isActive,
    startDate: row.startDate,
    endDate: row.endDate,
    rulesConfig: row.rulesConfig,
  };
}

function promotionCodeActivitySnapshot(row: Pick<typeof promotionCodesTable.$inferSelect, "code" | "promotionId" | "maxUses" | "usesPerUser">): Record<string, unknown> {
  return {
    code: row.code,
    promotionId: row.promotionId,
    maxUses: row.maxUses,
    usesPerUser: row.usesPerUser,
  };
}

async function promotionResponse(row: typeof promotionsTable.$inferSelect, client: DbClient = db) {
  const codes = await client
    .select()
    .from(promotionCodesTable)
    .where(eq(promotionCodesTable.promotionId, row.id))
    .orderBy(asc(promotionCodesTable.id));
  const codesWithUsage = await Promise.all(codes.map(async (code) => {
    const [usage] = await client
      .select({ total: count() })
      .from(promotionRedemptionsTable)
      .where(eq(promotionRedemptionsTable.promotionCodeId, code.id));
    return { ...code, currentUses: usage?.total ?? 0 };
  }));
  // Deliberate response allowlist, shared by HTTP and stored replay results.
  return { id:row.id, name:row.name, description:row.description, type:row.type,
    discountType:row.discountType, discountValue:row.discountValue, priority:row.priority,
    isExclusive:row.isExclusive, isStackable:row.isStackable, isActive:row.isActive,
    startDate:row.startDate, endDate:row.endDate, rulesConfig:row.rulesConfig,
    createdAt:row.createdAt, updatedAt:row.updatedAt,
    codes:codesWithUsage.map(code=>({id:code.id,promotionId:code.promotionId,code:code.code,maxUses:code.maxUses,usesPerUser:code.usesPerUser,currentUses:code.currentUses,createdAt:code.createdAt,updatedAt:code.updatedAt})),
    revision:promotionRevision(row,codes) };

}

// Phase 6B: Promotions endpoints use the dedicated `promotions` permission
// module. Roles holding only legacy offers.* grants keep access via the
// module's `offers` legacy alias (see @workspace/api-zod permissions catalog)
// and migration 0043 which materializes promotions.* grants.
router.get("/promotions", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "view"), async (_req, res): Promise<void> => {
  const withCodes = await db.transaction(async (tx) => {
    const rows = await tx.select().from(promotionsTable).orderBy(desc(promotionsTable.createdAt));
    return Promise.all(rows.map((row) => promotionResponse(row, tx)));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(withCodes);
});

router.get("/promotions/save-protocol", blockStudentJwt, requireAdminAuth, async (_req,res): Promise<void> => {
  res.set("Cache-Control","no-store").json({ version:1, idempotency:true, mandatoryIdempotency:process.env.PROMOTIONS_REQUIRE_IDEMPOTENCY === "true", mandatoryRevision:process.env.PROMOTIONS_REQUIRE_REVISION === "true" });
});
router.get("/promotions/operations/:operationId", blockStudentJwt, requireAdminAuth, promotionWrite(async (req,res) => {
  res.set("Cache-Control","no-store").json(await reconcilePromotionOperation(req,String(req.params.operationId)));
}));

router.post("/promotions", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "create"), promotionOperationWrite("create", async (req: AdminRequest, tx): Promise<PromotionOperationResult> => {
  const parsed = PromotionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return {status:400,body:JSON.stringify({ error: parsed.error.message })};
  }
  const { code, maxUses, usesPerUser, ...promotionData } = parsePromotion(parsed.data);
  const execute = async () => {
    assertSingleClassRules(promotionData.rulesConfig);
    if (code) await assertCodeAvailable(tx, code);
    const [promotion] = await tx.insert(promotionsTable).values(promotionData).returning();
    let promotionCode: typeof promotionCodesTable.$inferSelect | null = null;
    if (promotion.type === "manual" && code) {
      const codeStr = code;
      const [insertedCode] = await tx.insert(promotionCodesTable).values({
        promotionId: promotion.id,
        code: normalizeCode(codeStr),
        maxUses: maxUses ?? null,
        usesPerUser: usesPerUser ?? null,
      }).returning();
      promotionCode = insertedCode ?? null;
    }
    const result = { promotion, promotionCode };
    const row = result.promotion;
    await writePromotionAuditLog({
      promotionId: row.id,
      actorAdminId: req.adminUser?.id ?? null,
      action: "promotion.created",
      metadata: { name: row.name, type: row.type },
    }, tx);
    await logActivityWithActorStrict(tx, adminActivityActor(req), {
      action: "create",
      module: "promotions",
      entityType: "promotion",
      entityId: row.id,
      entityLabel: row.name,
      after: promotionActivitySnapshot(row),
      summary: `Created promotion ${row.name}`,
    });
    if (result.promotionCode) {
      await logActivityWithActorStrict(tx, adminActivityActor(req), {
        action: "create",
        module: "promotions",
        entityType: "promotion_code",
        entityId: result.promotionCode.id,
        entityLabel: row.name,
        after: promotionCodeActivitySnapshot(result.promotionCode),
        summary: `Created promo code for promotion ${row.name}`,
      });
    }
    return {status:201,body:JSON.stringify(await promotionResponse(row, tx)),promotionId:row.id};
  };
  return execute();
}));

router.patch("/promotions/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "edit"), promotionOperationWrite("edit", async (req: AdminRequest, tx): Promise<PromotionOperationResult> => {
  const params = PromotionParams.safeParse(req.params);
  if (!params.success) {
    return {status:400,body:JSON.stringify({ error: params.error.message })};
  }
  const parsed = PromotionFields.partial().safeParse(req.body);
  if (!parsed.success) {
    return {status:400,body:JSON.stringify({ error: parsed.error.message })};
  }

  const execute = async () => {
    // Match checkout's promotion -> code ordering. Checkout re-reads its
    // discovered identities after all locks and rejects changed configuration.
    await tx.execute(sql`select pg_advisory_xact_lock(918201, ${params.data.id})`);
    const [beforePromotion] = await tx.select().from(promotionsTable)
      .where(eq(promotionsTable.id, params.data.id)).for("update");
    if (!beforePromotion) return {status:404,body:JSON.stringify({error:"Promotion not found"})};
    const codes = await tx.select().from(promotionCodesTable)
      .where(eq(promotionCodesTable.promotionId, beforePromotion.id)).orderBy(asc(promotionCodesTable.id));
    const revision = promotionRevision(beforePromotion, codes);
    if ((beforePromotion.type === "manual" && codes.length !== 1)
      || (beforePromotion.type === "automatic" && codes.length !== 0)
      || !["manual", "automatic"].includes(beforePromotion.type)) legacyConflict();
    const beforeCode = codes[0] ?? null; // Exactly one, established above; never an arbitrary legacy row.
    if (beforeCode) {
      await tx.execute(sql`select pg_advisory_xact_lock(918202, ${beforeCode.id})`);
      if (beforeCode.code !== normalizeCode(beforeCode.code)) legacyConflict();
      const [wrongOwner] = await tx.select({ id: promotionRedemptionsTable.id }).from(promotionRedemptionsTable)
        .where(and(eq(promotionRedemptionsTable.promotionCodeId, beforeCode.id), ne(promotionRedemptionsTable.promotionId, beforePromotion.id))).limit(1);
      if (wrongOwner) legacyConflict();
    }
    const [movedHistoricalCode] = await tx.select({ id: promotionRedemptionsTable.id }).from(promotionRedemptionsTable)
      .innerJoin(promotionCodesTable, eq(promotionRedemptionsTable.promotionCodeId, promotionCodesTable.id))
      .where(and(eq(promotionRedemptionsTable.promotionId, beforePromotion.id), ne(promotionCodesTable.promotionId, beforePromotion.id))).limit(1);
    if (movedHistoricalCode) legacyConflict();
    if (beforePromotion.type === "manual" && parsed.data.type === "automatic") {
      throw new PromotionWriteError(409, "TYPE_CHANGE_NOT_ALLOWED", "Deactivate this promotion and create a separate Automatic Promotion. Existing codes cannot be detached or deleted.");
    }
    const effective = parsePromotion({
      ...beforePromotion,
      code: beforeCode?.code,
      maxUses: beforeCode?.maxUses ?? null,
      usesPerUser: beforeCode?.usesPerUser ?? null,
      ...parsed.data,
    });
    assertSingleClassRules(effective.rulesConfig);
    assertSingleClassRules(beforePromotion.rulesConfig);
    const { code, maxUses, usesPerUser, ...promotionData } = effective;
    if (beforeCode) {
      await assertCodeAvailable(tx, beforeCode.code, beforeCode.id);
      const renaming = normalizeCode(code!) !== beforeCode.code;
      if (renaming) {
        const [redeemed] = await tx.select({ id: promotionRedemptionsTable.id }).from(promotionRedemptionsTable)
          .where(eq(promotionRedemptionsTable.promotionCodeId, beforeCode.id)).limit(1);
        if (redeemed) {
          throw new PromotionWriteError(409, "CODE_ALREADY_REDEEMED", "A redeemed promo code cannot be renamed. Deactivate this promotion and create a new promotion for a different code.");
        }
        if (beforeCode.currentUses !== 0) legacyConflict();
      }
    }
    if (code) await assertCodeAvailable(tx, code, beforeCode?.id);
    const proposedCodes = beforeCode ? [{ ...beforeCode, code: normalizeCode(code!), maxUses: maxUses ?? null, usesPerUser: usesPerUser ?? null }] : [];
    if (effective.type === beforePromotion.type
      && promotionRevision(beforePromotion, codes) === promotionRevision({ ...beforePromotion, ...promotionData }, proposedCodes)) {
      // A repeated request that changes nothing is safe, even if its revision
      // predates an identical save. This is not durable operation replay.
      checkRevision(req, revision, true);
      return {status:200,body:JSON.stringify(await promotionResponse(beforePromotion, tx)),promotionId:beforePromotion.id};
    }
    checkRevision(req, revision);
    const [updated] = await tx.update(promotionsTable).set(promotionData)
      .where(eq(promotionsTable.id, beforePromotion.id)).returning();
    let afterCode: typeof promotionCodesTable.$inferSelect | null = null;
    if (effective.type === "manual") {
      const values = { code: normalizeCode(code!), maxUses: maxUses ?? null, usesPerUser: usesPerUser ?? null };
      if (beforeCode) {
        [afterCode] = await tx.update(promotionCodesTable).set(values)
          .where(and(eq(promotionCodesTable.id, beforeCode.id), eq(promotionCodesTable.promotionId, beforePromotion.id))).returning();
      } else {
        // Only the explicitly allowed clean automatic -> manual transition inserts a code.
        [afterCode] = await tx.insert(promotionCodesTable).values({ ...values, promotionId: beforePromotion.id }).returning();
      }
    }
    const result = { beforePromotion, updated, beforeCode, afterCode };
    const row = result.updated;
    await writePromotionAuditLog({
      promotionId: row.id,
      actorAdminId: req.adminUser?.id ?? null,
      action: "promotion.updated",
      metadata: { fields: Object.keys(parsed.data), codeId: afterCode?.id ?? null },
    }, tx);
    const promotionDiff = diffFields(
      promotionActivitySnapshot(result.beforePromotion),
      promotionActivitySnapshot(row),
      PROMOTION_ACTIVITY_FIELDS,
    );
    const promotionChangedKeys = Object.keys(promotionDiff.after);
    if (promotionChangedKeys.length > 0) {
      const deactivated = result.beforePromotion.isActive === true && row.isActive === false;
      const activated = result.beforePromotion.isActive === false && row.isActive === true;
      await logActivityWithActorStrict(tx, adminActivityActor(req), {
        action: deactivated ? "deactivate" : activated ? "activate" : "update",
        module: "promotions",
        entityType: "promotion",
        entityId: row.id,
        entityLabel: row.name,
        before: promotionDiff.before,
        after: promotionDiff.after,
        summary: deactivated
          ? `Deactivated promotion ${row.name}`
          : activated
            ? `Activated promotion ${row.name}`
            : `Updated promotion ${row.name}: ${promotionChangedKeys.join(", ")}`,
      });
    }
    if (result.afterCode) {
      const codeAction = result.beforeCode ? "update" : "create";
      const codeDiff = result.beforeCode
        ? diffFields(
          promotionCodeActivitySnapshot(result.beforeCode),
          promotionCodeActivitySnapshot(result.afterCode),
          PROMOTION_CODE_ACTIVITY_FIELDS,
        )
        : { before: {}, after: promotionCodeActivitySnapshot(result.afterCode) };
      if (Object.keys(codeDiff.after).length > 0) {
        await logActivityWithActorStrict(tx, adminActivityActor(req), {
          action: codeAction,
          module: "promotions",
          entityType: "promotion_code",
          entityId: result.afterCode.id,
          entityLabel: row.name,
          before: Object.keys(codeDiff.before).length > 0 ? codeDiff.before : null,
          after: codeDiff.after,
          summary: `${codeAction === "create" ? "Created" : "Updated"} promo code for promotion ${row.name}`,
        });
      }
    }
    return {status:200,body:JSON.stringify(await promotionResponse(row, tx)),promotionId:row.id};
  };
  return execute();
}));

router.delete("/promotions/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("promotions", "delete"), promotionOperationWrite("delete", async (req: AdminRequest, tx): Promise<PromotionOperationResult> => {
  const params = PromotionParams.safeParse(req.params);
  if (!params.success) {
    return {status:400,body:JSON.stringify({ error: params.error.message })};
  }
  const execute = async () => {
    await tx.execute(sql`select pg_advisory_xact_lock(918201, ${params.data.id})`);
    const [existing] = await tx.select().from(promotionsTable).where(eq(promotionsTable.id, params.data.id)).for("update");
    if (!existing) return {status:404,body:JSON.stringify({error:"Promotion not found"})};
    const codes = await tx.select().from(promotionCodesTable).where(eq(promotionCodesTable.promotionId, existing.id));
    checkRevision(req, promotionRevision(existing, codes));
    if (!existing.isActive) return {status:204,body:null,promotionId:existing.id};
    await tx.update(promotionsTable).set({ isActive: false }).where(eq(promotionsTable.id, existing.id));
    await writePromotionAuditLog({
      promotionId: existing.id, actorAdminId: req.adminUser?.id ?? null,
      action: "promotion.deactivated", metadata: { name: existing.name },
    }, tx);
    await logActivityWithActorStrict(tx, adminActivityActor(req), {
      action: "deactivate", module: "promotions", entityType: "promotion",
      entityId: existing.id, entityLabel: existing.name,
      before: { isActive: true }, after: { isActive: false },
      summary: `Deactivated promotion ${existing.name}`,
    });
    return {status:204,body:null,promotionId:existing.id};
  };
  return execute();
}));

router.post("/promotions/validate", requireStudentAuth, requireVerifiedStudent, async (req: StudentRequest, res): Promise<void> => {
  const parsed = ValidatePromotionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: "invalid_promotion_context",
      message: "This promo code cannot be checked for the selected class or package.",
    });
    return;
  }
  const isClassBooking = parsed.data.scheduleId != null;
  const context = isClassBooking
    ? await resolveClassPromotionContext(req.studentId!, parsed.data.scheduleId!)
    : await resolvePackagePromotionContext(req.studentId!, parsed.data.packageId!);
  if (!context) {
    res.status(404).json({
      error: isClassBooking ? "Active class schedule not found." : "Active package not found.",
    });
    return;
  }
  const result = isClassBooking
    ? await validateClassPromotion(context, parsed.data.promoCode)
    : await validatePackagePromotion(context, parsed.data.promoCode);
  res.json({
    eligible: result.eligible,
    reason: result.reason,
    originalSubtotal: result.originalSubtotal,
    discountAmount: result.discountAmount,
    finalSubtotal: result.finalSubtotal,
    promotion: result.promotion,
    promotionCode: result.promotionCode,
  });
});

export {
  createPromotionRedemptions,
  resolveClassPromotionContext,
  resolvePackagePromotionContext,
  validateClassPromotion,
  validatePackagePromotion,
};
export default router;
