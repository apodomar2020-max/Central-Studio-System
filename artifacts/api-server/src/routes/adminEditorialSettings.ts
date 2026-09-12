import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { captureError } from "../lib/errorMonitoring";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { adminActivityActor } from "../lib/activityLog";
import {
  canonicalizeEditorialLanguageCode,
  EDITORIAL_LANGUAGE_CODE_RE,
  type EditorialLanguageDirection,
} from "@workspace/db";
import { EditorialRuleError } from "../lib/editorialCore";
import {
  countTranslationsByLanguage,
  createLanguage,
  listLanguages,
  loadLanguageOrThrow,
  setDefaultLanguage,
  setLanguageActive,
  updateLanguage,
} from "../lib/editorialLanguagesService";
import { getWebsiteLinks, updateWebsiteLinks } from "../lib/editorialWebsiteLinksService";
import { db } from "@workspace/db";
import {
  ListEditorialLanguagesQueryParams,
  ListEditorialLanguagesResponse,
  CreateEditorialLanguageBody,
  CreateEditorialLanguageResponse,
  GetEditorialLanguageParams,
  GetEditorialLanguageResponse,
  UpdateEditorialLanguageParams,
  UpdateEditorialLanguageBody,
  UpdateEditorialLanguageResponse,
  ActivateEditorialLanguageParams,
  ActivateEditorialLanguageResponse,
  DeactivateEditorialLanguageParams,
  DeactivateEditorialLanguageResponse,
  SetDefaultEditorialLanguageParams,
  SetDefaultEditorialLanguageResponse,
  GetEditorialWebsiteLinksResponse,
  UpdateEditorialWebsiteLinksBody,
  UpdateEditorialWebsiteLinksResponse,
} from "@workspace/api-zod";

/**
 * Website Settings (Wave 1.1) — Admin-only routes for content LANGUAGES and
 * the public site's app-store LINKS.
 *
 * Split into its own router, not bolted onto adminEditorial.ts, for one
 * reason that matters: these endpoints sit behind a DIFFERENT permission
 * family. Editorial content is `website.posts`; these are
 * `website.settings` (view/edit). Keeping them in separate files makes the
 * boundary visible rather than something a reader has to verify
 * handler-by-handler.
 *
 * `website.backgrounds` is deliberately NOT reused here — see
 * lib/api-zod/src/permissions.ts for the full reasoning. Nothing in this
 * file reads, writes, or references website_background_settings.
 *
 * NO PUBLIC ROUTES and NO DELETE ROUTES. Languages are retired with
 * is_active = false (the FK from editorial_post_translations is ON DELETE
 * RESTRICT precisely so a language cannot be deleted out from under
 * content), and the Links row is a migration-seeded singleton.
 */
const router: IRouter = Router();

function handleRouteError(err: unknown, res: import("express").Response, route: string, fallback: string): void {
  if (err instanceof EditorialRuleError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const pgCode = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (pgCode === "23505") {
    // Two possible unique collisions here, and they mean different things:
    // the code unique, and the partial single-default index. The latter can
    // only be hit by a genuinely concurrent promotion, since the service
    // layer demotes the incumbent first under a row lock.
    const message = /single_default/.test(String((err as { constraint?: string })?.constraint ?? ""))
      ? "Another administrator changed the default language at the same moment. Try again."
      : "That language code is already registered.";
    res.status(409).json({ error: message });
    return;
  }
  captureError(err, { route });
  logger.error({ err }, `${route} failed`);
  res.status(500).json({ error: fallback });
}

// ─── Languages ──────────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/settings/languages",
  requireAdminAuth,
  requireAdminPermission("website.settings", "view"),
  async (req, res): Promise<void> => {
    const query = ListEditorialLanguagesQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? "Invalid query" });
      return;
    }
    try {
      // INACTIVE LANGUAGES ARE RETAINED AND RETURNED by default. They are
      // excluded from new-translation pickers and from publishing, never
      // deleted and never hidden from the settings screen — an editor has
      // to be able to see and reactivate one.
      const rows = await listLanguages(db, { activeOnly: query.data.activeOnly === true });
      const counts = await countTranslationsByLanguage(db);

      res.json(
        ListEditorialLanguagesResponse.parse(
          rows.map((row) => {
            const mine = counts.filter((entry) => entry.languageId === row.id);
            const of = (status: string) => mine.find((entry) => entry.status === status)?.count ?? 0;
            return {
              ...row,
              translationCounts: {
                draft: of("draft"),
                published: of("published"),
                archived: of("archived"),
              },
            };
          }),
        ),
      );
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/settings/languages", "Failed to list languages");
    }
  },
);

