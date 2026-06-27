import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, offersTable } from "@workspace/db";
import { createBroadcastNotification } from "../lib/notifications";
import {
  CreateOfferBody,
  GetOfferParams,
  GetOfferResponse,
  UpdateOfferParams,
  UpdateOfferBody,
  UpdateOfferResponse,
  DeleteOfferParams,
  ListOffersResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/offers", async (req, res): Promise<void> => {
  const rows = await db.select().from(offersTable).orderBy(offersTable.createdAt);
  res.json(ListOffersResponse.parse(rows));
});

router.post("/offers", blockStudentJwt, requireAdminAuth, requireAdminPermission("offers", "create"), async (req, res): Promise<void> => {
  const parsed = CreateOfferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(offersTable).values(parsed.data).returning();
    if (inserted.isActive) {
      await createBroadcastNotification(tx, {
        title: "New offer",
        body: `${inserted.title}${inserted.discountPercent > 0 ? `: ${inserted.discountPercent}% off` : ""}`,
        type: "offer_published",
        relatedEntityType: "offer",
        relatedEntityId: inserted.id,
        metadata: {
          amount: inserted.discountPercent,
          currency: "percent",
        },
      });
    }
    return inserted;
  });
  res.status(201).json(GetOfferResponse.parse(row));
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

router.patch("/offers/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("offers", "edit"), async (req, res): Promise<void> => {
  const params = UpdateOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateOfferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(offersTable).where(eq(offersTable.id, params.data.id));
    if (!existing) return null;

    const [updated] = await tx.update(offersTable).set(parsed.data).where(eq(offersTable.id, params.data.id)).returning();
    if (updated.isActive && !existing.isActive) {
      await createBroadcastNotification(tx, {
        title: "New offer",
        body: `${updated.title}${updated.discountPercent > 0 ? `: ${updated.discountPercent}% off` : ""}`,
        type: "offer_published",
        relatedEntityType: "offer",
        relatedEntityId: updated.id,
        metadata: {
          amount: updated.discountPercent,
          currency: "percent",
        },
      });
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  res.json(UpdateOfferResponse.parse(row));
});

router.delete("/offers/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("offers", "delete"), async (req, res): Promise<void> => {
  const params = DeleteOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(offersTable).where(eq(offersTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
