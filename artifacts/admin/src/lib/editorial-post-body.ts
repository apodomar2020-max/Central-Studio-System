/**
 * editorial-post-body — the block-model editing logic behind the Post
 * Editor's body canvas (Wave 2.1D).
 *
 * Pure: no React, no imports, no `import.meta.env`, matching
 * `lib/editorial-authors.ts` and `lib/editorial-topics.ts`. Everything a
 * reviewer needs pinned — the limits, the per-type validation messages, the
 * add/move/remove semantics, and the fact that client-only keys never reach
 * the wire — is exercised by real `node --test` behaviour tests rather than
 * source regexes.
 *
 * ─── WHY CLIENT-ONLY KEYS EXIST ──────────────────────────────────────────
 *
 * A stored block is a bare discriminated-union object:
 *   { type: "paragraph", text }
 *   { type: "heading", level: 2|3, text }
 *   { type: "image", url, alt, caption? }
 *   { type: "bulleted-list", items: string[] }
 * Verified against artifacts/api-server/src/lib/editorialBody.ts and the
 * generated schemas: there is NO server-side stable block id. React needs a
 * stable list key that survives reordering, so the editor mints a local
 * `key` on load and strips every one of them before a save. `toBodyPayload`
 * is the single stripping point and is tested to leave no `key` behind.
 *
 * ─── LIMITS ──────────────────────────────────────────────────────────────
 *
 * Re-read from artifacts/api-server/src/lib/editorialBody.ts (the domain
 * schema the routes re-validate through) on 2026-09-20. KEEP IN SYNC BY
 * HAND; a test pins each constant against that file's source text.
 *
 * The server stays authoritative. These checks exist so an operator sees a
 * counter turn red while typing instead of losing a long edit to a 400.
 *
 * ─── ADDING A FIFTH BLOCK TYPE (D1) ──────────────────────────────────────
 *
 * Quote is deliberately NOT implemented in this wave. The architecture is
 * shaped so adding it is additive: append the type to
 * `EditorialBlockType`, add one entry to `BLOCK_TYPE_DEFINITIONS` (label +
 * factory + validator), and the toolbar, counters, validation sweep and
 * payload stripper all pick it up with no further edits.
 */

export const MAX_BODY_BLOCKS = 250;
export const MAX_IMAGE_BLOCKS = 30;
export const MAX_PARAGRAPH_CHARS = 5_000;
export const MAX_HEADING_CHARS = 150;
export const MAX_IMAGE_ALT_CHARS = 200;
export const MAX_IMAGE_CAPTION_CHARS = 300;
export const MIN_LIST_ITEMS = 2;
export const MAX_LIST_ITEMS = 30;
export const MAX_LIST_ITEM_CHARS = 300;

export type EditorialBlockType = "paragraph" | "heading" | "image" | "bulleted-list";

export type StoredParagraphBlock = { type: "paragraph"; text: string };
export type StoredHeadingBlock = { type: "heading"; level: 2 | 3; text: string };
export type StoredImageBlock = { type: "image"; url: string; alt: string; caption?: string };
export type StoredListBlock = { type: "bulleted-list"; items: string[] };

export type StoredBlock =
  | StoredParagraphBlock
  | StoredHeadingBlock
  | StoredImageBlock
  | StoredListBlock;

export interface StoredBody {
  blocks: StoredBlock[];
}

/** A block as the editor holds it: the stored shape plus a local React key. */
export type EditableBlock = StoredBlock & { key: string };

// ─── Local keys ──────────────────────────────────────────────────────────────

let keyCounter = 0;

/**
 * Mint a client-only key. Monotonic rather than random so a test can assert
 * uniqueness deterministically, and so two blocks created in the same tick
 * can never collide (Date.now() alone can).
 */
export function nextBlockKey(): string {
  keyCounter += 1;
  return `blk-${keyCounter}`;
}

// ─── Block factories ─────────────────────────────────────────────────────────

