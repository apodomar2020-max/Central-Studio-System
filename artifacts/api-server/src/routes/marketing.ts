import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, isNotNull, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bookingsTable,
  classWhatsappGroupsTable,
  classesTable,
  db,
  marketingCampaignRecipientsTable,
  marketingCampaignsTable,
  marketingDeliveryLogsTable,
  marketingOptInsTable,
  marketingTemplatesTable,
  packageOrdersTable,
  schedulesTable,
  studentsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
import {
  DeleteCampaignParams,
  GetCampaignParams,
  SendCampaignResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const audienceTypeValues = [
  "all",
  "students",
  "parents",
  "class",
  "schedule",
  "bookingStatus",
  "activePackage",
  "packageExpiringSoon",
  "manual",
] as const;

const CampaignBody = z.object({
  title: z.string().min(1),
  type: z.enum(["whatsapp", "email"]).default("whatsapp"),
  templateId: z.coerce.number().int().positive().nullish(),
  subject: z.string().nullish(),
  message: z.string().min(1),
  targetAudience: z.string().nullish(),
  audienceType: z.enum(audienceTypeValues).default("students"),
  audienceConfig: z.record(z.string(), z.unknown()).nullish(),
});

const UpdateCampaignBody = CampaignBody.partial();

const TemplateBody = z.object({
  name: z.string().min(1),
  category: z.enum(["utility", "marketing"]).default("marketing"),
  language: z.string().min(2).default("en"),
  body: z.string().min(1),
  status: z.enum(["draft", "approved", "archived"]).default("draft"),
  variables: z.array(z.string()).nullish(),
});

const ClassGroupBody = z.object({
  classId: z.coerce.number().int().positive(),
  scheduleId: z.coerce.number().int().positive().nullish(),
  title: z.string().nullish(),
  groupUrl: z.string().url(),
  isActive: z.boolean().default(true),
});

const PreviewBody = z.object({
  audienceType: z.enum(audienceTypeValues).optional(),
  audienceConfig: z.record(z.string(), z.unknown()).nullish(),
});

type AudienceType = (typeof audienceTypeValues)[number];
type AudienceConfig = Record<string, unknown> | null | undefined;
type StudentRow = typeof studentsTable.$inferSelect;

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("01") && digits.length === 11) digits = `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) digits = `20${digits}`;

  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry) && entry > 0)
    : [];
}

function mapAudienceToLegacyTarget(audienceType: AudienceType): string {
  if (audienceType === "all" || audienceType === "parents" || audienceType === "students") return audienceType;
  return audienceType;
}

async function countAudience(audienceType: AudienceType, audienceConfig: AudienceConfig): Promise<number> {
  const preview = await resolveRecipients(audienceType, audienceConfig, 0);
  return preview.eligibleCount;
}

async function studentsByIds(ids: number[]): Promise<StudentRow[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  return db.select().from(studentsTable).where(inArray(studentsTable.id, uniqueIds));
}

async function resolveAudienceStudents(audienceType: AudienceType, audienceConfig: AudienceConfig): Promise<Array<StudentRow & { audienceReason?: string }>> {
  const config = audienceConfig ?? {};

  if (audienceType === "all") {
    return db.select().from(studentsTable);
  }

  if (audienceType === "students") {
    return db.select().from(studentsTable).where(sql`coalesce(${studentsTable.accountType}, 'student') <> 'parent'`);
  }

  if (audienceType === "parents") {
    return db.select().from(studentsTable).where(eq(studentsTable.accountType, "parent"));
  }

  if (audienceType === "manual") {
    return studentsByIds(asNumberArray(config["studentIds"]));
  }

  if (audienceType === "class" || audienceType === "schedule" || audienceType === "bookingStatus") {
    const classId = asNumber(config["classId"]);
    const scheduleId = asNumber(config["scheduleId"]);
    const bookingStatus = asString(config["bookingStatus"]);
    const occurrenceDate = asString(config["occurrenceDate"]);

    const rows = await db
      .select({
        studentId: bookingsTable.accountOwnerStudentId,
        studentEmail: bookingsTable.studentEmail,
      })
      .from(bookingsTable)
      .where(and(
        audienceType === "class" && classId ? eq(bookingsTable.classId, classId) : undefined,
        audienceType === "schedule" && scheduleId ? eq(bookingsTable.scheduleId, scheduleId) : undefined,
        audienceType === "schedule" && occurrenceDate ? eq(bookingsTable.occurrenceDate, occurrenceDate) : undefined,
        audienceType === "bookingStatus" && bookingStatus ? eq(bookingsTable.bookingStatus, bookingStatus) : undefined,
      ));

    const ids = rows.map((row) => row.studentId).filter((id): id is number => typeof id === "number");
    const emails = rows.map((row) => row.studentEmail?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
    if (ids.length === 0 && emails.length === 0) return [];

    return db
      .select()
      .from(studentsTable)
      .where(or(
        ids.length > 0 ? inArray(studentsTable.id, [...new Set(ids)]) : undefined,
        emails.length > 0 ? inArray(sql`lower(trim(${studentsTable.email}))`, [...new Set(emails)]) : undefined,
      ));
  }

  if (audienceType === "activePackage" || audienceType === "packageExpiringSoon") {
    const now = new Date();
    const expiringBefore = new Date(now);
    expiringBefore.setDate(expiringBefore.getDate() + Number(config["days"] ?? 14));

    const rows = await db
      .select({
        studentId: packageOrdersTable.studentId,
        studentEmail: packageOrdersTable.studentEmail,
      })
      .from(packageOrdersTable)
      .where(and(
        eq(packageOrdersTable.status, "active"),
        gt(packageOrdersTable.remainingCredits, 0),
        audienceType === "packageExpiringSoon"
          ? and(
            isNotNull(packageOrdersTable.expiresAt),
            lte(packageOrdersTable.expiresAt, expiringBefore.toISOString()),
          )
          : undefined,
      ));

    const ids = rows.map((row) => row.studentId).filter((id): id is number => typeof id === "number");
    const emails = rows.map((row) => row.studentEmail?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
    if (ids.length === 0 && emails.length === 0) return [];

    return db
      .select()
      .from(studentsTable)
      .where(or(
        ids.length > 0 ? inArray(studentsTable.id, [...new Set(ids)]) : undefined,
        emails.length > 0 ? inArray(sql`lower(trim(${studentsTable.email}))`, [...new Set(emails)]) : undefined,
      ));
  }

  return [];
}

async function resolveRecipients(audienceType: AudienceType, audienceConfig: AudienceConfig, sampleLimit = 25) {
  const students = await resolveAudienceStudents(audienceType, audienceConfig);
  const seen = new Set<string>();
  const normalizedPhones = students.map((student) => normalizePhone(student.phone)).filter((phone): phone is string => Boolean(phone));
  const optOutRows = normalizedPhones.length > 0
    ? await db.select().from(marketingOptInsTable).where(and(
      inArray(marketingOptInsTable.normalizedPhone, [...new Set(normalizedPhones)]),
      eq(marketingOptInsTable.channel, "whatsapp"),
      or(eq(marketingOptInsTable.status, "opted_out"), isNotNull(marketingOptInsTable.optedOutAt)),
    ))
    : [];
  const optedOutPhones = new Set(optOutRows.map((row) => row.normalizedPhone));

  const excluded = { missingPhone: 0, invalidPhone: 0, optedOut: 0, duplicate: 0 };
  const eligible = [];

  for (const student of students) {
    if (!student.phone) {
      excluded.missingPhone += 1;
      continue;
    }
    const normalizedPhone = normalizePhone(student.phone);
    if (!normalizedPhone) {
      excluded.invalidPhone += 1;
      continue;
    }
    if (optedOutPhones.has(normalizedPhone)) {
      excluded.optedOut += 1;
      continue;
    }
    if (seen.has(normalizedPhone)) {
      excluded.duplicate += 1;
      continue;
    }
    seen.add(normalizedPhone);
    eligible.push({
      studentId: student.id,
      name: student.name,
      email: student.email,
      phone: student.phone,
      normalizedPhone,
      accountType: student.accountType,
      audienceReason: audienceType,
    });
  }

  return {
    totalCandidates: students.length,
    eligibleCount: eligible.length,
    excluded,
    sample: sampleLimit > 0 ? eligible.slice(0, sampleLimit) : [],
    recipients: eligible,
  };
}

router.get("/marketing/templates", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const rows = await db.select().from(marketingTemplatesTable).orderBy(desc(marketingTemplatesTable.createdAt));
  res.json(rows);
});

router.post("/marketing/templates", requireAdminAuth, requireAdminPermission("marketing", "create"), async (req, res): Promise<void> => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(marketingTemplatesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/marketing/templates/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = TemplateBody.partial().safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: !parsed.success ? parsed.error.message : "Invalid template id" });
    return;
  }
  const [row] = await db.update(marketingTemplatesTable).set(parsed.data).where(eq(marketingTemplatesTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(row);
});

router.get("/marketing/audience/search", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const pattern = `%${q.toLowerCase()}%`;
  const rows = await db
    .select({
      id: studentsTable.id,
      name: studentsTable.name,
      email: studentsTable.email,
      phone: studentsTable.phone,
      accountType: studentsTable.accountType,
    })
    .from(studentsTable)
    .where(or(
      like(sql`lower(${studentsTable.name})`, pattern),
      like(sql`lower(${studentsTable.email})`, pattern),
      like(sql`coalesce(${studentsTable.phone}, '')`, `%${q}%`),
    ))
    .limit(25);
  res.json(rows);
});

router.get("/marketing/class-groups", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: classWhatsappGroupsTable.id,
      classId: classWhatsappGroupsTable.classId,
      scheduleId: classWhatsappGroupsTable.scheduleId,
      title: classWhatsappGroupsTable.title,
      groupUrl: classWhatsappGroupsTable.groupUrl,
      isActive: classWhatsappGroupsTable.isActive,
      createdAt: classWhatsappGroupsTable.createdAt,
      classTitle: classesTable.title,
      scheduleDate: schedulesTable.date,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleStartTime: schedulesTable.startTime,
    })
    .from(classWhatsappGroupsTable)
    .leftJoin(classesTable, eq(classWhatsappGroupsTable.classId, classesTable.id))
    .leftJoin(schedulesTable, eq(classWhatsappGroupsTable.scheduleId, schedulesTable.id))
    .orderBy(desc(classWhatsappGroupsTable.createdAt));
  res.json(rows);
});

router.post("/marketing/class-groups", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const parsed = ClassGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(classWhatsappGroupsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/marketing/class-groups/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ClassGroupBody.partial().safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: !parsed.success ? parsed.error.message : "Invalid group id" });
    return;
  }
  const [row] = await db.update(classWhatsappGroupsTable).set(parsed.data).where(eq(classWhatsappGroupsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Group link not found" });
    return;
  }
  res.json(row);
});

router.get("/marketing/campaigns", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const rows = await db.select().from(marketingCampaignsTable).orderBy(desc(marketingCampaignsTable.createdAt));
  res.json(rows);
});

router.post("/marketing/campaigns", requireAdminAuth, requireAdminPermission("marketing", "create"), async (req, res): Promise<void> => {
  const parsed = CampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const audienceType = parsed.data.audienceType;
  const audienceConfig = parsed.data.audienceConfig ?? null;
  const recipientCount = await countAudience(audienceType, audienceConfig);
  const [row] = await db.insert(marketingCampaignsTable).values({
    ...parsed.data,
    targetAudience: parsed.data.targetAudience ?? mapAudienceToLegacyTarget(audienceType),
    audienceConfig,
    recipientCount,
    status: "draft",
  }).returning();
  res.status(201).json(row);
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
  res.json(row);
});

router.patch("/marketing/campaigns/:id", requireAdminAuth, requireAdminPermission("marketing", "edit"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData = { ...parsed.data };
  if (parsed.data.audienceType || parsed.data.audienceConfig) {
    const [existing] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const audienceType = parsed.data.audienceType ?? (existing.audienceType as AudienceType);
    const audienceConfig = parsed.data.audienceConfig ?? existing.audienceConfig;
    updateData.targetAudience = parsed.data.targetAudience ?? mapAudienceToLegacyTarget(audienceType);
    updateData.recipientCount = await countAudience(audienceType, audienceConfig);
  }
  const [row] = await db.update(marketingCampaignsTable).set(updateData).where(eq(marketingCampaignsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(row);
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

router.post("/marketing/campaigns/:id/preview-recipients", requireAdminAuth, requireAdminPermission("marketing", "view"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  const body = PreviewBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error.message });
    return;
  }
  const [campaign] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const audienceType = body.data.audienceType ?? (campaign.audienceType as AudienceType);
  const audienceConfig = body.data.audienceConfig ?? campaign.audienceConfig;
  const preview = await resolveRecipients(audienceType, audienceConfig, 25);
  res.json({
    audienceType,
    audienceConfig,
    totalCandidates: preview.totalCandidates,
    eligibleCount: preview.eligibleCount,
    excluded: preview.excluded,
    sample: preview.sample,
  });
});

router.post("/marketing/campaigns/:id/prepare", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db.select().from(marketingCampaignsTable).where(eq(marketingCampaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const preview = await resolveRecipients(campaign.audienceType as AudienceType, campaign.audienceConfig, 0);
  const preparedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.delete(marketingCampaignRecipientsTable).where(eq(marketingCampaignRecipientsTable.campaignId, campaign.id));
    if (preview.recipients.length > 0) {
      await tx.insert(marketingCampaignRecipientsTable).values(preview.recipients.map((recipient) => ({
        campaignId: campaign.id,
        studentId: recipient.studentId,
        name: recipient.name,
        email: recipient.email,
        phone: recipient.phone,
        normalizedPhone: recipient.normalizedPhone,
        audienceReason: recipient.audienceReason,
        status: "prepared",
        metadata: { accountType: recipient.accountType },
      })));
    }
    await tx.insert(marketingDeliveryLogsTable).values({
      campaignId: campaign.id,
      eventType: "prepared",
      status: "prepared",
      payload: { eligibleCount: preview.eligibleCount, excluded: preview.excluded },
    });
    await tx.update(marketingCampaignsTable).set({
      status: "prepared",
      preparedAt,
      recipientCount: preview.eligibleCount,
      sentCount: 0,
    }).where(eq(marketingCampaignsTable.id, campaign.id));
  });
  res.json({ success: true, preparedAt, recipientCount: preview.eligibleCount, excluded: preview.excluded });
});

router.post("/marketing/campaigns/:id/send", requireAdminAuth, requireAdminPermission("marketing", "send"), async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  res.status(501).json(SendCampaignResponse.parse({
    success: false,
    sentCount: 0,
    sentAt: new Date().toISOString(),
  }));
});

export default router;
