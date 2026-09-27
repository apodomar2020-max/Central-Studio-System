/**
 * editorial-post-gallery — the PURE half of the Post Editor's gallery
 * management (Final Editorial — Phase B).
 *
 * Pure: no React, no imports beyond types, matching `editorial-post-body.ts`
 * exactly. A file that imports React cannot be loaded by
 * `node --test --experimental-strip-types`, so everything a reviewer needs
 * pinned — the limits, the validation messages, the add/move/remove
 * semantics, and the fact that client-only keys never reach the wire —
 * lives here and is exercised by real behaviour tests.
 *
 * ─── WHAT A GALLERY IS ───────────────────────────────────────────────────
 *
 * A translation-scoped, ORDERED list of media items:
 *
 *   { items: [ { url, alt }, … ] }
 *
 * The array order IS the display order — there is no position field, for
 * the same reason `body.blocks` has none. Re-derived from
 * artifacts/api-server/src/lib/editorialGallery.ts and the generated
 * `EditorialGallery` contract, not assumed.
 *
 * `alt` is REQUIRED on every item, enforced server-side at the SCHEMA
 * level (on every write, not only at publish) and re-asserted over the
 * stored row by the publish gate. This module mirrors that so an operator
 * sees the problem while typing instead of losing an edit to a 400 — the
 * server stays authoritative.
 *
 * There is deliberately NO caption field. The legacy source this
 * capability preserves, `website_news_posts.galleryImages`, is a bare
 * array of URLs carrying no caption and no alt of any kind, so a caption
 * would be a field no existing content can fill. Nothing here should
 * pretend otherwise.
 *
 * ─── WHY CLIENT-ONLY KEYS EXIST ──────────────────────────────────────────
 *
 * A stored item is a bare `{ url, alt }` object: there is NO server-side
 * stable item id, exactly as there is none for a body block. React needs a
 * list key that survives reordering, so the editor mints a local `key` on
 * load and strips every one of them before a save. `toGalleryPayload` is
 * the single stripping point and is tested to leave no `key` behind.
 */

// Re-read from artifacts/api-server/src/lib/editorialGallery.ts. KEEP IN
// SYNC BY HAND; a test pins each constant against that file's source text,
// the same way editorial-post-body.ts's limits are pinned.
export const MAX_GALLERY_ITEMS = 30;
export const MAX_GALLERY_ALT_CHARS = 200;

export type StoredGalleryItem = { url: string; alt: string };
export interface StoredGallery {
  items: StoredGalleryItem[];
}

export type EditableGalleryItem = StoredGalleryItem & { key: string };

export const EMPTY_GALLERY: StoredGallery = { items: [] };

let keyCounter = 0;

/**
 * A local, non-persisted list key. Never sent anywhere: `toGalleryPayload`
 * strips it. Monotonic rather than random so a test can assert uniqueness
 * without stubbing a global.
 */
export function nextGalleryItemKey(): string {
  keyCounter += 1;
  return `gallery-${keyCounter}`;
}

export function createGalleryItem(): EditableGalleryItem {
  return { key: nextGalleryItemKey(), url: "", alt: "" };
}

/**
 * Read a stored gallery into editable items.
 *
 * Tolerates every shape a real payload can take: the key absent entirely
 * (a translation row written before migration 0129, or a revision snapshot
 * predating it), `items` missing, or `items` not an array. All three mean
 * "empty", which is exactly what the column would have held.
 */
export function toEditableGalleryItems(
  gallery: { items?: readonly unknown[] } | null | undefined,
): EditableGalleryItem[] {
  const items = gallery?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const record = (item ?? {}) as Partial<StoredGalleryItem>;
    return {
      key: nextGalleryItemKey(),
      url: typeof record.url === "string" ? record.url : "",
      alt: typeof record.alt === "string" ? record.alt : "",
    };
  });
}

// ─── Mutations — all pure, all return a NEW array ────────────────────────────

export function addGalleryItem(
  items: readonly EditableGalleryItem[],
): EditableGalleryItem[] {
  if (items.length >= MAX_GALLERY_ITEMS) return [...items];
  return [...items, createGalleryItem()];
}

export function removeGalleryItem(
  items: readonly EditableGalleryItem[],
  index: number,
): EditableGalleryItem[] {
  if (index < 0 || index >= items.length) return [...items];
  return items.filter((_, i) => i !== index);
}

