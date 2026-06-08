import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, offersTable } from "@workspace/db";
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

router.post("/offers", async (req, res): Promise<void> => {
  const parsed = CreateOfferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(offersTable).values(parsed.data).returning();
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

router.patch("/offers/:id", async (req, res): Promise<void> => {
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
  const [row] = await db.update(offersTable).set(parsed.data).where(eq(offersTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  res.json(UpdateOfferResponse.parse(row));
});

router.delete("/offers/:id", async (req, res): Promise<void> => {
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
