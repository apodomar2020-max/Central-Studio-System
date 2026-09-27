/**
 * News → Editorial migration VERIFY — Final Editorial, Phase B.
 *
 * READ-ONLY. Run after `execute` to answer one question with evidence
 * rather than with the execute run's own say-so: IS THE DATABASE WHAT THE
 * MIGRATION CLAIMED IT WOULD BE?
 *
 * ─── WHY THIS IS NOT REDUNDANT WITH EXECUTE ──────────────────────────────
 *
 * `execute` reports what it DID. `verify` reports what IS. Those differ
 * whenever anything happened that execute could not see: an interrupted
 * run that committed some rows and reported none, a concurrent Admin edit
 * during the run, a trigger or constraint that rewrote a value, or a
 * defect in the writer itself. A migration that can only be checked by
 * re-reading its own log is not checkable at all.
 *
 * It re-derives the expectation from the SOURCE and the MANIFEST — the
 * same planner every other mode uses — and compares it to the live
 * Editorial rows. It never reads a stored report.
 *
 * ─── THE INVARIANTS IT ASSERTS ───────────────────────────────────────────
 *
 * Beyond "every row landed and matches", three checks exist specifically
 * to catch the failures this migration could uniquely cause:
 *
 *   1. NO CROSS-CHANNEL RELATION. editorial_post_relations must contain no
 *      edge whose two posts are in different channels. This is the
 *      invariant the news→performance split protects, and it is asserted
 *      against the whole table, not only against migrated rows.
 *   2. NO PERFORMANCE REF BECAME A RECOMMENDATION. Every news→performance
 *      ref in the source is confirmed ABSENT from the migrated post's
 *      recommendations, by count: a migrated post's recommendation count
 *      must equal its resolvable news→news ref count exactly.
 *   3. NO GALLERY ITEM LACKS ALT. Re-checked on the STORED rows, not on
 *      the payload that was sent, so a write path that lost the field
 *      would be caught.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  editorialPlacementsTable,
  editorialPostRelationsTable,
  editorialPostsTable,
  websiteNewsPostsTable,
} from "@workspace/db";
import { alias } from "drizzle-orm/pg-core";
import type { DbClient } from "./dbTypes";
import { readStoredGallery } from "./editorialGallery";
import { NEWS_MIGRATION_TARGET_CHANNEL, type NewsMigrationManifest } from "./newsMigrationManifest";
import { loadExistingNewsTranslations, planNewsMigration } from "./newsMigrationPlanner";

export interface VerifyFinding {
  code:
    | "source_row_not_migrated"
    | "migrated_post_drifted"
    | "recommendation_count_mismatch"
    | "cross_channel_relation"
    | "gallery_alt_missing_in_database"
    | "publication_date_lost"
    | "featured_post_not_placed"
    | "blocked_row_remains";
  message: string;
}

export interface VerifyReport {
  ok: boolean;
  checked: {
    sourceRows: number;
    migratedPosts: number;
    relations: number;
  };
  findings: VerifyFinding[];
  /**
   * Restated on every verify, not only on dry-run: the cross-type refs
   * that were deliberately NOT written. Verify is the report an owner
   * reads last, so the preserved-but-unmigrated relationships have to be
   * legible from it without going back to an earlier run's output.
   */
  crossTypePreservation: Array<{ sourceSlug: string; targetSlug: string; position: number }>;
}

