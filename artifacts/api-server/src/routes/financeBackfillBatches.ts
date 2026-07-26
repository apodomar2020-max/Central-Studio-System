/**
 * Finance Phase 2D-2 — protected Admin API for historical-backfill batch
 * control. Batch metadata/status only — no execution.
 *
 *   POST /api/finance/backfill-batches                        — create (control row only)
 *   POST /api/finance/backfill-batches/:id/dry-run-evidence    — bind an aggregate-only dry-run report
 *   POST /api/finance/backfill-batches/:id/approve             — Super Admin only
 *   POST /api/finance/backfill-batches/:id/start               — Super Admin only, control-state only
 *   POST /api/finance/backfill-batches/:id/pause
 *   POST /api/finance/backfill-batches/:id/resume
 *   POST /api/finance/backfill-batches/:id/cancel              — Super Admin only
 *   POST /api/finance/backfill-batches/:id/fail
 *   POST /api/finance/backfill-batches/:id/complete
 *   GET  /api/finance/backfill-batches                         — list (read-only)
 *   GET  /api/finance/backfill-batches/:id                     — inspect (read-only)
 *   GET  /api/finance/backfill-batches/:id/progress            — aggregate progress counts (read-only)
 *
 * No route here can create, update, or delete a payment_records,
 * payment_events, payment_refunds, or source (package_orders/bookings/
 * attendance/credit_transactions) row, and no route can trigger a
 * notification or push — this module imports only the batch/progress
 * services (financeBackfillBatchService.ts, financeBackfillProgressService.ts),
 * never a Finance/source writer.
 *
 * "start" enters "running" as CONTROL STATE ONLY — Phase 2D-2 has no
 * mutating writer, so this endpoint never processes a single source row.
 *
 * Attaching dry-run evidence never runs the planner itself: the caller
 * (an operator, via the read-only CLI, run wherever the production/remote-DB
 * guards allow) supplies the JSON report body. This route only validates
 * and binds it — it has no path to a database connection string or to
 * invoking the planner.
 */
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireSuperAdmin, type AdminRequest } from "./adminAuth";
import { logActivity } from "../lib/activityLog";
import { logger } from "../lib/logger";
import { financeAdminCan } from "../lib/financeAccess";
import {
  createBatch,
  attachDryRunEvidence,
  approveBatch,
  startBatch,
  pauseBatch,
  resumeBatch,
  cancelBatch,
  failBatch,
  completeBatch,
} from "../lib/financeBackfillBatchService";
import { countProgressByStatus } from "../lib/financeBackfillProgressService";
import { validateDryRunFilters, SOURCE_FAMILIES, type DryRunFilters, type DryRunReport } from "../lib/financeBackfillDryRun";

const router: IRouter = Router();

router.use(blockStudentJwt, requireAdminAuth);

function getBatchId(req: AdminRequest): string {
  return String(req.params["id"] ?? "");
}

function requireFinanceView(req: AdminRequest, res: Response, next: () => void): void {
  // Reuses the existing Finance "dashboard.view" permission (see
  // routes/finance.ts) rather than inventing a new permission module for a
  // control-only surface this small. Approve/cancel/start use the stronger
  // requireSuperAdmin tier instead of this one.
  if (!req.adminUser || !financeAdminCan(req.adminUser, "dashboard", "view")) {
    res.status(403).json({ error: "Permission denied" });
    return;
  }
  next();
}

// ── Create ───────────────────────────────────────────────────────────────────

const ScopeSchema = z.object({
  sourceFamilies: z.array(z.enum(SOURCE_FAMILIES)),
  operationalStatuses: z.array(z.string().min(1)).optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
  maxRows: z.number().int(),
  batchSize: z.number().int(),
  classificationCodes: z.array(z.string()).optional(),
  eligibilityClasses: z.array(z.string()).optional(),
});

const CreateBatchBody = z.object({
  scope: ScopeSchema,
  expectedClassifierVersion: z.string().min(1),
  expectedCodeCommit: z.string().min(1),
});

