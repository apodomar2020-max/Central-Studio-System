/**
 * News → Editorial migration PLANNER — Final Editorial, Phase B.
 *
 * READ-ONLY. This module issues SELECTs and nothing else. It is the entire
 * body of `dry-run`, and it is also the FIRST thing `execute` and `verify`
 * run — so an execute can only ever write a plan a dry-run would have
 * printed, and a verify checks reality against the same computation that
 * produced it. There is no second, "real" planning path.
 *
 * ─── WHAT A PLAN CONTAINS ────────────────────────────────────────────────
 *
 * One entry per legacy row, each in exactly one state:
 *
 *   create   — no Editorial post carries this row's provenance yet.
 *   skip     — a post already carries it and matches the mapping exactly.
 *              This is what makes the tool idempotent: a re-run of a
 *              completed migration is all-skips and writes nothing.
 *   blocked  — something only a human can decide is undecided, or the
 *              already-migrated post has DRIFTED from the mapping.
 *
 * `execute` refuses to write ANYTHING while any entry is blocked. Not "the
 * blocked ones are skipped" — the whole run refuses. A content migration
 * that half-lands leaves a database nobody can reason about: some posts
 * migrated, some not, recommendations pointing at rows that may or may not
 * exist yet, and no way to tell a deliberate omission from a failure.
 * All-or-nothing at the PLAN level, resumable at the ROW level (see
 * newsMigrationWriter.ts), is the combination that makes both true.
 *
 * ─── DRIFT IS A BLOCKER, NOT AN UPDATE ───────────────────────────────────
 *
 * When a post already carries a row's provenance but no longer matches
 * what the mapping produces, SOMEBODY EDITED IT — an editor fixed a typo,
 * rewrote a deck, reordered a gallery. Re-running the migration must not
 * quietly revert that. The tool has no update mode at all: post-migration
 * content belongs to the editors, and the only honest thing a migration
 * can do when it finds its output changed is stop and say so.
 *
 * The same rule catches the other direction — the manifest changed after a
 * run — with the same message, because from the database's point of view
 * they are indistinguishable and both need a human.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  editorialAuthorsTable,
  editorialLanguagesTable,
  editorialPostTopicsTable,
  editorialPostTranslationsTable,
  editorialPostsTable,
  editorialTopicsTable,
  websiteNewsPostsTable,
  type EditorialPost,
  type EditorialPostTranslation,
  type WebsiteNewsPost,
} from "@workspace/db";
import type { DbClient } from "./dbTypes";
import { readStoredGallery } from "./editorialGallery";
import {
  NEWS_MIGRATION_TARGET_CHANNEL,
  type NewsMigrationManifest,
} from "./newsMigrationManifest";
import {
  MIGRATION_SOURCE_TABLE,
  mapNewsPost,
  type CrossTypeReference,
  type MappedPost,
  type MappingBlocker,
  type MappingNote,
} from "./newsMigrationMapping";

/** Bumped when the plan's SHAPE changes, so a stored plan is self-describing. */
export const NEWS_MIGRATION_PLAN_SCHEMA_VERSION = 1;

export interface PlanEntryBase {
  sourceId: number;
  sourceSlug: string;
  title: string;
}

export interface PlanEntryCreate extends PlanEntryBase {
  action: "create";
  mapped: MappedPost;
  notes: MappingNote[];
}

export interface PlanEntrySkip extends PlanEntryBase {
  action: "skip";
  existingPostId: number;
  reason: "already migrated and unchanged";
  /**
   * The mapping is carried on a SKIP entry too, not only on a create.
   *
   * Phases 2 and 3 of the writer (recommendations and placements) are
   * re-derived for every migrated post on every run, including ones an
   * EARLIER run committed. Without the mapping here, a run resumed after
   * an interruption would write relations and placements only for the
   * posts IT created — the posts its predecessor had already committed
   * would silently keep none, forever, because a later run sees them as
   * skips. Carrying the mapping is what makes those two phases
   * self-healing rather than dependent on which run created what.
   */
  mapped: MappedPost;
}

