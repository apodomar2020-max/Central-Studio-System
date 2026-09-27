/**
 * The News → Editorial migration MANIFEST — Final Editorial, Phase B.
 *
 * ─── WHAT A MANIFEST IS ──────────────────────────────────────────────────
 *
 * A manifest is the file in which a HUMAN records every decision the
 * migration is not allowed to make on its own. It is an input, never an
 * output: the tool never writes one, never amends one, and never infers a
 * missing entry.
 *
 * ─── WHY IT EXISTS: THE FAIL-CLOSED RULE ─────────────────────────────────
 *
 * website_news_posts stores a byline as three denormalized strings
 * (author_name, author_role, author_avatar_url). editorial_authors is a
 * first-class entity with its own id, channel, biography and status. There
 * is NO mechanical function from one to the other:
 *
 *   * the same person appears under DIFFERENT roles across source rows
 *     ("Victoria Vance / Artistic Director" and "Victoria Vance /
 *     Principal Dancer"), and only a human knows whether those are one
 *     author row or two;
 *   * an editorial author needs a BIOGRAPHY before any translation can be
 *     published, and the legacy model has no biography field at all, so a
 *     biography can only ever come from a person;
 *   * legacy tags are free text and editorial topics are a curated,
 *     channel-scoped taxonomy with slugs.
 *
 * The tempting answer to all three is fuzzy matching — normalize the name,
 * compare, pick the best score. This tool does NOT do that, anywhere, at
 * any confidence threshold. A byline is an attribution claim about a real
 * person; a wrong one is a published falsehood, and a similarity score is
 * not evidence. The same logic forbids inventing alt text from a title:
 * alt text is a description of an image, and a title is not a description
 * of an image.
 *
 * So the rule is FAIL CLOSED, in exactly one direction: anything the
 * manifest does not explicitly decide is an UNRESOLVED item, unresolved
 * items are reported by name, and `execute` REFUSES TO RUN while any
 * remain. There is no "best effort", no partial import that leaves
 * fabricated data behind for someone to find later, and no flag that
 * downgrades a blocker to a warning.
 *
 * ─── WHY IDENTITY IS THE (name, role) PAIR ───────────────────────────────
 *
 * Author entries are keyed by the source's name AND role together, not by
 * name alone. Keying by name alone would silently collapse "Victoria Vance
 * / Artistic Director" and "Victoria Vance / Principal Dancer" into one
 * mapping and quietly attribute both sets of articles to whichever author
 * row happened to be listed — which is the exact fuzzy-matching failure
 * this module exists to prevent, merely spelled with an exact-match
 * comparison. With pair keying, a human who genuinely means "these are the
 * same author" says so by pointing both pairs at the same
 * editorialAuthorId, and that decision is recorded and reviewable.
 *
 * ─── STRICTNESS ──────────────────────────────────────────────────────────
 *
 * Every object is `.strict()`. A manifest with a misspelled key
 * ("editorialAuthorID", "sourceTags") is REJECTED rather than silently
 * treated as an absent decision — a typo in a decision file must not
 * degrade into an unrecorded blocker, and a rejected manifest is a far
 * cheaper failure than a mis-attributed byline.
 */
import { z } from "zod";

/** Bumped only when the manifest's SHAPE changes incompatibly. */
export const NEWS_MIGRATION_MANIFEST_VERSION = 1;

/**
 * The only source table this tool will ever read. Declared IN the manifest
 * and checked against this constant, so a manifest cannot be pointed at a
 * different table by editing one string — notably not at
 * `website_performances`, which Phase B must not touch in any way.
 */
export const NEWS_MIGRATION_SOURCE_TABLE = "website_news_posts";

/**
 * The only channel this tool will ever write. Editorial's channel
 * invariant (post.channel === author.channel === topic.channel ===
 * placement.channel, and recommendations never cross channels) is the
 * spine of the unified model; a migration that could target a channel by
 * configuration would be a way to break it from a config file.
 */
export const NEWS_MIGRATION_TARGET_CHANNEL = "news";

const nonBlank = (label: string) =>
  z.string().trim().min(1, `${label} cannot be blank.`);

/**
 * ONE legacy byline → ONE editorial author.
 *
 * `sourceName` + `sourceRole` are matched EXACTLY (after trimming) against
 * the legacy row's author_name / author_role. No normalization beyond
 * trimming: case, punctuation and diacritics are part of a person's name,
 * and folding them is fuzzy matching under another name.
 */
