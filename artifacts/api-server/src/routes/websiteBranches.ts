import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, studioBranchesTable } from "@workspace/db";
import { ListPublicWebsiteBranchesResponse } from "@workspace/api-zod";

/**
 * Public Website branch directory.
 *
 * A single unauthenticated read used by the marketing website footer
 * (Main Branch contact card + full branch list). Modeled on
 * websiteBackgrounds.ts / websitePerformances.ts: public GET only, a fixed
 * presentation projection, `no-store` cache header. All admin branch CRUD
 * stays in studioBranches.ts behind requireAdminPermission("branches", …) —
 * nothing here is guarded, by design, exactly like /website/backgrounds.
 *
 * Projection is deliberately minimal: `id` (stable list key + "first
 * active branch is Main Branch" selection on the website), `name`,
 * `address`, `googleMapsLink`. Never `code`, `isActive` (filtered here),
 * `roomCount`, rooms, schedules, or timestamps.
 */
const router: IRouter = Router();

router.get("/website/branches", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: studioBranchesTable.id,
      name: studioBranchesTable.name,
      address: studioBranchesTable.address,
      googleMapsLink: studioBranchesTable.googleMapsLink,
    })
    .from(studioBranchesTable)
    .where(eq(studioBranchesTable.isActive, true))
    .orderBy(asc(studioBranchesTable.id));

  // no-store (Locked Decision: CMS public data uses a no-stale-content
  // strategy) — matches /website/backgrounds and /website/performances.
  res.set("Cache-Control", "no-store, max-age=0");
  res.json(ListPublicWebsiteBranchesResponse.parse(rows));
});

export default router;
