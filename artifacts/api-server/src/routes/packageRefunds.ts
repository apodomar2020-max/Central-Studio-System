import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import {
  approvePackageRefund,
  completePackageRefund,
  failPackageRefund,
  getPackageRefund,
  getPackageRefundOverview,
  PackageRefundServiceError,
  rejectPackageRefund,
  requestPackageRefund,
} from "../lib/packageRefundService";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();
const idSchema = z.coerce.number().int().positive();
const noteSchema = z.string().trim().min(1).max(2_000);
const requestSchema = z.object({
  refundMethod: z.enum(["cash", "original_payment_method"]),
  requestedReason: noteSchema,
  idempotencyKey: z.string().uuid(),
}).strict();
const reviewSchema = z.object({ adminNotes: noteSchema.optional() }).strict();
const completeSchema = z.object({
  completionIdempotencyKey: z.string().uuid(),
  transactionReference: z.string().trim().min(1).max(255),
}).strict();
const failSchema = z.object({ failedReason: noteSchema, adminNotes: noteSchema.optional() }).strict();

const viewGuards = [requireAdminAuth, requireAdminPermission("packageOrders", "view"), requireAdminPermission("finance", "view")];
const manageGuards = [requireAdminAuth, requireAdminPermission("packageOrders", "cancel"), requireAdminPermission("finance", "refundsManage")];

function parseId(req: AdminRequest, res: Response): number | null {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return null; }
  return parsed.data;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) { res.status(400).json({ error: "Validation failed", details: error.flatten() }); return; }
  if (error instanceof PackageRefundServiceError) {
    const status = error.code === "PACKAGE_REFUND_NOT_FOUND" ? 404
      : error.code === "PACKAGE_REFUND_NOT_ELIGIBLE" ? 422 : 409;
    res.status(status).json({ error: error.code, message: error.message }); return;
  }
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Refund operation failed." });
}

router.get("/admin/package-orders/:id/refund-eligibility", ...viewGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { res.json(await getPackageRefundOverview(id)); } catch (error) { sendError(res, error); }
});

router.post("/admin/package-orders/:id/refunds", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try {
    const body = requestSchema.parse(req.body);
    const result = await requestPackageRefund({ packageOrderId: id, refundMethod: body.refundMethod,
      requestedReason: body.requestedReason, requestedByAdminId: req.adminUser!.sub,
      requestIdempotencyKey: body.idempotencyKey });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { sendError(res, error); }
});

router.get("/admin/package-refunds/:id", ...viewGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { res.json(await getPackageRefund(id)); } catch (error) { sendError(res, error); }
});

router.post("/admin/package-refunds/:id/approve", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = reviewSchema.parse(req.body); res.json(await approvePackageRefund({ refundId: id, reviewedByAdminId: req.adminUser!.sub, adminNotes: body.adminNotes })); }
  catch (error) { sendError(res, error); }
});

router.post("/admin/package-refunds/:id/reject", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = reviewSchema.parse(req.body); res.json(await rejectPackageRefund({ refundId: id, reviewedByAdminId: req.adminUser!.sub, adminNotes: body.adminNotes })); }
  catch (error) { sendError(res, error); }
});

router.post("/admin/package-refunds/:id/complete", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = completeSchema.parse(req.body); res.json(await completePackageRefund({ refundId: id, processedByAdminId: req.adminUser!.sub, ...body })); }
  catch (error) { sendError(res, error); }
});

router.post("/admin/package-refunds/:id/fail", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = failSchema.parse(req.body); res.json(await failPackageRefund({ refundId: id, processedByAdminId: req.adminUser!.sub, ...body })); }
  catch (error) { sendError(res, error); }
});

export default router;
