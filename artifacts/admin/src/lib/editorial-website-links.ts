/**
 * editorial-website-links — the PURE half of Website → Settings → Links
 * (Final Editorial, Phase A).
 *
 * Pure: no React, no imports beyond generated types, matching
 * `lib/editorial-topics.ts` and `lib/editorial-recommendations.ts`.
 *
 * ─── THE CONTRACT IS A SINGLETON, NOT A LIST ─────────────────────────────
 *
 * Verified against the real backend before anything was designed:
 *
 *   lib/db/src/schema/editorialWebsiteLinks.ts
 *       ONE row, `id = 1`, enforced by an `id = 1` CHECK. Exactly two
 *       nullable columns: `google_play_url`, `app_store_url`.
 *   artifacts/api-server/src/routes/adminEditorialSettings.ts
 *       GET  /admin/editorial/settings/links   website.settings:view
 *       PATCH /admin/editorial/settings/links  website.settings:edit
 *       There is NO create route and NO delete route.
 *
 * So this is NOT a generic "website links" CRUD list. There is no add, no
 * remove, no reorder and no link "type" to invent, because the backend has
 * no concept of any of those. The screen edits TWO NAMED FIELDS. Building a
 * generic list UI over a two-column singleton would be a UI promising
 * capabilities the API does not have.
 *
 * ─── VALIDATION IS THE SERVER'S, MIRRORED VERBATIM ───────────────────────
 *
 * `normalizeWebsiteLink` in
 * artifacts/api-server/src/lib/editorialWebsiteLinksService.ts is the
 * authority, and the same shape is restated as CHECK constraints on the
 * table. The rules below are a character-for-character mirror of its
 * messages so an inline hint and a 400 can never disagree. NOTHING here is
 * relaxed for UX convenience: https-only stays https-only, and the
 * forbidden-character set stays exactly as wide.
 *
 * Note this is NOT the editorial MEDIA validator: an outbound store link to
 * apple.com is a different risk from an <img src>, and the backend keeps the
 * two rules deliberately separate. This module does not blur them either.
 */
import type { EditorialWebsiteLinks, UpdateEditorialWebsiteLinksBody } from "@workspace/api-client-react";

export const WEBSITE_LINK_FIELDS = ["googlePlayUrl", "appStoreUrl"] as const;
export type WebsiteLinkField = (typeof WEBSITE_LINK_FIELDS)[number];

/** The operator-facing name of each field, matching the server's own labels. */
export const WEBSITE_LINK_LABELS: Record<WebsiteLinkField, string> = {
  googlePlayUrl: "Google Play link",
  appStoreUrl: "App Store link",
};

export const WEBSITE_LINK_HINTS: Record<WebsiteLinkField, string> = {
  googlePlayUrl: "The Android download badge on the public website.",
  appStoreUrl: "The iOS download badge on the public website.",
};

export const WEBSITE_LINKS_PAGE_DESCRIPTION =
  "The two app-store download links the public website shows. Leave one blank to hide that badge — an empty value is a valid, supported state, not an error.";

export const WEBSITE_LINKS_HTTPS_NOTE =
  "Both links must start with https:// — these render as badges on a public page, so an http link is a downgrade vector.";

export const WEBSITE_LINKS_SAVE_LABEL = "Save links";

export const WEBSITE_LINKS_EMPTY_STATE =
  "Neither download link is configured yet. Both badges are hidden on the public website.";

export const WEBSITE_LINKS_READ_ONLY_NOTICE =
  "You have view access to Website Settings but cannot change them. Editing needs the Edit permission on Website Settings.";

/** Characters the SERVER forbids, restated verbatim (service + CHECK constraint). */
const FORBIDDEN_URL_CHARS = /[<>"'\\\s]/u;

export interface WebsiteLinksFormValues {
  googlePlayUrl: string;
  appStoreUrl: string;
}

export const EMPTY_WEBSITE_LINKS_FORM: WebsiteLinksFormValues = {
  googlePlayUrl: "",
  appStoreUrl: "",
};

export function toWebsiteLinksFormValues(
  row: Pick<EditorialWebsiteLinks, "googlePlayUrl" | "appStoreUrl"> | null | undefined,
): WebsiteLinksFormValues {
  return {
    googlePlayUrl: row?.googlePlayUrl ?? "",
    appStoreUrl: row?.appStoreUrl ?? "",
  };
}

/**
 * One field's problem, or null. The messages are the SERVER's, verbatim, in
 * the SERVER's order of checks — forbidden characters, then parseability,
 * then protocol, then host — so the first message an operator sees inline is
 * the same one the 400 would carry.
 */
export function validateWebsiteLink(field: WebsiteLinkField, raw: string): string | null {
  const value = raw.trim();
  // Blank is VALID: it means "not configured", and the column is nullable.
  if (value.length === 0) return null;

  const label = WEBSITE_LINK_LABELS[field];

  if (FORBIDDEN_URL_CHARS.test(value)) {
    return `The ${label} contains characters that are not allowed in a URL (spaces, quotes, angle brackets, or backslashes).`;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `The ${label} is not a valid URL.`;
  }
  if (parsed.protocol !== "https:") return `The ${label} must use https.`;
  if (parsed.hostname.length === 0) return `The ${label} must include a host.`;
  return null;
}

export type WebsiteLinksFormErrors = Partial<Record<WebsiteLinkField, string>>;

export function validateWebsiteLinksForm(values: WebsiteLinksFormValues): WebsiteLinksFormErrors {
  const errors: WebsiteLinksFormErrors = {};
  for (const field of WEBSITE_LINK_FIELDS) {
    const message = validateWebsiteLink(field, values[field]);
    if (message) errors[field] = message;
  }
  return errors;
}

export function hasWebsiteLinksFormErrors(errors: WebsiteLinksFormErrors): boolean {
  return WEBSITE_LINK_FIELDS.some((field) => Boolean(errors[field]));
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function areWebsiteLinksDirty(
  values: WebsiteLinksFormValues,
  baseline: WebsiteLinksFormValues,
): boolean {
  return WEBSITE_LINK_FIELDS.some(
    (field) => textOrNull(values[field]) !== textOrNull(baseline[field]),
  );
}

/**
 * ONLY CHANGED FIELDS ARE SENT, the same rule
 * `toTranslationUpdatePayload` follows. The route copies a key only when
 * `body[key] !== undefined`, so an absent key means "leave it alone" and an
 * explicit `null` means "clear it". Sending both fields unconditionally
 * would make every save a write to both columns and put both in the audit
 * row's `after` even when one was untouched.
 */
export function toWebsiteLinksPayload(
  values: WebsiteLinksFormValues,
  baseline: WebsiteLinksFormValues,
): UpdateEditorialWebsiteLinksBody {
  const payload: UpdateEditorialWebsiteLinksBody = {};
  for (const field of WEBSITE_LINK_FIELDS) {
    const next = textOrNull(values[field]);
    if (next !== textOrNull(baseline[field])) payload[field] = next;
  }
  return payload;
}

export function isWebsiteLinksEmpty(values: WebsiteLinksFormValues): boolean {
  return WEBSITE_LINK_FIELDS.every((field) => values[field].trim().length === 0);
}
