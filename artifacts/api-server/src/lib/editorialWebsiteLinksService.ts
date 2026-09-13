/**
 * editorialWebsiteLinksService — Website Settings > Links (Wave 1.1).
 *
 * The public website's two app-store download links, editable from Admin.
 *
 * PERSISTENCE: a dedicated SINGLE-ROW table (`editorial_website_links`,
 * id = 1), seeded by migration 0126 and thereafter only ever updated —
 * there is no create and no delete path. This follows the repo's existing
 * dedicated-settings-table convention (ballet_settings,
 * background_music_settings, class_*_settings), which was searched for
 * before anything new was invented; the repo has no generic key/value
 * settings store to extend. `website_background_settings` was deliberately
 * NOT extended — see the table's own header for why.
 *
 * VALIDATION, in one place so the route and any future caller cannot
 * diverge:
 *   * NULL / empty is ALLOWED and means "not configured". "" is
 *     normalized to NULL on write so the two spellings of "unset" cannot
 *     both exist in the column.
 *   * HTTPS ONLY. These render as store badges on a public page; an http
 *     link is a downgrade vector, and a non-http(s) scheme (javascript:,
 *     data:) is an injection vector.
 *   * A parseable absolute URL WITH A HOST.
 *   * NO HTML / markup characters (`< > " ' \`) and no whitespace, so a
 *     stored value can never break out of an attribute context wherever
 *     the website interpolates it.
 * The same shape is restated as CHECK constraints on the table, so a value
 * that skipped this layer still cannot land.
 *
 * Note this is NOT the editorial MEDIA validator (editorialMediaUrl.ts):
 * that one does live DNS + HEAD checks against an image host allowlist,
 * which is the right trust boundary for an <img src> but the wrong one for
 * an outbound store link to apple.com / play.google.com. The two are
 * deliberately separate rules for deliberately different risks.
 */
import { eq } from "drizzle-orm";
import { db, editorialWebsiteLinksTable, type EditorialWebsiteLinks } from "@workspace/db";
import type { DbClient } from "./dbTypes";
import { EditorialRuleError, auditEditorial } from "./editorialCore";
import type { ActivityActorSnapshot } from "./activityLog";

const LINKS_ENTITY_TYPE = "editorial_website_links";
const LINKS_ROW_ID = 1;

/** Characters that must never appear in a stored URL. */
const FORBIDDEN_URL_CHARS = /[<>"'\\\s]/u;

export const WEBSITE_LINK_FIELDS = ["googlePlayUrl", "appStoreUrl"] as const;
export type WebsiteLinkField = (typeof WEBSITE_LINK_FIELDS)[number];

const FIELD_LABELS: Record<WebsiteLinkField, string> = {
  googlePlayUrl: "Google Play link",
  appStoreUrl: "App Store link",
};

/**
 * Validate and normalize one link value.
 *
 * Returns the value to store: a trimmed URL string, or null for
 * "not configured". Throws EditorialRuleError (400) naming the field.
 */
export function normalizeWebsiteLink(field: WebsiteLinkField, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  const label = FIELD_LABELS[field];

  if (FORBIDDEN_URL_CHARS.test(value)) {
    throw new EditorialRuleError(
      `The ${label} contains characters that are not allowed in a URL (spaces, quotes, angle brackets, or backslashes).`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EditorialRuleError(`The ${label} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new EditorialRuleError(`The ${label} must use https.`);
  }
  if (parsed.hostname.length === 0) {
    throw new EditorialRuleError(`The ${label} must include a host.`);
  }
  return value;
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * The singleton row. Migration 0126 seeds it, but this falls back to an
 * all-null projection rather than throwing if it is somehow absent — a
 * missing settings row must never 500 the Admin settings page.
 */
export async function getWebsiteLinks(client: DbClient = db): Promise<EditorialWebsiteLinks | {
  id: number;
  googlePlayUrl: null;
  appStoreUrl: null;
  createdAt: null;
  updatedAt: null;
  updatedByAdminId: null;
}> {
  const [row] = await client
    .select()
    .from(editorialWebsiteLinksTable)
    .where(eq(editorialWebsiteLinksTable.id, LINKS_ROW_ID))
    .limit(1);
  return (
    row ?? {
      id: LINKS_ROW_ID,
      googlePlayUrl: null,
      appStoreUrl: null,
      createdAt: null,
      updatedAt: null,
      updatedByAdminId: null,
    }
  );
}

// ─── Update ─────────────────────────────────────────────────────────────────

export interface UpdateWebsiteLinksInput {
  googlePlayUrl?: string | null;
  appStoreUrl?: string | null;
}

export interface WebsiteLinksActorContext {
  actor: ActivityActorSnapshot;
  actorAdminId: number | null;
}

/**
 * PATCH semantics: an omitted field is left alone, an explicit null or ""
 * clears it.
 *
 * One audit row PER FIELD THAT ACTUALLY CHANGED
 * ("links_google_play_changed" / "links_app_store_changed"), written in the
 * same transaction as the update — so the audit trail says which link
 * moved, not merely that "settings were saved". A patch that changes
 * nothing writes no audit row.
 */
export async function updateWebsiteLinks(
  input: UpdateWebsiteLinksInput,
  ctx: WebsiteLinksActorContext,
): Promise<EditorialWebsiteLinks> {
  // Validate BEFORE opening the transaction so a bad payload never takes a
  // row lock.
  const normalized: Partial<Record<WebsiteLinkField, string | null>> = {};
  for (const field of WEBSITE_LINK_FIELDS) {
    if (input[field] !== undefined) normalized[field] = normalizeWebsiteLink(field, input[field]);
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(editorialWebsiteLinksTable)
      .where(eq(editorialWebsiteLinksTable.id, LINKS_ROW_ID))
      .limit(1)
      .for("update");
    if (!existing) {
      throw new EditorialRuleError(
        "Website link settings have not been initialized. Run database migrations.",
        500,
      );
    }

    const changed = WEBSITE_LINK_FIELDS.filter(
      (field) => normalized[field] !== undefined && normalized[field] !== existing[field],
    );
    if (changed.length === 0) return existing;

    const [row] = await tx
      .update(editorialWebsiteLinksTable)
      .set({ ...normalized, updatedByAdminId: ctx.actorAdminId })
      .where(eq(editorialWebsiteLinksTable.id, LINKS_ROW_ID))
      .returning();

    for (const field of changed) {
      await auditEditorial(tx, ctx.actor, {
        action: field === "googlePlayUrl" ? "links_google_play_changed" : "links_app_store_changed",
        entityType: LINKS_ENTITY_TYPE,
        entityId: LINKS_ROW_ID,
        entityLabel: FIELD_LABELS[field],
        before: { [field]: existing[field] },
        after: { [field]: row[field] },
        summary:
          row[field] === null
            ? `Cleared the website ${FIELD_LABELS[field]}`
            : `Updated the website ${FIELD_LABELS[field]}`,
      });
    }
    return row;
  });
}
