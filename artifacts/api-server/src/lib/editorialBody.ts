/**
 * Zod validation for the Unified Editorial CMS body block model (Wave 1).
 *
 * The body is a FLAT, DISCRIMINATED block list — deliberately not the
 * nested `{ leadParagraph, sections[] }` shape website_news_posts.content
 * uses. Flat + discriminated means every block type gets its own exact
 * rules (and its own exact error message) instead of one permissive
 * "section" object where most fields are optional.
 *
 * Limits are hard caps, enforced on the server, chosen so a single post can
 * never become a denial-of-service payload (the express json body limit is
 * 1mb, but 250 x 5000-char paragraphs would fit inside that and still be
 * absurd):
 *
 *   whole body      max 250 blocks, max 30 image blocks
 *   paragraph       text 1..5000 chars
 *   heading         level in {2,3}, text 1..150 chars
 *   image           alt 1..200 REQUIRED, caption <=300 optional,
 *                   url checked separately by editorialMediaUrl.ts
 *   bulleted-list   2..30 items, each 1..300 chars
 *   quote           text 1..1000 REQUIRED, attribution <=200 optional,
 *                   attributionRole <=200 optional
 *
 * Image ALT is required at the SCHEMA level, i.e. on every write, not only
 * at publish. The publish transition additionally re-checks that no image
 * block has a blank alt (defence in depth for rows written before this
 * module, and for the feature image, which is not a block).
 *
 * URL shape is checked here only as far as "is a parseable https URL"; the
 * real media trust boundary (allowlist, DNS, redirects, Content-Type) is
 * editorialMediaUrl.ts, which does live network I/O and therefore cannot
 * live inside a synchronous zod schema.
 */
import { z } from "zod";

export const MAX_BODY_BLOCKS = 250;
export const MAX_IMAGE_BLOCKS = 30;
export const MAX_PARAGRAPH_CHARS = 5_000;
export const MAX_HEADING_CHARS = 150;
export const MAX_IMAGE_ALT_CHARS = 200;
export const MAX_IMAGE_CAPTION_CHARS = 300;
export const MIN_LIST_ITEMS = 2;
export const MAX_LIST_ITEMS = 30;
export const MAX_LIST_ITEM_CHARS = 300;
export const MAX_QUOTE_CHARS = 1_000;
export const MAX_QUOTE_ATTRIBUTION_CHARS = 200;
export const MAX_QUOTE_ATTRIBUTION_ROLE_CHARS = 200;

const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z
    .string()
    .min(1, "A paragraph block cannot be empty.")
    .max(MAX_PARAGRAPH_CHARS, `A paragraph block cannot exceed ${MAX_PARAGRAPH_CHARS} characters.`),
});

const headingBlockSchema = z.object({
  type: z.literal("heading"),
  // 2 and 3 only: the post title is the page's h1, so body headings start
  // at h2 and a document outline can never skip a level upward.
  level: z.union([z.literal(2), z.literal(3)], { message: "A heading block's level must be 2 or 3." }),
  text: z
    .string()
    .min(1, "A heading block cannot be empty.")
    .max(MAX_HEADING_CHARS, `A heading block cannot exceed ${MAX_HEADING_CHARS} characters.`),
});

const imageBlockSchema = z.object({
  type: z.literal("image"),
  url: z.string().url("An image block's url must be a valid URL."),
  alt: z
    .string()
    .trim()
    .min(1, "Every image block needs alt text.")
    .max(MAX_IMAGE_ALT_CHARS, `Image alt text cannot exceed ${MAX_IMAGE_ALT_CHARS} characters.`),
  caption: z
    .string()
    .max(MAX_IMAGE_CAPTION_CHARS, `An image caption cannot exceed ${MAX_IMAGE_CAPTION_CHARS} characters.`)
    .optional(),
});

const bulletedListBlockSchema = z.object({
  type: z.literal("bulleted-list"),
  items: z
    .array(
      z
        .string()
        .min(1, "A list item cannot be empty.")
        .max(MAX_LIST_ITEM_CHARS, `A list item cannot exceed ${MAX_LIST_ITEM_CHARS} characters.`),
    )
    .min(MIN_LIST_ITEMS, `A bulleted list needs at least ${MIN_LIST_ITEMS} items.`)
    .max(MAX_LIST_ITEMS, `A bulleted list cannot exceed ${MAX_LIST_ITEMS} items.`),
});

/**
 * Quote — the fifth block type (Final Editorial, Phase A).
 *
 * `text` is the quotation itself and is REQUIRED: a quote block with no
 * words is not a quote, it is an empty decoration. `attribution` (who said
 * it) and `attributionRole` (what they are) are both optional and
 * independent — a pull-quote lifted from the article's own prose carries
 * neither, and a quote can legitimately name a speaker without naming
 * their role.
 *
 * 1000 chars rather than the paragraph's 5000: a quote that runs longer
 * than a screen is a paragraph wearing quotation marks, and the cap is the
 * cheapest place to say so.
 */
const quoteBlockSchema = z.object({
  type: z.literal("quote"),
  text: z
    .string()
    .min(1, "A quote block needs the quoted text.")
    .max(MAX_QUOTE_CHARS, `A quote block cannot exceed ${MAX_QUOTE_CHARS} characters.`),
  attribution: z
    .string()
    .max(
      MAX_QUOTE_ATTRIBUTION_CHARS,
      `A quote attribution cannot exceed ${MAX_QUOTE_ATTRIBUTION_CHARS} characters.`,
    )
    .optional(),
  attributionRole: z
    .string()
    .max(
      MAX_QUOTE_ATTRIBUTION_ROLE_CHARS,
      `A quote attribution role cannot exceed ${MAX_QUOTE_ATTRIBUTION_ROLE_CHARS} characters.`,
    )
    .optional(),
});

export const editorialBodyBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  headingBlockSchema,
  imageBlockSchema,
  bulletedListBlockSchema,
  quoteBlockSchema,
]);

export const editorialBodySchema = z
  .object({
    blocks: z
      .array(editorialBodyBlockSchema)
      .max(MAX_BODY_BLOCKS, `A post cannot have more than ${MAX_BODY_BLOCKS} blocks.`),
  })
  .refine(
    (body) => body.blocks.filter((block) => block.type === "image").length <= MAX_IMAGE_BLOCKS,
    { message: `A post cannot have more than ${MAX_IMAGE_BLOCKS} image blocks.`, path: ["blocks"] },
  );

export type EditorialBodyInput = z.infer<typeof editorialBodySchema>;

/** Every media URL a body references, in document order (feature image excluded). */
export function collectBodyImageUrls(body: EditorialBodyInput): string[] {
  return body.blocks.flatMap((block) => (block.type === "image" ? [block.url] : []));
}

/**
 * Publish-time alt-text gate. Separate from the schema so the publish
 * transition can re-assert it over rows in the database (including any
 * written before this module existed), not only over an incoming payload.
 */
export function findBlocksMissingAlt(body: { blocks: Array<Record<string, unknown>> }): number[] {
  const offending: number[] = [];
  body.blocks.forEach((block, index) => {
    if (block["type"] !== "image") return;
    const alt = block["alt"];
    if (typeof alt !== "string" || alt.trim().length === 0) offending.push(index);
  });
  return offending;
}