export const manifestAuthorEntrySchema = z
  .object({
    sourceName: nonBlank("An author entry's sourceName"),
    sourceRole: nonBlank("An author entry's sourceRole"),
    /**
     * An EXISTING editorial_authors row. The migration never creates an
     * author: an author needs a biography to be publishable, a biography
     * cannot be derived from anything in the legacy model, and a tool that
     * created biography-less authors would produce posts that can never be
     * published — silent breakage discovered much later.
     */
    editorialAuthorId: z.number().int().positive(),
    /** Free-text note for the reviewer. Recorded, never interpreted. */
    note: z.string().optional(),
  })
  .strict();

/**
 * ONE legacy tag → ONE editorial topic, or an explicit decision to drop it.
 *
 * `skip: true` is a DECISION, not an absence. A tag nobody has decided
 * about blocks; a tag someone has decided to drop is recorded as dropped
 * and reported in the migration's own output, so "where did that tag go?"
 * has an answer in the manifest rather than in someone's memory.
 */
export const manifestTopicEntrySchema = z
  .object({
    sourceTag: nonBlank("A topic entry's sourceTag"),
    editorialTopicId: z.number().int().positive().nullable().optional(),
    skip: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine(
    (entry) => (entry.skip === true) !== (entry.editorialTopicId != null),
    {
      message:
        "A topic entry must either map to exactly one editorialTopicId or set skip: true — never both, and never neither.",
    },
  );

/**
 * Alt text for ONE gallery image of ONE source row.
 *
 * Keyed by (sourceSlug, index) because the legacy gallery is a bare
 * text[]: the position in that array is the only identity an item has.
 * Every item needs an entry, because `alt` is REQUIRED on the editorial
 * gallery and there is no honest way to derive it — the legacy model
 * carries no caption and no alt of any kind. Deriving alt from the article
 * title would describe the article, not the picture, to precisely the
 * readers who cannot check.
 */
export const manifestGalleryAltEntrySchema = z
  .object({
    sourceSlug: nonBlank("A gallery alt entry's sourceSlug"),
    index: z.number().int().min(0),
    alt: nonBlank("A gallery alt entry's alt text").max(
      200,
      "Gallery alt text cannot exceed 200 characters.",
    ),
  })
  .strict();

/**
 * Alt text for ONE source row's HERO image, which becomes the editorial
 * post's feature image. Same reasoning as gallery alt: required by
 * Editorial, absent from the legacy model, un-derivable.
 */
export const manifestFeatureAltEntrySchema = z
  .object({
    sourceSlug: nonBlank("A feature alt entry's sourceSlug"),
    alt: nonBlank("A feature alt entry's alt text").max(
      200,
      "Feature image alt text cannot exceed 200 characters.",
    ),
  })
  .strict();

/**
 * Alt text for ONE in-article image of ONE source row, keyed by the
 * SECTION index that carries it (a legacy section holds at most one
 * `image`, so the section index identifies it).
 *
 * Needed for the same reason as the other two, plus one of its own: the
 * legacy section has an `imageCaption`, and reusing that caption as alt
 * text is the single most tempting shortcut here. It is refused. A caption
 * and alt text are written for different readers and answer different
 * questions — a caption says what is interesting about the picture to
 * someone who can already see it ("Clara Dupont during her winning
 * classical solo"), while alt text must say what is IN the picture to
 * someone who cannot. Copying one into the other silently gives
 * screen-reader users a worse experience while making the accessibility
 * gate report success. The caption is carried across faithfully as the
 * image block's own `caption`; the alt is a human decision.
 */
export const manifestBodyImageAltEntrySchema = z
  .object({
    sourceSlug: nonBlank("A body image alt entry's sourceSlug"),
    sectionIndex: z.number().int().min(0),
    alt: nonBlank("A body image alt entry's alt text").max(
      200,
      "Body image alt text cannot exceed 200 characters.",
    ),
  })
  .strict();

/**
 * An operator-chosen slug for ONE source row.
 *
 * The ONLY way a migrated translation gets a slug other than the legacy
 * one. See newsMigrationPlanner.ts: an unrelated existing post already
 * holding the legacy slug is a BLOCK, and this is how a human resolves it
 * — by deciding the new slug, in writing, in advance. The tool never
 * auto-suffixes ("-2"), because a public URL is a promise and a
 * machine-chosen URL is nobody's decision.
 */
export const manifestSlugOverrideSchema = z
  .object({
    sourceSlug: nonBlank("A slug override's sourceSlug"),
    slug: nonBlank("A slug override's slug").regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "A slug override must be lowercase alphanumeric words separated by single hyphens.",
    ),
    note: z.string().optional(),
  })
  .strict();

/**
 * `is_featured` → an editorial PLACEMENT slot.
 *
 * Editorial has no per-post boolean: curation is named, ordered slots.
 * Which slot the legacy flag means is an editorial decision, so it is
 * declared here rather than hardcoded. `position` is assigned by the tool
 * from the source rows' own publishedAt ordering (newest first), which is
 * the only ordering the legacy model actually contains — `is_featured`
 * carries no rank of its own.
 */
export const manifestPlacementSchema = z
  .object({
    placementKey: nonBlank("The placement key").max(64),
    note: z.string().optional(),
  })
  .strict();

export const newsMigrationManifestSchema = z
  .object({
    manifestVersion: z.literal(NEWS_MIGRATION_MANIFEST_VERSION),
    /** Pinned. See NEWS_MIGRATION_SOURCE_TABLE. */
    sourceTable: z.literal(NEWS_MIGRATION_SOURCE_TABLE),
    /** Pinned. See NEWS_MIGRATION_TARGET_CHANNEL. */
    targetChannel: z.literal(NEWS_MIGRATION_TARGET_CHANNEL),
    /**
     * The editorial language the legacy content IS. Declared, never
     * guessed: no language detection, because detecting a language from
     * prose is exactly the kind of probabilistic inference this manifest
     * exists to keep out of the migration.
     */
    languageCode: nonBlank("languageCode"),
    authors: z.array(manifestAuthorEntrySchema),
    topics: z.array(manifestTopicEntrySchema),
    featuredPlacement: manifestPlacementSchema.nullable().optional(),
    featureImageAlt: z.array(manifestFeatureAltEntrySchema).optional(),
    bodyImageAlt: z.array(manifestBodyImageAltEntrySchema).optional(),
    galleryAlt: z.array(manifestGalleryAltEntrySchema).optional(),
    slugOverrides: z.array(manifestSlugOverrideSchema).optional(),
  })
  .strict();

export type NewsMigrationManifest = z.infer<typeof newsMigrationManifestSchema>;
export type ManifestAuthorEntry = z.infer<typeof manifestAuthorEntrySchema>;
export type ManifestTopicEntry = z.infer<typeof manifestTopicEntrySchema>;

/** A manifest that parsed, but whose own internal rules are violated. */
export class ManifestError extends Error {}

/** The exact-match key for an author decision. See the header. */
export function authorKey(name: string, role: string): string {
  return `${name.trim()} ${role.trim()}`;
}

/** The exact-match key for a gallery alt decision. */
export function galleryAltKey(sourceSlug: string, index: number): string {
  return `${sourceSlug.trim()} ${index}`;
}

/** Tags are compared case-INSENSITIVELY; see resolveTopicDecision. */
export function topicKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Parse and self-check a manifest.
 *
 * Two layers, deliberately separate:
 *   1. zod — SHAPE. Strict objects, so an unknown key is an error.
 *   2. this function — INTERNAL CONSISTENCY, which zod cannot express:
 *      duplicate decisions about the same thing.
 *
 * A duplicate is always an ERROR and never "last one wins". Two entries
 * for one author pair means two people wrote down two different answers,
 * or one person changed their mind and left both; silently honouring
 * whichever sorts last would pick a byline by file order.
 */
export function parseNewsMigrationManifest(raw: unknown): NewsMigrationManifest {
  const parsed = newsMigrationManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    throw new ManifestError(
      `Manifest is not valid${path ? ` at "${path}"` : ""}: ${issue?.message ?? "unknown error"}`,
    );
  }
  const manifest = parsed.data;

  assertNoDuplicates(
    manifest.authors.map((entry) => authorKey(entry.sourceName, entry.sourceRole)),
    (key) => `Duplicate author decision for "${key.replace(" ", " / ")}".`,
  );
  assertNoDuplicates(
    manifest.topics.map((entry) => topicKey(entry.sourceTag)),
    (key) => `Duplicate topic decision for tag "${key}".`,
  );
  assertNoDuplicates(
    (manifest.galleryAlt ?? []).map((entry) => galleryAltKey(entry.sourceSlug, entry.index)),
    (key) => {
      const [slug, index] = key.split(" ");
      return `Duplicate gallery alt decision for "${slug}" image ${Number(index) + 1}.`;
    },
  );
  assertNoDuplicates(
    (manifest.featureImageAlt ?? []).map((entry) => entry.sourceSlug.trim()),
    (key) => `Duplicate feature image alt decision for "${key}".`,
  );
  assertNoDuplicates(
    (manifest.bodyImageAlt ?? []).map((entry) => galleryAltKey(entry.sourceSlug, entry.sectionIndex)),
    (key) => {
      const [slug, index] = key.split(" ");
      return `Duplicate body image alt decision for "${slug}" section ${Number(index) + 1}.`;
    },
  );
  assertNoDuplicates(
    (manifest.slugOverrides ?? []).map((entry) => entry.sourceSlug.trim()),
    (key) => `Duplicate slug override for "${key}".`,
  );
  /**
   * Two source rows may NOT be redirected onto one slug. A slug is a
   * public URL and a URL identifies one article; letting two overrides
   * collide would push the failure down into the database's per-language
   * slug uniqueness, where it would surface as a mid-run constraint error
   * rather than a refused manifest.
   */
  assertNoDuplicates(
    (manifest.slugOverrides ?? []).map((entry) => entry.slug.trim()),
    (key) => `Two slug overrides both target the slug "${key}".`,
  );

  return manifest;
}