export function createBlock(type: EditorialBlockType): EditableBlock {
  const key = nextBlockKey();
  switch (type) {
    case "paragraph":
      return { key, type: "paragraph", text: "" };
    case "heading":
      // h2 by default: the post title is the page's h1, so the body's first
      // level down is h2 and an outline can never skip upward.
      return { key, type: "heading", level: 2, text: "" };
    case "image":
      return { key, type: "image", url: "", alt: "", caption: "" };
    case "bulleted-list":
      // Seeded with MIN_LIST_ITEMS empty rows: a one-item list is invalid
      // server-side, so starting below the minimum would be a trap.
      return { key, type: "bulleted-list", items: Array.from({ length: MIN_LIST_ITEMS }, () => "") };
  }
}

export interface BlockTypeDefinition {
  type: EditorialBlockType;
  /** Toolbar button label. */
  label: string;
  /** Human name used in validation messages and aria labels. */
  noun: string;
}

/** Document order of the insert toolbar. Extend here to add a 5th type. */
export const BLOCK_TYPE_DEFINITIONS: ReadonlyArray<BlockTypeDefinition> = [
  { type: "paragraph", label: "Add paragraph", noun: "Paragraph" },
  { type: "heading", label: "Add heading", noun: "Heading" },
  { type: "image", label: "Add image", noun: "Image" },
  { type: "bulleted-list", label: "Add list", noun: "Bulleted list" },
];

export function blockNoun(type: EditorialBlockType): string {
  return BLOCK_TYPE_DEFINITIONS.find((definition) => definition.type === type)?.noun ?? type;
}

// ─── Loading ─────────────────────────────────────────────────────────────────

/**
 * Adopt a stored body into editable blocks, minting one key per block.
 * Unknown block types (a body written by a future wave) are preserved
 * verbatim rather than dropped — losing an operator's content because this
 * build does not recognise it would be far worse than rendering it read-only.
 */
export function toEditableBlocks(body: { blocks?: readonly unknown[] } | null | undefined): EditableBlock[] {
  const blocks = body?.blocks ?? [];
  return blocks.map((block) => ({ ...(block as StoredBlock), key: nextBlockKey() }));
}

// ─── Mutations (all pure — they return a new array) ──────────────────────────

export function addBlock(
  blocks: readonly EditableBlock[],
  type: EditorialBlockType,
  atIndex?: number,
): EditableBlock[] {
  const next = [...blocks];
  const block = createBlock(type);
  const index = atIndex == null ? next.length : Math.max(0, Math.min(atIndex, next.length));
  next.splice(index, 0, block);
  return next;
}

export function removeBlock(blocks: readonly EditableBlock[], index: number): EditableBlock[] {
  if (index < 0 || index >= blocks.length) return [...blocks];
  return blocks.filter((_, i) => i !== index);
}

export function moveBlockUp(blocks: readonly EditableBlock[], index: number): EditableBlock[] {
  if (index <= 0 || index >= blocks.length) return [...blocks];
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  next.splice(index - 1, 0, moved!);
  return next;
}

export function moveBlockDown(blocks: readonly EditableBlock[], index: number): EditableBlock[] {
  if (index < 0 || index >= blocks.length - 1) return [...blocks];
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  next.splice(index + 1, 0, moved!);
  return next;
}

export function updateBlock(
  blocks: readonly EditableBlock[],
  index: number,
  patch: Partial<StoredBlock>,
): EditableBlock[] {
  return blocks.map((block, i) => (i === index ? ({ ...block, ...patch } as EditableBlock) : block));
}

export function addListItem(blocks: readonly EditableBlock[], index: number): EditableBlock[] {
  return blocks.map((block, i) => {
    if (i !== index || block.type !== "bulleted-list") return block;
    if (block.items.length >= MAX_LIST_ITEMS) return block;
    return { ...block, items: [...block.items, ""] };
  });
}

export function removeListItem(
  blocks: readonly EditableBlock[],
  index: number,
  itemIndex: number,
): EditableBlock[] {
  return blocks.map((block, i) => {
    if (i !== index || block.type !== "bulleted-list") return block;
    // Never fall below the server minimum from the UI — the remove control
    // is disabled at the floor, and this is the second line of defence.
    if (block.items.length <= MIN_LIST_ITEMS) return block;
    return { ...block, items: block.items.filter((_, j) => j !== itemIndex) };
  });
}