export interface PlanEntryBlocked extends PlanEntryBase {
  action: "blocked";
  blockers: MappingBlocker[];
}

export type PlanEntry = PlanEntryCreate | PlanEntrySkip | PlanEntryBlocked;

export interface NewsMigrationPlan {
  planSchemaVersion: number;
  sourceTable: string;
  targetChannel: string;
  languageCode: string;
  languageId: number;
  /** Manifest-level problems that block the whole run, not one row. */
  manifestBlockers: MappingBlocker[];
  entries: PlanEntry[];
  /**
   * EVERY news→performance reference across the whole scope, in source
   * order. This is the CROSS-TYPE PRESERVATION MANIFEST. It is an OUTPUT
   * of every mode, it is never written to editorial_post_relations, and
   * `execute` does not consult it — it exists so the relationships the
   * legacy site expressed are recorded in a reviewable place while
   * Performance remains untouched.
   */
  crossTypePreservation: CrossTypeReference[];
  /**
   * news→news references whose TARGET is not in scope (a dangling legacy
   * slug). Reported, never invented: a recommendation that points nowhere
   * is dropped with a named reason rather than pointed at something else.
   */
  unresolvedNewsRecommendations: Array<{ sourceSlug: string; targetSlug: string }>;
  counts: { total: number; create: number; skip: number; blocked: number };
}

/** True when `execute` is allowed to proceed. */
export function planIsExecutable(plan: NewsMigrationPlan): boolean {
  return plan.manifestBlockers.length === 0 && plan.counts.blocked === 0;
}

/**
 * Plan the whole migration.
 *
 * `client` must be a transaction that has issued SET TRANSACTION READ ONLY
 * when called for a dry-run; the planner itself contains no writes, so
 * that is defense in depth rather than the mechanism.
 */