export async function verifyNewsMigration(
  client: DbClient,
  manifest: NewsMigrationManifest,
): Promise<VerifyReport> {
  const findings: VerifyFinding[] = [];

  // The SAME planner, against the CURRENT database. After a complete,
  // untouched migration every entry must be `skip` — that single fact is
  // most of the verification, because `skip` is defined as "a post carries
  // this provenance AND matches the mapping exactly".
  const plan = await planNewsMigration(client, manifest);

  for (const entry of plan.entries) {
    if (entry.action === "skip") continue;
    if (entry.action === "create") {
      findings.push({
        code: "source_row_not_migrated",
        message: `Legacy row #${entry.sourceId} ("${entry.sourceSlug}") has no Editorial post carrying its provenance.`,
      });
      continue;
    }
    const isDrift = entry.blockers.some((blocker) => blocker.code === "post_migration_drift");
    findings.push({
      code: isDrift ? "migrated_post_drifted" : "blocked_row_remains",
      message: `Legacy row #${entry.sourceId} ("${entry.sourceSlug}"): ${entry.blockers.map((b) => b.message).join(" | ")}`,
    });
  }

  const existing = await loadExistingNewsTranslations(client, plan.languageId);

  // ── Publication dates, gallery alt, drift on the stored rows ───────────
  for (const [sourceId, row] of existing.byProvenance) {
    const gallery = readStoredGallery(row.translation.gallery);
    gallery.items.forEach((item, index) => {
      if (typeof item.alt !== "string" || item.alt.trim().length === 0) {
        findings.push({
          code: "gallery_alt_missing_in_database",
          message: `Editorial post #${row.post.id} (from legacy row #${sourceId}) has a stored gallery image ${index + 1} with no alt text.`,
        });
      }
    });
    if (row.translation.publishedAt == null) {
      findings.push({
        code: "publication_date_lost",
        message: `Editorial post #${row.post.id} (from legacy row #${sourceId}) has no publication date; the legacy row's date was not preserved.`,
      });
    }
  }

  // ── INVARIANT 1: no relation crosses a channel, anywhere in the table ──
  const targetPosts = alias(editorialPostsTable, "target_posts");
  const crossChannel = await client
    .select({
      id: editorialPostRelationsTable.id,
      sourcePostId: editorialPostRelationsTable.sourcePostId,
      targetPostId: editorialPostRelationsTable.targetPostId,
      sourceChannel: editorialPostsTable.channel,
      targetChannel: targetPosts.channel,
    })
    .from(editorialPostRelationsTable)
    .innerJoin(editorialPostsTable, eq(editorialPostRelationsTable.sourcePostId, editorialPostsTable.id))
    .innerJoin(targetPosts, eq(editorialPostRelationsTable.targetPostId, targetPosts.id))
    .where(ne(editorialPostsTable.channel, targetPosts.channel));
  for (const row of crossChannel) {
    findings.push({
      code: "cross_channel_relation",
      message: `editorial_post_relations #${row.id} joins a ${row.sourceChannel} post (#${row.sourcePostId}) to a ${row.targetChannel} post (#${row.targetPostId}). Recommendations must never cross channels.`,
    });
  }

  // ── INVARIANT 2: performance refs did not become recommendations ───────
  //
  // Checked by COUNT rather than by identity, because a
  // news→performance ref has no Editorial post id to look for — the whole
  // point is that it was never turned into one. If a performance ref had
  // leaked into the recommendations, the migrated post would carry MORE
  // relations than its resolvable news→news refs, and that is detectable.
  const migratedPostIds = [...existing.byProvenance.values()].map((row) => row.post.id);
  const relationCounts = new Map<number, number>();
  let relationsChecked = 0;
  if (migratedPostIds.length > 0) {
    const relations = await client
      .select()
      .from(editorialPostRelationsTable)
      .where(inArray(editorialPostRelationsTable.sourcePostId, migratedPostIds));
    relationsChecked = relations.length;
    for (const relation of relations) {
      relationCounts.set(relation.sourcePostId, (relationCounts.get(relation.sourcePostId) ?? 0) + 1);
    }
  }

  const expectedRelationCounts = await expectedNewsRelationCounts(client, plan.languageId);
  for (const [postId, expected] of expectedRelationCounts) {
    const actual = relationCounts.get(postId) ?? 0;
    if (actual !== expected) {
      findings.push({
        code: "recommendation_count_mismatch",
        message: `Editorial post #${postId} has ${actual} recommendation(s) but its legacy row resolves to ${expected} news→news reference(s). A cross-type (Performance) reference may have leaked into Editorial recommendations, or a recommendation was added by hand.`,
      });
    }
  }

  // ── INVARIANT 3: featured rows actually reached the declared slot ──────
  const placementKey = manifest.featuredPlacement?.placementKey ?? null;
  if (placementKey) {
    const placed = await client
      .select({ postId: editorialPlacementsTable.postId })
      .from(editorialPlacementsTable)
      .where(
        and(
          eq(editorialPlacementsTable.channel, NEWS_MIGRATION_TARGET_CHANNEL),
          eq(editorialPlacementsTable.key, placementKey),
        ),
      );
    const placedIds = new Set(placed.map((row) => row.postId));
    // Which migrated posts SHOULD be placed is re-derived from the SOURCE
    // rows rather than from the placement table, so a missing entry is
    // detectable rather than self-confirming.
    const featuredSourceIds = await loadFeaturedSourceIds(client);
    for (const entry of plan.entries) {
      if (entry.action !== "skip") continue;
      if (featuredSourceIds.has(entry.sourceId) && !placedIds.has(entry.existingPostId)) {
        findings.push({
          code: "featured_post_not_placed",
          message: `Legacy row #${entry.sourceId} ("${entry.sourceSlug}") is flagged is_featured, but Editorial post #${entry.existingPostId} is not in the "${placementKey}" placement.`,
        });
      }
    }
  }

  return {
    ok: findings.length === 0,
    checked: {
      sourceRows: plan.counts.total,
      migratedPosts: existing.byProvenance.size,
      relations: relationsChecked,
    },
    findings,
    crossTypePreservation: plan.crossTypePreservation.map((ref) => ({
      sourceSlug: ref.sourceSlug,
      targetSlug: ref.targetSlug,
      position: ref.position,
    })),
  };
}

/**
 * For each migrated post, how many recommendations it SHOULD have: the
 * count of its legacy related_refs that are type 'news' AND whose target
 * slug resolves to another migrated post AND is not itself.
 *
 * Deliberately recomputed from the source table rather than reused from
 * the execute run's result — verify must not trust the thing it verifies.
 */
async function expectedNewsRelationCounts(
  client: DbClient,
  languageId: number,
): Promise<Map<number, number>> {
  const sourceRows = await client.select().from(websiteNewsPostsTable);
  const existing = await loadExistingNewsTranslations(client, languageId);

  const postIdBySourceSlug = new Map<string, number>();
  for (const row of sourceRows) {
    const migrated = existing.byProvenance.get(row.id);
    if (migrated) postIdBySourceSlug.set(row.slug, migrated.post.id);
  }

  const counts = new Map<number, number>();
  for (const row of sourceRows) {
    const migrated = existing.byProvenance.get(row.id);
    if (!migrated) continue;
    const targets = new Set<number>();
    for (const ref of row.relatedRefs ?? []) {
      if (ref.type !== "news") continue;
      const targetId = postIdBySourceSlug.get(ref.slug);
      if (targetId == null || targetId === migrated.post.id) continue;
      targets.add(targetId);
    }
    counts.set(migrated.post.id, targets.size);
  }
  return counts;
}

/** The ids of every legacy row flagged is_featured, in one query. */
async function loadFeaturedSourceIds(client: DbClient): Promise<Set<number>> {
  const rows = await client
    .select({ id: websiteNewsPostsTable.id })
    .from(websiteNewsPostsTable)
    .where(eq(websiteNewsPostsTable.isFeatured, true));
  return new Set(rows.map((row) => row.id));
}
