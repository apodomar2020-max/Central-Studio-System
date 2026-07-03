/**
 * Offers — Phase 6D deprecation state.
 *
 * The admin Offers UI was removed in Phase 6C, so the admin mutation
 * endpoints (POST/PATCH/DELETE) are deprecated here and return 410 Gone.
 * This also guarantees no new `offer_published` notification broadcasts can
 * be produced. The public GET endpoints stay intact for backward
 * compatibility with the published API contract until Phase 6E removes the
 * feature end-to-end (routes, dashboard totalOffers, OpenAPI, DB table).
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, offersTable } from "@workspace/db";
import {
  GetOfferParams,
  GetOfferResponse,
  ListOffersResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const OFFERS_ADMIN_DEPRECATED = {
  error: "Offers admin management has been deprecated. Use Promotions instead.",
} as const;

router.get("/offers", async (req, res): Promise<void> => {
  const rows = await db.select().from(offersTable).orderBy(offersTable.createdAt);
  res.json(ListOffersResponse.parse(rows));
});

// Phase 6D: admin create deprecated — no inserts, no offer_published broadcasts.
router.post("/offers", (_req, res): void => {
  res.status(410).json(OFFERS_ADMIN_DEPRECATED);
});

router.get("/offers/:id", async (req, res): Promise<void> => {
  const params = GetOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(offersTable).where(eq(offersTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  res.json(GetOfferResponse.parse(row));
});

// Phase 6D: admin update deprecated — no updates, no offer_published broadcasts.
router.patch("/offers/:id", (_req, res): void => {
  res.status(410).json(OFFERS_ADMIN_DEPRECATED);
});

// Phase 6D: admin delete deprecated.
router.delete("/offers/:id", (_req, res): void => {
  res.status(410).json(OFFERS_ADMIN_DEPRECATED);
});

export default router;