export async function planNewsMigration(
  client: DbClient,
  manifest: NewsMigrationManifest,
): Promise<NewsMigrationPlan> {
  const manifestBlockers: MappingBlocker[] = [];

  // ── The target language must exist and be usable ───────────────────────
  const [language] = await client
    .select()
    .from(editorialLanguagesTable)
    .where(eq(editorialLanguagesTable.code, manifest.languageCode));
  if (!language) {
    manifestBlockers.push({
      code: "language_unusable",
      message: `The manifest declares languageCode "${manifest.languageCode}", which is not an editorial language.`,
      remedy: "Create the language in Admin → Editorial → Languages, or correct the manifest.",
    });
  } else if (!language.isActive) {
    manifestBlockers.push({
      code: "language_unusable",
      message: `Editorial language "${manifest.languageCode}" is not active, and a translation cannot be published in an inactive language.`,
      remedy: "Activate the language in Admin, or migrate into a different one.",
    });
  }

  // ── Every manifest author must be a REAL, PUBLISHABLE news author ──────
  //
  // Checked here rather than left to the publish transition on purpose: a
  // wrong author id would otherwise surface halfway through an execute,
  // after earlier rows had already committed. An author that is archived,
  // in the wrong channel, or biography-less makes publishing IMPOSSIBLE,
  // so it is a planning-time blocker, not a runtime surprise.
  const authorIds = [...new Set(manifest.authors.map((entry) => entry.editorialAuthorId))];
  if (authorIds.length > 0) {
    const authors = await client
      .select()
      .from(editorialAuthorsTable)
      .where(inArray(editorialAuthorsTable.id, authorIds));
    const byId = new Map(authors.map((author) => [author.id, author]));
    for (const entry of manifest.authors) {
      const author = byId.get(entry.editorialAuthorId);
      const label = `"${entry.sourceName}" / "${entry.sourceRole}"`;
      if (!author) {
        manifestBlockers.push({
          code: "manifest_author_invalid",
          message: `The manifest maps ${label} to editorial author #${entry.editorialAuthorId}, which does not exist.`,
          remedy: "Correct the id, or create the author in Admin → Editorial → Authors first. The migration never creates authors: an author needs a biography to be publishable, and a biography cannot be derived from anything in the legacy model.",
        });
        continue;
      }
      if (author.channel !== NEWS_MIGRATION_TARGET_CHANNEL) {
        manifestBlockers.push({
          code: "manifest_author_invalid",
          message: `The manifest maps ${label} to editorial author #${author.id} ("${author.publicName}"), whose channel is "${author.channel}" — not "${NEWS_MIGRATION_TARGET_CHANNEL}".`,
          remedy: "Point the entry at a news-channel author. An author belongs to exactly one channel by design, so the same person writing for both surfaces is two author rows.",
        });
      }
      if (author.status !== "active") {
        manifestBlockers.push({
          code: "manifest_author_invalid",
          message: `The manifest maps ${label} to editorial author #${author.id} ("${author.publicName}"), which is archived. An archived author cannot be newly assigned to a post.`,
          remedy: "Reactivate the author in Admin, or point the entry at an active one.",
        });
      }
      if (!author.biography || author.biography.trim().length === 0) {
        manifestBlockers.push({
          code: "manifest_author_invalid",
          message: `Editorial author #${author.id} ("${author.publicName}") has no biography, and no translation can be published with a biography-less author.`,
          remedy: "Write the author's biography in Admin first. The migration will not invent one — a biography is a claim about a real person.",
        });
      }
    }
  }

  // ── Every manifest topic must be a REAL, ASSIGNABLE news topic ─────────
  const topicIds = [
    ...new Set(
      manifest.topics
        .map((entry) => entry.editorialTopicId)
        .filter((id): id is number => id != null),
    ),
  ];
  if (topicIds.length > 0) {
    const topics = await client
      .select()
      .from(editorialTopicsTable)
      .where(inArray(editorialTopicsTable.id, topicIds));
    const byId = new Map(topics.map((topic) => [topic.id, topic]));
    for (const id of topicIds) {
      const topic = byId.get(id);
      if (!topic) {
        manifestBlockers.push({
          code: "manifest_topic_invalid",
          message: `The manifest maps a tag to editorial topic #${id}, which does not exist.`,
          remedy: "Correct the id, or create the topic in Admin → Editorial → Topics.",
        });
        continue;
      }
      if (topic.channel !== NEWS_MIGRATION_TARGET_CHANNEL) {
        manifestBlockers.push({
          code: "manifest_topic_invalid",
          message: `Editorial topic #${id} ("${topic.name}") is in channel "${topic.channel}", not "${NEWS_MIGRATION_TARGET_CHANNEL}".`,
          remedy: "Point the entry at a news-channel topic. Topic slugs are unique per channel, so the same name can legitimately exist on both sides as two rows.",
        });
      }
      if (topic.status !== "active") {
        manifestBlockers.push({
          code: "manifest_topic_invalid",
          message: `Editorial topic #${id} ("${topic.name}") is archived, and an archived topic can never be NEWLY assigned.`,
          remedy: "Reactivate the topic, point the entry elsewhere, or set skip: true to drop the tag deliberately.",
        });
      }
    }
  }

  // ── Load the source scope, in a STABLE order ───────────────────────────
  //
  // Ordered by id, which is the insertion order and therefore stable
  // across runs. Stability matters for resumability: a resumed run must
  // meet the same rows in the same order as the run it is continuing.
  const sourceRows = (await client
    .select()
    .from(websiteNewsPostsTable)
    .orderBy(websiteNewsPostsTable.id)) as WebsiteNewsPost[];

  // ── Everything already in the target channel+language ──────────────────
  const existing = await loadExistingNewsTranslations(client, language?.id ?? -1);

  const entries: PlanEntry[] = [];
  const crossTypePreservation: CrossTypeReference[] = [];
  const unresolvedNewsRecommendations: Array<{ sourceSlug: string; targetSlug: string }> = [];

  // Which source slugs are in scope at all — a news→news ref pointing
  // outside this set has no post to point at.
  const inScopeSlugs = new Set(sourceRows.map((row) => row.slug));

  for (const row of sourceRows) {
    const result = mapNewsPost(row, manifest, {
      featuredPlacementKey: manifest.featuredPlacement?.placementKey ?? null,
    });

    if (!result.ok) {
      entries.push({
        action: "blocked",
        sourceId: row.id,
        sourceSlug: row.slug,
        title: row.title,
        blockers: result.blockers,
      });
      continue;
    }

    const mapped = result.mapped;
    crossTypePreservation.push(...mapped.crossTypeReferences);
    for (const rec of mapped.newsRecommendations) {
      if (!inScopeSlugs.has(rec.targetSlug)) {
        unresolvedNewsRecommendations.push({
          sourceSlug: mapped.sourceSlug,
          targetSlug: rec.targetSlug,
        });
      }
    }

    // ── Provenance probe — the ONLY identity question asked ─────────────
    const owned = existing.byProvenance.get(row.id);

    if (owned) {
      const drift = describeDrift(owned, mapped, existing.topicIdsByPostId.get(owned.post.id) ?? []);
      if (drift.length > 0) {
        entries.push({
          action: "blocked",
          sourceId: row.id,
          sourceSlug: row.slug,
          title: row.title,
          blockers: [
            {
              code: "post_migration_drift",
              message: `Editorial post #${owned.post.id} already carries this row's provenance, but no longer matches what the migration produces (${drift.join("; ")}). Either an editor changed it after it was migrated, or the manifest changed since. The migration will not overwrite either.`,
              remedy: "Review the differences and decide by hand. This tool has no update mode: once a row is migrated, its content belongs to the editors.",
            },
          ],
        });
        continue;
      }
      entries.push({
        action: "skip",
        sourceId: row.id,
        sourceSlug: row.slug,
        title: row.title,
        existingPostId: owned.post.id,
        reason: "already migrated and unchanged",
        mapped,
      });
      continue;
    }

    // ── Slug collision, classified three ways ───────────────────────────
    const collision = existing.bySlug.get(mapped.translation.slug);
    if (collision) {
      entries.push({
        action: "blocked",
        sourceId: row.id,
        sourceSlug: row.slug,
        title: row.title,
        blockers: [describeSlugCollision(mapped.translation.slug, row, collision)],
      });
      continue;
    }

    entries.push({
      action: "create",
      sourceId: row.id,
      sourceSlug: row.slug,
      title: row.title,
      mapped,
      notes: mapped.notes,
    });
  }

  const counts = {
    total: entries.length,
    create: entries.filter((entry) => entry.action === "create").length,
    skip: entries.filter((entry) => entry.action === "skip").length,
    blocked: entries.filter((entry) => entry.action === "blocked").length,
  };

  return {
    planSchemaVersion: NEWS_MIGRATION_PLAN_SCHEMA_VERSION,
    sourceTable: MIGRATION_SOURCE_TABLE,
    targetChannel: NEWS_MIGRATION_TARGET_CHANNEL,
    languageCode: manifest.languageCode,
    languageId: language?.id ?? -1,
    manifestBlockers,
    entries,
    crossTypePreservation,
    unresolvedNewsRecommendations,
    counts,
  };
}

