import { Router, type IRouter } from "express";
import { count } from "drizzle-orm";
import { db, bookingsTable, marketingCampaignsTable } from "@workspace/db";
import { GetAnalyticsResponse } from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";

const router: IRouter = Router();

// Admin-only: business analytics consumed by the admin dashboard page, so it
// shares the dashboard.view permission (Security Assessment H-01).
router.get("/dashboard/analytics", requireAdminAuth, requireAdminPermission("dashboard", "view"), async (_req, res): Promise<void> => {
  const [bookingRows, [{ totalCampaigns }]] = await Promise.all([
    db.select({ status: bookingsTable.bookingStatus, count: count() }).from(bookingsTable).groupBy(bookingsTable.bookingStatus),
    db.select({ totalCampaigns: count() }).from(marketingCampaignsTable),
  ]);

  res.json(GetAnalyticsResponse.parse({
    bookingsByStatus: bookingRows.map((r) => ({ status: r.status, count: r.count })),
    totalCampaigns,
  }));
});

export default router;