function assertNoDuplicates(keys: string[], message: (key: string) => string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new ManifestError(message(key));
    seen.add(key);
  }
}

/**
 * The manifest's decision about ONE legacy tag.
 *
 * Case-insensitive on purpose, and ONLY here: legacy tags are free text
 * typed by hand over years, so "Backstage" and "backstage" are the same
 * editorial concept and demanding two identical entries would be
 * busywork that invites a copy-paste mistake. Author names get no such
 * folding — a tag is a label, a name is a person.
 */
export function resolveTopicDecision(
  manifest: NewsMigrationManifest,
  tag: string,
): { kind: "mapped"; topicId: number } | { kind: "skipped" } | { kind: "unresolved" } {
  const entry = manifest.topics.find((candidate) => topicKey(candidate.sourceTag) === topicKey(tag));
  if (!entry) return { kind: "unresolved" };
  if (entry.skip === true) return { kind: "skipped" };
  return { kind: "mapped", topicId: entry.editorialTopicId! };
}

/** The manifest's decision about ONE legacy byline, or nothing. */
export function resolveAuthorDecision(
  manifest: NewsMigrationManifest,
  name: string,
  role: string,
): ManifestAuthorEntry | null {
  const key = authorKey(name, role);
  return (
    manifest.authors.find((entry) => authorKey(entry.sourceName, entry.sourceRole) === key) ?? null
  );
}