export interface ExistingTranslation {
  post: EditorialPost;
  translation: EditorialPostTranslation;
}

export interface ExistingIndex {
  /** Keyed by migration_source_id, for rows this tool has already migrated. */
  byProvenance: Map<number, ExistingTranslation>;
  /** Keyed by slug within (news, this language) — the uniqueness scope. */
  bySlug: Map<string, ExistingTranslation>;
  topicIdsByPostId: Map<number, number[]>;
}

/**
 * Everything in the target channel+language, indexed both ways.
 *
 * Loaded ONCE per run rather than probed per row: the collision question
 * and the provenance question must both be answered against the same
 * snapshot, and a per-row probe would let the two answers come from
 * different moments.
 */
export async function loadExistingNewsTranslations(
  client: DbClient,
  languageId: number,
): Promise<ExistingIndex> {
  const rows = await client
    .select({ post: editorialPostsTable, translation: editorialPostTranslationsTable })
    .from(editorialPostTranslationsTable)
    .innerJoin(editorialPostsTable, eq(editorialPostTranslationsTable.postId, editorialPostsTable.id))
    .where(
      and(
        eq(editorialPostTranslationsTable.channel, NEWS_MIGRATION_TARGET_CHANNEL),
        eq(editorialPostTranslationsTable.languageId, languageId),
      ),
    );

  const byProvenance = new Map<number, ExistingTranslation>();
  const bySlug = new Map<string, ExistingTranslation>();
  for (const row of rows) {
    bySlug.set(row.translation.slug, row);
    if (
      row.post.migrationSourceTable === MIGRATION_SOURCE_TABLE &&
      row.post.migrationSourceId != null
    ) {
      byProvenance.set(row.post.migrationSourceId, row);
    }
  }

  const topicIdsByPostId = new Map<number, number[]>();
  const postIds = rows.map((row) => row.post.id);
  if (postIds.length > 0) {
    const links = await client
      .select()
      .from(editorialPostTopicsTable)
      .where(inArray(editorialPostTopicsTable.postId, postIds));
    for (const link of links) {
      const list = topicIdsByPostId.get(link.postId) ?? [];
      list.push(link.topicId);
      topicIdsByPostId.set(link.postId, list);
    }
  }

  return { byProvenance, bySlug, topicIdsByPostId };
}

