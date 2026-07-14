import { Router, type IRouter, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, backgroundMusicSettingsTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  MusicUrlValidationError,
  redactMusicUrl,
  validateBackgroundMusicUrl,
} from "../lib/backgroundMusicUrl";

const router: IRouter = Router();
const DEFAULT_VOLUME = 0.25;
const ACTIVITY_FIELDS = ["enabled", "sourceUrl", "sourceTitle", "volume", "loop", "version"] as const;

const UpdateBody = z.object({
  enabled: z.boolean(),
  sourceUrl: z.string().trim().max(4000).nullable().optional(),
  sourceTitle: z.string().trim().max(200).nullable().optional(),
  volume: z.coerce.number().min(0).max(1),
  loop: z.boolean().default(true),
});

const TestBody = z.object({
  sourceUrl: z.string().trim().min(1).max(4000),
  sourceTitle: z.string().trim().max(200).nullable().optional(),
});

type SettingsRow = typeof backgroundMusicSettingsTable.$inferSelect;

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function shapeBackgroundMusicClient(row: SettingsRow) {
  return {
    enabled: row.enabled,
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    volume: toNumber(row.volume),
    loop: row.loop,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function snapshot(row: SettingsRow): Record<string, unknown> {
  return {
    enabled: row.enabled,
    sourceUrl: redactMusicUrl(row.sourceUrl),
    sourceTitle: row.sourceTitle,
    volume: toNumber(row.volume),
    loop: row.loop,
    version: row.version,
  };
}

async function getOrCreateSettings(): Promise<SettingsRow> {
  const [existing] = await db
    .select()
    .from(backgroundMusicSettingsTable)
    .where(eq(backgroundMusicSettingsTable.id, 1))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(backgroundMusicSettingsTable)
    .values({ id: 1, enabled: false, volume: DEFAULT_VOLUME.toFixed(3), loop: true, version: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [afterRace] = await db
    .select()
    .from(backgroundMusicSettingsTable)
    .where(eq(backgroundMusicSettingsTable.id, 1))
    .limit(1);
  if (!afterRace) throw new Error("Background music settings could not be initialized");
  return afterRace;
}

function jsonError(res: Response, error: unknown): void {
  if (error instanceof MusicUrlValidationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: "Failed to process background music settings" });
}

router.get("/settings/background-music", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json(shapeBackgroundMusicClient(settings));
});

router.get(
  "/admin/settings/background-music",
  requireAdminAuth,
  requireAdminPermission("settings", "view"),
  async (_req, res): Promise<void> => {
    const settings = await getOrCreateSettings();
    res.json(shapeBackgroundMusicClient(settings));
  },
);

router.post(
  "/admin/settings/background-music/test",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req, res): Promise<void> => {
    const parsed = TestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid music URL" });
      return;
    }
    try {
      const result = await validateBackgroundMusicUrl(parsed.data.sourceUrl, parsed.data.sourceTitle);
      res.json({
        sourceUrl: result.normalizedUrl,
        sourceTitle: result.title,
        sourceType: result.sourceType,
        contentType: result.contentType,
        contentLength: result.contentLength,
      });
    } catch (error) {
      jsonError(res, error);
    }
  },
);

router.patch(
  "/admin/settings/background-music",
  requireAdminAuth,
  requireAdminPermission("settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid background music settings" });
      return;
    }

    try {
      const inputUrl = parsed.data.sourceUrl === undefined ? undefined : parsed.data.sourceUrl?.trim() || null;
      let validatedUrl: string | undefined | null = inputUrl;
      let validatedTitle = parsed.data.sourceTitle?.trim() || null;

      if (inputUrl) {
        const validation = await validateBackgroundMusicUrl(inputUrl, validatedTitle);
        validatedUrl = validation.normalizedUrl;
        validatedTitle = validation.title ?? null;
      }

      const updateResult = await db.transaction(async (tx) => {
        await tx
          .insert(backgroundMusicSettingsTable)
          .values({ id: 1, enabled: false, volume: DEFAULT_VOLUME.toFixed(3), loop: true, version: 1 })
          .onConflictDoNothing();

        const [beforeSettings] = await tx
          .select()
          .from(backgroundMusicSettingsTable)
          .where(eq(backgroundMusicSettingsTable.id, 1))
          .limit(1)
          .for("update");
        if (!beforeSettings) throw new Error("Background music settings could not be loaded");

        const nextSourceUrl = validatedUrl === undefined ? beforeSettings.sourceUrl : validatedUrl;
        if (parsed.data.enabled && !nextSourceUrl) {
          throw new MusicUrlValidationError("Add a valid public audio URL before enabling background music.");
        }

        const nextValues = {
          enabled: parsed.data.enabled,
          sourceUrl: nextSourceUrl,
          sourceTitle: parsed.data.sourceTitle === undefined ? beforeSettings.sourceTitle : validatedTitle,
          volume: parsed.data.volume.toFixed(3),
          loop: parsed.data.loop,
          updatedByAdminId: req.adminUser?.id ?? null,
          updatedAt: new Date().toISOString(),
        };

        const [settings] = await tx
          .update(backgroundMusicSettingsTable)
          .set({
            ...nextValues,
            version: sql`${backgroundMusicSettingsTable.version} + 1`,
          })
          .where(eq(backgroundMusicSettingsTable.id, 1))
          .returning();
        if (!settings) throw new Error("Background music settings could not be saved");

        return { beforeSettings, settings };
      });

      const { beforeSettings, settings } = updateResult;

      const { before, after } = diffFields(snapshot(beforeSettings), snapshot(settings), ACTIVITY_FIELDS);
      if (Object.keys(after).length > 0) {
        await logActivity(req, {
          action: settings.enabled ? "update" : "deactivate",
          module: "settings",
          entityType: "background_music_settings",
          entityId: settings.id,
          entityLabel: "Background music",
          before,
          after,
          summary: "Updated background music settings",
        });
      }

      res.json(shapeBackgroundMusicClient(settings));
    } catch (error) {
      jsonError(res, error);
    }
  },
);

export default router;