router.post("/finance/backfill-batches", requireFinanceView, async (req: AdminRequest, res: Response): Promise<void> => {
  const parsed = CreateBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const scope = parsed.data.scope as DryRunFilters;
  try {
    validateDryRunFilters(scope);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid scope" });
    return;
  }

  const admin = req.adminUser!;
  const result = await db.transaction((tx) =>
    createBatch(tx, {
      createdBy: admin.username,
      scope,
      expectedClassifierVersion: parsed.data.expectedClassifierVersion,
      expectedCodeCommit: parsed.data.expectedCodeCommit,
    }),
  );

  if (result.kind === "overlapping_active_batch") {
    res.status(409).json({ error: "An active batch already exists for this exact scope" });
    return;
  }

  await logActivity(req, {
    action: "create",
    module: "financeBackfillBatch",
    entityType: "payment_backfill_batch",
    entityId: result.batch.id,
    summary: `Created historical backfill batch ${result.batch.id}`,
  });
  res.status(201).json({ batch: result.batch });
});

// ── Attach dry-run evidence ──────────────────────────────────────────────────

router.post(
  "/finance/backfill-batches/:id/dry-run-evidence",
  requireFinanceView,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const report = req.body as DryRunReport;
    if (!report || typeof report !== "object" || !report.classifierVersion || !report.codeCommit || !report.appliedFilters) {
      res.status(400).json({ error: "Request body must be a dry-run report (aggregate-only, no source rows)" });
      return;
    }

    const result = await db.transaction((tx) => attachDryRunEvidence(tx, getBatchId(req), report));

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    if (result.kind === "wrong_state") {
      res.status(409).json({ error: `Batch is in status "${result.actualStatus}", not "created"` });
      return;
    }
    if (result.kind === "scope_mismatch") {
      res.status(409).json({ error: `Dry-run evidence does not match batch scope (${result.reason})` });
      return;
    }

    await logActivity(req, {
      action: "attachEvidence",
      module: "financeBackfillBatch",
      entityType: "payment_backfill_batch",
      entityId: result.batch.id,
      summary: `Attached dry-run evidence to batch ${result.batch.id}`,
    });
    res.json({ batch: result.batch, evidenceFingerprint: result.batch.evidenceFingerprint });
  },
);

// ── Approve (Super Admin only — stronger explicit authorization) ────────────

const ApproveBatchBody = z.object({
  expectedFingerprint: z.string().min(1),
  expectedEligibleCount: z.number().int().nonnegative(),
  maxExecutionCount: z.number().int().nonnegative(),
});

router.post(
  "/finance/backfill-batches/:id/approve",
  requireSuperAdmin,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const parsed = ApproveBatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
      return;
    }

    const admin = req.adminUser!;
    const result = await db.transaction((tx) =>
      approveBatch(tx, getBatchId(req), { approvedBy: admin.username, ...parsed.data }),
    );

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    if (result.kind === "wrong_state") {
      res.status(409).json({ error: `Batch is in status "${result.actualStatus}", not "dry_run_completed"` });
      return;
    }
    if (result.kind === "stale_fingerprint") {
      res.status(409).json({ error: "Evidence fingerprint is stale — re-run the dry-run and re-attach evidence" });
      return;
    }

    await logActivity(req, {
      action: "approve",
      module: "financeBackfillBatch",
      entityType: "payment_backfill_batch",
      entityId: result.batch.id,
      summary: `Approved historical backfill batch ${result.batch.id}`,
    });
    res.json({ batch: result.batch });
  },
);

// ── Control transitions ──────────────────────────────────────────────────────

async function handleControlTransition(
  req: AdminRequest,
  res: Response,
  action: "start" | "pause" | "resume" | "cancel" | "fail",
  transition: () => ReturnType<typeof startBatch>,
): Promise<void> {
  const result = await transition();

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  if (result.kind === "forbidden") {
    res.status(409).json({ error: `Transition "${action}" is not allowed: ${result.reason}` });
    return;
  }

  await logActivity(req, {
    action,
    module: "financeBackfillBatch",
    entityType: "payment_backfill_batch",
    entityId: result.batch.id,
    summary: `${result.noop ? "No-op (already " + result.batch.status + ")" : action} on batch ${result.batch.id}`,
  });
  res.json({ batch: result.batch, noop: result.noop });
}