/**
 * The three-way slug classification.
 *
 *   SAME PROVENANCE  — impossible to reach here (the provenance probe
 *                      above already claimed it), but stated explicitly
 *                      so the rule reads completely in one place.
 *   UNRELATED        — a hand-authored Editorial post already owns this
 *                      public URL. BLOCK.
 *   AMBIGUOUS        — a post carrying SOME OTHER provenance owns it.
 *                      BLOCK, and more loudly: it means two legacy rows
 *                      are competing for one URL, or a provenance pair is
 *                      wrong.
 *
 * None of the three is ever resolved by auto-suffixing to "-2". Editorial
 * DOES auto-suffix generated slugs, and deliberately refuses to for MANUAL
 * ones (resolveTranslationSlug) — a migrated slug is a manual slug in
 * every sense that matters: it is an existing public URL being carried
 * across, and silently renaming it breaks inbound links invisibly. A human
 * resolves it with a manifest slugOverride, which records the decision.
 */
export function describeSlugCollision(
  slug: string,
  row: Pick<WebsiteNewsPost, "id" | "slug">,
  collision: ExistingTranslation,
): MappingBlocker {
  const remedy = `Resolve it by adding { "sourceSlug": "${row.slug}", "slug": "a-new-slug" } to the manifest's slugOverrides, or by changing the existing post's slug in Admin. The tool never auto-suffixes a migrated slug: it is an existing public URL, and renaming it silently would break inbound links.`;

  if (collision.post.migrationSourceTable === MIGRATION_SOURCE_TABLE) {
    return {
      code: "slug_collision_ambiguous",
      message: `AMBIGUOUS slug collision on "${slug}": editorial post #${collision.post.id} already holds it and was migrated from ${MIGRATION_SOURCE_TABLE} row #${collision.post.migrationSourceId}, which is not this row (#${row.id}). Two legacy rows are competing for one public URL, or a provenance pair is wrong.`,
      remedy,
    };
  }
  if (collision.post.migrationSourceTable != null) {
    return {
      code: "slug_collision_ambiguous",
      message: `AMBIGUOUS slug collision on "${slug}": editorial post #${collision.post.id} already holds it and carries provenance from a DIFFERENT source table ("${collision.post.migrationSourceTable}").`,
      remedy,
    };
  }
  return {
    code: "slug_collision_unrelated",
    message: `UNRELATED slug collision on "${slug}": editorial post #${collision.post.id} ("${collision.translation.title}") already holds this slug and was authored in Admin, not migrated. It is not this legacy row under another name.`,
    remedy,
  };
}

