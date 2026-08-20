/**
 * Wave 3: Admin surface for the single-class booking refund lifecycle.
 * Mirrors routes/packageRefunds.ts exactly (same guards, same status-code
 * mapping) — the refund request itself is opened automatically by the
 * student cancellation route (see requestBookingRefundInTx in
 * bookings.ts), never here; this file is the Admin review/payout side.
 */
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import {
  approveBookingRefund,
  bookingRefundEligibility,
  BookingRefundServiceError,
  completeBookingRefund,
  failBookingRefund,
  getBookingRefund,
  getBookingRefundOverview,
  rejectBookingRefund,
} from "../lib/bookingRefundService";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();
const idSchema = z.coerce.number().int().positive();
const noteSchema = z.string().trim().min(1).max(2_000);
const reviewSchema = z.object({ adminNotes: noteSchema.optional() }).strict();
const completeSchema = z.object({
  completionIdempotencyKey: z.string().uuid(),
  transactionReference: z.string().trim().min(1).max(255),
}).strict();
const failSchema = z.object({ failedReason: noteSchema, adminNotes: noteSchema.optional() }).strict();

const viewGuards = [requireAdminAuth, requireAdminPermission("bookings", "view"), requireAdminPermission("finance", "view")];
const manageGuards = [requireAdminAuth, requireAdminPermission("bookings", "cancel"), requireAdminPermission("finance", "refundsManage")];

function parseId(req: AdminRequest, res: Response): number | null {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return null; }
  return parsed.data;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) { res.status(400).json({ error: "Validation failed", details: error.flatten() }); return; }
  if (error instanceof BookingRefundServiceError) {
    const status = error.code === "BOOKING_REFUND_NOT_FOUND" ? 404 : 409;
    res.status(status).json({ error: error.code, message: error.message }); return;
  }
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Refund operation failed." });
}

router.get("/admin/bookings/:id/refund-eligibility", ...viewGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { res.json(await bookingRefundEligibility(id)); } catch (error) { sendError(res, error); }
});

// Wave 3.1: combined view (eligibility + the existing refund row, if the
// student's cancellation already opened one) for the Admin refund dialog —
// mirrors GET /admin/package-orders/:id/refund-eligibility's overview
// shape. Read-only; no new refund math.
router.get("/admin/bookings/:id/refund", ...viewGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { res.json(await getBookingRefundOverview(id)); } catch (error) { sendError(res, error); }
});

router.get("/admin/booking-refunds/:id", ...viewGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { res.json(await getBookingRefund(id)); } catch (error) { sendError(res, error); }
});

router.post("/admin/booking-refunds/:id/approve", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = reviewSchema.parse(req.body); res.json(await approveBookingRefund({ refundId: id, reviewedByAdminId: req.adminUser!.sub, adminNotes: body.adminNotes })); }
  catch (error) { sendError(res, error); }
});

router.post("/admin/booking-refunds/:id/reject", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = reviewSchema.parse(req.body); res.json(await rejectBookingRefund({ refundId: id, reviewedByAdminId: req.adminUser!.sub, adminNotes: body.adminNotes })); }
  catch (error) { sendError(res, error); }
});

router.post("/admin/booking-refunds/:id/complete", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = completeSchema.parse(req.body); res.json(await completeBookingRefund({ refundId: id, processedByAdminId: req.adminUser!.sub, ...body })); }
  catch (error) { sendError(res, error); }
});

router.post("/admin/booking-refunds/:id/fail", ...manageGuards, async (req: AdminRequest, res): Promise<void> => {
  const id = parseId(req, res); if (id == null) return;
  try { const body = failSchema.parse(req.body); res.json(await failBookingRefund({ refundId: id, processedByAdminId: req.adminUser!.sub, ...body })); }
  catch (error) { sendError(res, error); }
});

export default router;