export function setListItem(
  blocks: readonly EditableBlock[],
  index: number,
  itemIndex: number,
  value: string,
): EditableBlock[] {
  return blocks.map((block, i) => {
    if (i !== index || block.type !== "bulleted-list") return block;
    return { ...block, items: block.items.map((item, j) => (j === itemIndex ? value : item)) };
  });
}

// ─── Counters / caps ─────────────────────────────────────────────────────────

export function countImageBlocks(blocks: readonly { type: string }[]): number {
  return blocks.filter((block) => block.type === "image").length;
}

/** Can another block of this type be inserted without breaking a hard cap? */
export function canAddBlock(
  blocks: readonly { type: string }[],
  type: EditorialBlockType,
): boolean {
  if (blocks.length >= MAX_BODY_BLOCKS) return false;
  if (type === "image" && countImageBlocks(blocks) >= MAX_IMAGE_BLOCKS) return false;
  return true;
}

export function blockCapMessage(blocks: readonly { type: string }[]): string | null {
  if (blocks.length >= MAX_BODY_BLOCKS) {
    return `A post cannot have more than ${MAX_BODY_BLOCKS} blocks.`;
  }
  if (countImageBlocks(blocks) >= MAX_IMAGE_BLOCKS) {
    return `A post cannot have more than ${MAX_IMAGE_BLOCKS} image blocks.`;
  }
  return null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface BlockProblem {
  /** Index of the offending block in the current list. */
  index: number;
  /** Which sub-field, when the block has several. */
  field: "text" | "level" | "url" | "alt" | "caption" | "items";
  message: string;
}

/**
 * One block's problems, using the SERVER's own messages verbatim wherever
 * the server has one (editorialBody.ts), so the inline hint and the 400 an
 * operator might still see cannot say two different things.
 */
export function validateBlock(block: StoredBlock, index: number): BlockProblem[] {
  const problems: BlockProblem[] = [];
  const at = (field: BlockProblem["field"], message: string) =>
    problems.push({ index, field, message });

  switch (block.type) {
    case "paragraph": {
      if (block.text.length === 0) at("text", "A paragraph block cannot be empty.");
      else if (block.text.length > MAX_PARAGRAPH_CHARS) {
        at("text", `A paragraph block cannot exceed ${MAX_PARAGRAPH_CHARS} characters.`);
      }
      break;
    }
    case "heading": {
      if (block.level !== 2 && block.level !== 3) {
        at("level", "A heading block's level must be 2 or 3.");
      }
      if (block.text.length === 0) at("text", "A heading block cannot be empty.");
      else if (block.text.length > MAX_HEADING_CHARS) {
        at("text", `A heading block cannot exceed ${MAX_HEADING_CHARS} characters.`);
      }
      break;
    }
    case "image": {
      if (block.url.trim().length === 0) {
        at("url", "An image block's url must be a valid URL.");
      } else {
        // Cheap shape check only. The host allowlist, DNS and content-type
        // checks are the SERVER's trust boundary (editorialMediaUrl.ts) and
        // are deliberately not replicated here.
        let parsed: URL | null = null;
        try {
          parsed = new URL(block.url.trim());
        } catch {
          parsed = null;
        }
        if (!parsed) at("url", "An image block's url must be a valid URL.");
        else if (parsed.protocol !== "https:") at("url", "The link must start with https://");
      }
      // Alt is required at the SCHEMA level — on every write, not only at
      // publish (editorialBody.ts: imageBlockSchema.alt.min(1)).
      if (block.alt.trim().length === 0) at("alt", "Every image block needs alt text.");
      else if (block.alt.trim().length > MAX_IMAGE_ALT_CHARS) {
        at("alt", `Image alt text cannot exceed ${MAX_IMAGE_ALT_CHARS} characters.`);
      }
      if ((block.caption ?? "").length > MAX_IMAGE_CAPTION_CHARS) {
        at("caption", `An image caption cannot exceed ${MAX_IMAGE_CAPTION_CHARS} characters.`);
      }
      break;
    }
    case "bulleted-list": {
      if (block.items.length < MIN_LIST_ITEMS) {
        at("items", `A bulleted list needs at least ${MIN_LIST_ITEMS} items.`);
      } else if (block.items.length > MAX_LIST_ITEMS) {
        at("items", `A bulleted list cannot exceed ${MAX_LIST_ITEMS} items.`);
      }
      for (const item of block.items) {
        if (item.length === 0) {
          at("items", "A list item cannot be empty.");
          break;
        }
        if (item.length > MAX_LIST_ITEM_CHARS) {
          at("items", `A list item cannot exceed ${MAX_LIST_ITEM_CHARS} characters.`);
          break;
        }
      }
      break;
    }
  }
  return problems;
}

/** Every problem across the whole body, including the two whole-body caps. */
export function validateBody(blocks: readonly EditableBlock[]): BlockProblem[] {
  const problems: BlockProblem[] = [];
  blocks.forEach((block, index) => problems.push(...validateBlock(stripKey(block), index)));
  if (blocks.length > MAX_BODY_BLOCKS) {
    problems.push({ index: -1, field: "items", message: `A post cannot have more than ${MAX_BODY_BLOCKS} blocks.` });
  }
  if (countImageBlocks(blocks) > MAX_IMAGE_BLOCKS) {
    problems.push({ index: -1, field: "items", message: `A post cannot have more than ${MAX_IMAGE_BLOCKS} image blocks.` });
  }
  return problems;
}

export function problemsForBlock(problems: readonly BlockProblem[], index: number): BlockProblem[] {
  return problems.filter((problem) => problem.index === index);
}

export function problemFor(
  problems: readonly BlockProblem[],
  index: number,
  field: BlockProblem["field"],
): string | undefined {
  return problems.find((problem) => problem.index === index && problem.field === field)?.message;
}

// ─── Payload ─────────────────────────────────────────────────────────────────

/**
 * THE SINGLE STRIPPING POINT. Every save path goes through here, so a
 * client-only `key` can never reach the API. Optional `caption` is omitted
 * entirely when blank rather than sent as "" — the generated schema types it
 * `.optional()`, and an empty string would store noise.
 */
export function stripKey(block: EditableBlock | StoredBlock): StoredBlock {
  const clone = { ...(block as EditableBlock) } as Partial<EditableBlock>;
  delete clone.key;
  if (clone.type === "image") {
    const image = clone as unknown as StoredImageBlock;
    const caption = (image.caption ?? "").trim();
    const stripped: StoredImageBlock = {
      type: "image",
      url: image.url.trim(),
      alt: image.alt.trim(),
    };
    if (caption.length > 0) stripped.caption = caption;
    return stripped;
  }
  return clone as StoredBlock;
}

export function toBodyPayload(blocks: readonly EditableBlock[]): StoredBody {
  return { blocks: blocks.map((block) => stripKey(block)) };
}

// ─── Focus management ────────────────────────────────────────────────────────

/**
 * Where focus should land after a delete: the block that took the deleted
 * one's place, else the new last block, else `null` meaning "the insert
 * toolbar" (the list is now empty).
 */
export function focusIndexAfterDelete(
  removedIndex: number,
  remainingCount: number,
): number | null {
  if (remainingCount === 0) return null;
  if (removedIndex >= remainingCount) return remainingCount - 1;
  return removedIndex;
}

/** The DOM id of a block's first editable field — the add/move focus target. */
export function blockFieldId(key: string, field: string): string {
  return `block-${key}-${field}`;
}

export function firstFieldOf(type: EditorialBlockType): string {
  return type === "image" ? "url" : type === "bulleted-list" ? "item-0" : "text";
}

export function moveUpLabel(index: number, type: EditorialBlockType): string {
  return `Move ${blockNoun(type).toLowerCase()} block ${index + 1} up`;
}

export function moveDownLabel(index: number, type: EditorialBlockType): string {
  return `Move ${blockNoun(type).toLowerCase()} block ${index + 1} down`;
}

export function deleteLabel(index: number, type: EditorialBlockType): string {
  return `Delete ${blockNoun(type).toLowerCase()} block ${index + 1}`;
}