/**
 * What differs between an already-migrated post and what the mapping says
 * it should be. An empty list means "identical", which is what makes a
 * re-run a no-op.
 *
 * Compared field by field with a NAMED reason rather than by one
 * whole-object hash: an operator who hits a drift block needs to know
 * WHICH field changed, and a hash can only say "something".
 *
 * `publishedAt` is compared as an instant, not as a string: Postgres
 * returns a timestamptz in its own canonical rendering, which is not
 * byte-identical to the legacy column's rendering even when they are the
 * same moment.
 */
/**
 * Stable JSON for COMPARING a value that has been through Postgres `jsonb`.
 *
 * WHY THIS IS NOT PARANOIA. `jsonb` does not preserve object key order —
 * it stores keys sorted by length and then bytewise. A `body` block
 * written as `{ type, text }` comes back as `{ text, type }`, and a
 * gallery item written as `{ url, alt }` comes back as `{ alt, url }`. A
 * plain `JSON.stringify` comparison is key-order sensitive, so it reports
 * EVERY freshly-migrated post as drifted, forever: the second run blocks
 * on posts nothing has touched, the migration is permanently
 * non-idempotent, and `verify` fails on a perfectly correct database.
 *
 * Object keys are therefore sorted; ARRAY ORDER IS PRESERVED, which is the
 * whole point — `body.blocks` and `gallery.items` are ordered, and a
 * reorder is a genuine change that must still register as drift.
 */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input === null || typeof input !== "object") return input;
    const record = input as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalize(record[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function describeDrift(
  existing: ExistingTranslation,
  mapped: MappedPost,
  existingTopicIds: number[],
): string[] {
  const differences: string[] = [];
  const t = existing.translation;
  const m = mapped.translation;

  const compare = (label: string, was: unknown, now: unknown) => {
    if (canonicalJson(was ?? null) !== canonicalJson(now ?? null)) {
      differences.push(`${label} differs`);
    }
  };

  compare("title", t.title, m.title);
  compare("slug", t.slug, m.slug);
  compare("deck", t.deck, m.deck);
  compare("context label", t.contextLabel, m.contextLabel);
  compare("feature image alt", t.featureImageAlt, m.featureImageAlt);
  compare("listing image", t.listingImageUrl, m.listingImageUrl);
  compare("body", t.body, m.body);
  compare("gallery", readStoredGallery(t.gallery), m.gallery);
  compare("reading time override", t.readingTimeOverrideMinutes, m.readingTimeOverrideMinutes);
  compare("feature image", existing.post.featureImageUrl, mapped.featureImageUrl);
  compare("author", existing.post.authorId, mapped.authorId);
  compare(
    "topics",
    [...existingTopicIds].sort((a, b) => a - b),
    [...mapped.topicIds].sort((a, b) => a - b),
  );

  const expectedStatus = mapped.lifecycle === "published" ? "published" : "archived";
  if (t.status !== expectedStatus) {
    differences.push(`state is "${t.status}" but the legacy row implies "${expectedStatus}"`);
  }

  const wasAt = t.publishedAt ? Date.parse(t.publishedAt) : null;
  const nowAt = Date.parse(mapped.publishedAt);
  if (wasAt !== nowAt) differences.push("publication date differs");

  return differences;
}
