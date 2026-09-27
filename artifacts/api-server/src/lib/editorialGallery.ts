/**
 * Zod validation for the Unified Editorial CMS translation gallery
 * (Final Editorial — Phase B, migration 0129).
 *
 * A gallery is an ORDERED list of media items a translation shows
 * alongside (not inside) its body. It is deliberately the smallest model
 * that preserves the legacy capability it replaces:
 *
 *   { items: [ { url, alt }, … ] }
 *
 * ─── WHY THIS SHAPE ──────────────────────────────────────────────────────
 *
 * `url` + REQUIRED `alt`, and nothing else.
 *
 *  - The order IS the array order. No `position` field, for the same
 *    reason `body.blocks` has none: a second ordering mechanism is a
 *    second thing that can disagree with itself.
 *  - `alt` is required at the SCHEMA level, i.e. on every write and not
 *    only at publish — byte-for-byte the same posture editorialBody.ts
 *    takes for the `image` block, and for the same reason. A gallery is
 *    pictures a reader is meant to look at; one with no alt text is
 *    invisible to a reader who cannot see it.
 *  - There is NO `caption`. The legacy source this capability preserves,
 *    website_news_posts.gallery_images, is a bare text[] of URLs carrying
 *    no caption and no alt of any kind. A caption field would be one that
 *    no existing content can fill and that no migration can populate
 *    honestly. Adding it later is purely additive.
 *
 * ─── LIMITS ──────────────────────────────────────────────────────────────
 *
 *   gallery  max 30 items   — the same ceiling editorialBody.ts puts on
 *                             image blocks (MAX_IMAGE_BLOCKS), because
 *                             these are the same kind of payload and every
 *                             one of them costs a live media check at
 *                             publish time.
 *   alt      1..200 chars   — identical to MAX_IMAGE_ALT_CHARS.
 *
 * URL shape is checked here only as far as "is a parseable URL"; the real
 * media trust boundary (HTTPS, host allowlist, DNS, redirects,
 * Content-Type) is editorialMediaUrl.ts, which does live network I/O and
 * therefore cannot live inside a synchronous zod schema. Gallery URLs go
 * through that SAME boundary as every other Editorial image — there is no
 * separate, weaker path for them.
 */
import { z } from "zod";
import { MAX_IMAGE_ALT_CHARS } from "./editorialBody";

export const MAX_GALLERY_ITEMS = 30;

const galleryItemSchema = z.object({
  url: z.string().url("A gallery item's url must be a valid URL."),
  alt: z
    .string()
    .trim()
    .min(1, "Every gallery image needs alt text.")
    .max(MAX_IMAGE_ALT_CHARS, `Gallery alt text cannot exceed ${MAX_IMAGE_ALT_CHARS} characters.`),
});

export const editorialGallerySchema = z.object({
  items: z
    .array(galleryItemSchema)
    .max(MAX_GALLERY_ITEMS, `A gallery cannot have more than ${MAX_GALLERY_ITEMS} images.`),
});

export type EditorialGalleryInput = z.infer<typeof editorialGallerySchema>;

/** The canonical empty gallery — the stored value, and migration 0129's DEFAULT. */
export const EMPTY_GALLERY: EditorialGalleryInput = { items: [] };

/**
 * Every media URL a gallery references, in display order.
 *
 * Deliberately NOT de-duplicated here: the caller
 * (validateEditorialMediaUrls) already de-duplicates across the whole
 * payload, and a gallery that legitimately repeats a URL is an editorial
 * choice, not an error.
 */
export function collectGalleryImageUrls(gallery: EditorialGalleryInput): string[] {
  return gallery.items.map((item) => item.url);
}

/**
 * Publish-time alt gate, mirroring editorialBody.ts's findBlocksMissingAlt.
 *
 * Separate from the schema so the publish transition can re-assert it over
 * a row ALREADY IN THE DATABASE — including one written before this module
 * existed, or one whose jsonb was edited out-of-band — rather than only
 * over an incoming payload. Returns the indexes of offending items.
 */
export function findGalleryItemsMissingAlt(
  gallery: { items: Array<Record<string, unknown>> } | null | undefined,
): number[] {
  const offending: number[] = [];
  const items = gallery?.items;
  if (!Array.isArray(items)) return offending;
  items.forEach((item, index) => {
    const alt = (item as Record<string, unknown>)["alt"];
    if (typeof alt !== "string" || alt.trim().length === 0) offending.push(index);
  });
  return offending;
}

/**
 * Read a stored gallery value defensively.
 *
 * The column is NOT NULL with a default, so in practice this always has a
 * value — but a revision snapshot taken before 0129 physically cannot
 * carry the key, and restore has to read that absence as "empty", which is
 * exactly what the column would have held at the time. One helper so every
 * reader spells that rule the same way.
 */
export function readStoredGallery(value: unknown): EditorialGalleryInput {
  if (value == null || typeof value !== "object") return { items: [] };
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return { items: [] };
  return { items: items as EditorialGalleryInput["items"] };
}