router.post(
  "/admin/editorial/settings/languages",
  requireAdminAuth,
  requireAdminPermission("website.settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = CreateEditorialLanguageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const body = parsed.data;

    // Canonicalize BEFORE validating so "EN-gb" is accepted and stored as
    // "en-GB" — one spelling per locale, which is what makes the UNIQUE on
    // `code` meaningful.
    const code = canonicalizeEditorialLanguageCode(body.code);
    if (!EDITORIAL_LANGUAGE_CODE_RE.test(code)) {
      res.status(400).json({
        error: 'A language code must be a locale tag like "en", "ar", "en-GB", or "zh-Hant-TW".',
      });
      return;
    }

    try {
      const row = await createLanguage(
        {
          code,
          name: body.name,
          nativeName: body.nativeName,
          direction: body.direction as EditorialLanguageDirection,
          ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        },
        { actor: adminActivityActor(req), actorAdminId: req.adminUser?.id ?? null },
      );
      res.status(201).json(CreateEditorialLanguageResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/settings/languages", "Failed to create language");
    }
  },
);

router.get(
  "/admin/editorial/settings/languages/:id",
  requireAdminAuth,
  requireAdminPermission("website.settings", "view"),
  async (req, res): Promise<void> => {
    const params = GetEditorialLanguageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      res.json(GetEditorialLanguageResponse.parse(await loadLanguageOrThrow(db, params.data.id)));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/settings/languages/:id", "Failed to load language");
    }
  },
);

/**
 * Presentation-only edit. `code`, `isActive` and `isDefault` are absent
 * from the body schema on purpose — the code is the identity every stored
 * translation is keyed to, and the two flags are lifecycle transitions
 * with their own invariants and their own audit events (below). Folding
 * them into a generic PATCH is how single-default races and unaudited
 * deactivations get introduced.
 */
router.patch(
  "/admin/editorial/settings/languages/:id",
  requireAdminAuth,
  requireAdminPermission("website.settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = UpdateEditorialLanguageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    const parsed = UpdateEditorialLanguageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    try {
      const row = await updateLanguage(
        params.data.id,
        parsed.data as never,
        { actor: adminActivityActor(req), actorAdminId: req.adminUser?.id ?? null },
      );
      res.json(UpdateEditorialLanguageResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/settings/languages/:id", "Failed to update language");
    }
  },
);

router.post(
  "/admin/editorial/settings/languages/:id/activate",
  requireAdminAuth,
  requireAdminPermission("website.settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = ActivateEditorialLanguageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const row = await setLanguageActive(params.data.id, true, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      res.json(ActivateEditorialLanguageResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/settings/languages/:id/activate", "Failed to activate language");
    }
  },
);

/**
 * Retiring a language. Never a delete.
 *
 * The CURRENT DEFAULT is rejected with a 409 telling the editor to promote
 * another active language first, and so is the last remaining active
 * language. Existing translations keep their stored status — this touches
 * only the language row.
 */
router.post(
  "/admin/editorial/settings/languages/:id/deactivate",
  requireAdminAuth,
  requireAdminPermission("website.settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = DeactivateEditorialLanguageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const row = await setLanguageActive(params.data.id, false, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      res.json(DeactivateEditorialLanguageResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/settings/languages/:id/deactivate", "Failed to deactivate language");
    }
  },
);

router.post(
  "/admin/editorial/settings/languages/:id/default",
  requireAdminAuth,
  requireAdminPermission("website.settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = SetDefaultEditorialLanguageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0]?.message ?? "Invalid id" });
      return;
    }
    try {
      const row = await setDefaultLanguage(params.data.id, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      res.json(SetDefaultEditorialLanguageResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "POST /admin/editorial/settings/languages/:id/default", "Failed to set the default language");
    }
  },
);

// ─── Links ──────────────────────────────────────────────────────────────────

router.get(
  "/admin/editorial/settings/links",
  requireAdminAuth,
  requireAdminPermission("website.settings", "view"),
  async (_req, res): Promise<void> => {
    try {
      res.json(GetEditorialWebsiteLinksResponse.parse(await getWebsiteLinks(db)));
    } catch (err) {
      handleRouteError(err, res, "GET /admin/editorial/settings/links", "Failed to load website links");
    }
  },
);

router.patch(
  "/admin/editorial/settings/links",
  requireAdminAuth,
  requireAdminPermission("website.settings", "edit"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = UpdateEditorialWebsiteLinksBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    try {
      const row = await updateWebsiteLinks(parsed.data, {
        actor: adminActivityActor(req),
        actorAdminId: req.adminUser?.id ?? null,
      });
      res.json(UpdateEditorialWebsiteLinksResponse.parse(row));
    } catch (err) {
      handleRouteError(err, res, "PATCH /admin/editorial/settings/links", "Failed to update website links");
    }
  },
);

export default router;