export function moveGalleryItemUp(
  items: readonly EditableGalleryItem[],
  index: number,
): EditableGalleryItem[] {
  if (index <= 0 || index >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(index - 1, 0, moved!);
  return next;
}

export function moveGalleryItemDown(
  items: readonly EditableGalleryItem[],
  index: number,
): EditableGalleryItem[] {
  if (index < 0 || index >= items.length - 1) return [...items];
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(index + 1, 0, moved!);
  return next;
}

export function updateGalleryItem(
  items: readonly EditableGalleryItem[],
  index: number,
  patch: Partial<StoredGalleryItem>,
): EditableGalleryItem[] {
  if (index < 0 || index >= items.length) return [...items];
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

// ─── Caps ────────────────────────────────────────────────────────────────────

export function canAddGalleryItem(items: readonly unknown[]): boolean {
  return items.length < MAX_GALLERY_ITEMS;
}

export function galleryCapMessage(items: readonly unknown[]): string | null {
  if (items.length < MAX_GALLERY_ITEMS) return null;
  return `A gallery cannot have more than ${MAX_GALLERY_ITEMS} images.`;
}

// ─── Validation (advisory mirror of editorialGallery.ts) ─────────────────────

export interface GalleryProblem {
  index: number;
  field: "url" | "alt";
  message: string;
}

/**
 * Every message below is the SERVER's own wording, re-read from
 * artifacts/api-server/src/lib/editorialGallery.ts, so an operator never
 * sees one sentence here and a different one in the 400.
 */
export function validateGalleryItem(item: StoredGalleryItem, index: number): GalleryProblem[] {
  const problems: GalleryProblem[] = [];
  if (item.url.trim().length === 0) {
    problems.push({ index, field: "url", message: "A gallery item's url must be a valid URL." });
  }
  const alt = item.alt.trim();
  if (alt.length === 0) {
    problems.push({ index, field: "alt", message: "Every gallery image needs alt text." });
  } else if (alt.length > MAX_GALLERY_ALT_CHARS) {
    problems.push({
      index,
      field: "alt",
      message: `Gallery alt text cannot exceed ${MAX_GALLERY_ALT_CHARS} characters.`,
    });
  }
  return problems;
}

export function validateGallery(items: readonly EditableGalleryItem[]): GalleryProblem[] {
  return items.flatMap((item, index) => validateGalleryItem(stripGalleryKey(item), index));
}

export function problemsForGalleryItem(
  problems: readonly GalleryProblem[],
  index: number,
): GalleryProblem[] {
  return problems.filter((problem) => problem.index === index);
}

export function galleryProblemFor(
  problems: readonly GalleryProblem[],
  index: number,
  field: GalleryProblem["field"],
): string | undefined {
  return problems.find((problem) => problem.index === index && problem.field === field)?.message;
}

// ─── Payload ─────────────────────────────────────────────────────────────────

/** THE single stripping point. Nothing client-only may cross this line. */
export function stripGalleryKey(item: EditableGalleryItem | StoredGalleryItem): StoredGalleryItem {
  return { url: item.url.trim(), alt: item.alt.trim() };
}

export function toGalleryPayload(items: readonly EditableGalleryItem[]): StoredGallery {
  return { items: items.map(stripGalleryKey) };
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function galleryFieldId(key: string, field: string): string {
  return `gallery-${key}-${field}`;
}

export function galleryMoveUpLabel(index: number): string {
  return `Move gallery image ${index + 1} up`;
}

export function galleryMoveDownLabel(index: number): string {
  return `Move gallery image ${index + 1} down`;
}

export function galleryDeleteLabel(index: number): string {
  return `Remove gallery image ${index + 1}`;
}

export const GALLERY_EMPTY_STATE =
  "No gallery images. A gallery is shown alongside the article, not inside its body — add one only when the story genuinely has a set of pictures to show.";

export const GALLERY_ALT_HELP =
  "Alt text is required on every gallery image, on every save — not only when publishing. Describe what the picture shows for a reader who cannot see it.";

export const GALLERY_ORDER_HELP =
  "The order here is the order readers see. Use the move buttons; there is no drag handle, so the order is reachable by keyboard.";

/**
 * Stated because it is true and is otherwise a surprise: gallery URLs cross
 * the SAME media trust boundary as every other Editorial image (HTTPS, host
 * allowlist, DNS, redirect following, Content-Type), and that check is live
 * network I/O the client deliberately does not guess at.
 */
export const GALLERY_MEDIA_NOTE =
  "Gallery links are checked the same way every other Editorial image link is — the check runs on the server when you save.";