export function resolveGalleryAlt(
  manifest: NewsMigrationManifest,
  sourceSlug: string,
  index: number,
): string | null {
  const key = galleryAltKey(sourceSlug, index);
  const entry = (manifest.galleryAlt ?? []).find(
    (candidate) => galleryAltKey(candidate.sourceSlug, candidate.index) === key,
  );
  return entry ? entry.alt.trim() : null;
}

export function resolveFeatureImageAlt(
  manifest: NewsMigrationManifest,
  sourceSlug: string,
): string | null {
  const entry = (manifest.featureImageAlt ?? []).find(
    (candidate) => candidate.sourceSlug.trim() === sourceSlug.trim(),
  );
  return entry ? entry.alt.trim() : null;
}

export function resolveBodyImageAlt(
  manifest: NewsMigrationManifest,
  sourceSlug: string,
  sectionIndex: number,
): string | null {
  const key = galleryAltKey(sourceSlug, sectionIndex);
  const entry = (manifest.bodyImageAlt ?? []).find(
    (candidate) => galleryAltKey(candidate.sourceSlug, candidate.sectionIndex) === key,
  );
  return entry ? entry.alt.trim() : null;
}

export function resolveSlugOverride(
  manifest: NewsMigrationManifest,
  sourceSlug: string,
): string | null {
  const entry = (manifest.slugOverrides ?? []).find(
    (candidate) => candidate.sourceSlug.trim() === sourceSlug.trim(),
  );
  return entry ? entry.slug.trim() : null;
}