router.post("/finance/backfill-batches/:id/start", requireSuperAdmin, async (req: AdminRequest, res: Response) => {
  await handleControlTransition(req, res, "start", () => db.transaction((tx) => startBatch(tx, getBatchId(req))));
});

router.post("/finance/backfill-batches/:id/pause", requireFinanceView, async (req: AdminRequest, res: Response) => {
  await handleControlTransition(req, res, "pause", () => db.transaction((tx) => pauseBatch(tx, getBatchId(req))));
});

router.post("/finance/backfill-batches/:id/resume", requireFinanceView, async (req: AdminRequest, res: Response) => {
  await handleControlTransition(req, res, "resume", () => db.transaction((tx) => resumeBatch(tx, getBatchId(req))));
});

router.post("/finance/backfill-batches/:id/cancel", requireSuperAdmin, async (req: AdminRequest, res: Response) => {
  const admin = req.adminUser!;
  await handleControlTransition(req, res, "cancel", () =>
    db.transaction((tx) => cancelBatch(tx, getBatchId(req), admin.username)),
  );
});

const FailBatchBody = z.object({ reason: z.string().min(1) });

router.post("/finance/backfill-batches/:id/fail", requireFinanceView, async (req: AdminRequest, res: Response) => {
  const parsed = FailBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "reason is required" });
    return;
  }
  await handleControlTransition(req, res, "fail", () =>
    db.transaction((tx) => failBatch(tx, getBatchId(req), parsed.data.reason)),
  );
});

router.post("/finance/backfill-batches/:id/complete", requireFinanceView, async (req: AdminRequest, res: Response): Promise<void> => {
  const result = await db.transaction((tx) => completeBatch(tx, getBatchId(req)));

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  if (result.kind === "incomplete_progress") {
    res.status(409).json({ error: `${result.pendingCount} progress item(s) still pending classification` });
    return;
  }
  if (result.kind === "forbidden") {
    res.status(409).json({ error: `Transition "complete" is not allowed: ${result.reason}` });
    return;
  }

  await logActivity(req, {
    action: "complete",
    module: "financeBackfillBatch",
    entityType: "payment_backfill_batch",
    entityId: result.batch.id,
    summary: `Completed batch ${result.batch.id}`,
  });
  res.json({ batch: result.batch, noop: result.noop });
});

// ── Read-only visibility ─────────────────────────────────────────────────────

router.get("/finance/backfill-batches", requireFinanceView, async (_req: AdminRequest, res: Response): Promise<void> => {
  const { paymentBackfillBatchesTable } = await import("@workspace/db");
  const { desc } = await import("drizzle-orm");
  const batches = await db.select().from(paymentBackfillBatchesTable).orderBy(desc(paymentBackfillBatchesTable.startedAt)).limit(100);
  res.json({ batches });
});

router.get("/finance/backfill-batches/:id", requireFinanceView, async (req: AdminRequest, res: Response): Promise<void> => {
  const { paymentBackfillBatchesTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const [batch] = await db.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, getBatchId(req)));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json({ batch });
});

router.get(
  "/finance/backfill-batches/:id/progress",
  requireFinanceView,
  async (req: AdminRequest, res: Response): Promise<void> => {
    // Aggregate counts only — never a source ID or PII field.
    const counts = await db.transaction((tx) => countProgressByStatus(tx, getBatchId(req)));
    res.json({ batchId: getBatchId(req), countsByStatus: counts });
  },
);

router.use((err: unknown, _req: AdminRequest, res: Response, next: (err?: unknown) => void) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, "financeBackfillBatches route error");
  res.status(500).json({ error: "Internal error" });
});

export default router;
