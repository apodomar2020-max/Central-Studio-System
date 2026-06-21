import { Router, type IRouter } from "express";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import { eq } from "drizzle-orm";
import { db, marketingCampaignsTable, studentsTable } from "@workspace/db";
import { count } from "drizzle-orm";
import {
  ListCampaignsResponse,
  CreateCampaignBody,
  GetCampaignParams,
  GetCampaignResponse,
  UpdateCampaignParams,
  UpdateCampaignBody,
  UpdateCampaignResponse,
  DeleteCampaignParams,
  SendCampaignResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function computeRecipientCount(audience: string): Promise<number> {
  if (audience === "students" || audience === "parents" || audience === "all") {
    const [{ c }] = await db.select({ c: count() }).from(studentsTable);
    return c;
  }
  return 0;
}

router.get("/marketing/campaigns", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const rows = await db.select().from(marketingCampaignsTable).orderBy(marketingCampaignsTable.createdAt);
  res.json(ListCampaignsResponse.parse(rows));
});

router.post("/marketing/campaigns", requireAdminAuth, requireAdminPermission("marketing", "create"), async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const recipientCount = await computeRecipientCount(parsed.data.targetAudience ?? "students");
  const [row] = await db.insert(marketingCampaignsTable).values({ ...parsed.data, recipientCount }).returning();
  res.status(201).json(GetCampaignResponse.parse(row));
});

router.get("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(GetCampaignResponse.parse(row));
});

router.patch("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.targetAudience) {
    (parsed.data as Record<string, unknown>).recipientCount = await computeRecipientCount(parsed.data.targetAudience);
  }
  const [row] = await db.update(marketingCampaignsTable).set(parsed.data).where(eq(marketingCampaignsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(UpdateCampaignResponse.parse(row));
});

router.delete("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "delete"), async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/marketing/campaigns/:id/send", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const sentCount = existing.recipientCount;
  const [row] = await db.update(marketingCampaignsTable).set({
    status: "sent",
    sentAt: new Date().toISOString(),
    sentCount,
  }).where(eq(marketingCampaignsTable.id, params.data.id)).returning();
  res.json(SendCampaignResponse.parse({ success: true, sentCount: row.sentCount, sentAt: row.sentAt }));
});

export default router;
