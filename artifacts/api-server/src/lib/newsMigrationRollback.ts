/**
 * News → Editorial migration ROLLBACK planner — Final Editorial, Phase B.
 *
 * Answers "what would rolling this migration back destroy?" without
 * destroying anything, and is the sole source of the list `rollback` then
 * deletes. `rollback-dry-run` IS this module plus formatting; `rollback`
 * is this module plus one DELETE per post.
 *
 * ─── SCOPE: PROVENANCE, AND NOTHING ELSE ─────────────────────────────────
 *
 * The candidate set is `editorial_posts WHERE migration_source_table =
 * 'website_news_posts'`. Not "posts whose slug matches a legacy slug", not
 * "posts created after a timestamp", not "posts with this author". Those
 * would all catch hand-authored posts eventually, and a rollback that can
 * delete work a person did is not a rollback. Provenance is the only
 * predicate, and migration 0130's partial unique index is what makes it
 * trustworthy.
 *
 * ─── EDITED POSTS ARE PROTECTED BY DEFAULT ───────────────────────────────
 *
 * A migrated post that an editor has since changed contains human work
 * that did NOT come from the legacy row. Deleting it to undo a migration
 * would throw that work away, and the editor would have no way to get it
 * back — the legacy row does not contain it.
 *
 * So a post whose content no longer matches the mapping is reported as
 * EDITED and is excluded from the deletable set. Rolling it back anyway is
 * possible, but it takes a separate, explicit operator decision
 * (`--include-edited`) and the report names every post it would destroy,
 * with what changed. Defaulting the other way would make the safe case
 * silent and the destructive case automatic.
 *
 * ─── WHAT A ROLLBACK DOES NOT UNDO ───────────────────────────────────────
 *
 * Stated here as well as in the writer, because it is the thing an
 * operator most needs to know BEFORE running it:
 *
 *   * admin_activity_logs entries STAY. An audit trail that the audited
 *     operation can erase is not an audit trail; the rollback adds its own
 *     entry so "migrated, then rolled back" reads correctly.
 *   * editorial_authors / editorial_topics STAY. The migration never
 *     created any, so it has none of its own to remove, and deleting a
 *     human's author or topic because a migration once pointed at it would
 *     destroy data the migration does not own.
 *   * website_news_posts is NEVER touched — in any mode, including this
 *     one. The legacy table is the live public source throughout, and
 *     rolling back the migration must leave the public website exactly
 *     where it was.
 *   * Recommendations FROM surviving posts INTO deleted ones disappear
 *     with the cascade. Unavoidable (the target ceases to exist) and
 *     counted in the report so it is not a surprise.
 */
import { eq } from "drizzle-orm";
import {
  editorialLanguagesTable,
  editorialPostTranslationsTable,
  editorialPostsTable,
  websiteNewsPostsTable,
} from "@workspace/db";
import type { DbClient } from "./dbTypes";
import type { NewsMigrationManifest } from "./newsMigrationManifest";
import { MIGRATION_SOURCE_TABLE, mapNewsPost } from "./newsMigrationMapping";
import { describeDrift, loadExistingNewsTranslations } from "./newsMigrationPlanner";
import { countIncomingRelations, type RollbackCandidate, type RollbackPlan } from "./newsMigrationWriter";

export type { RollbackCandidate, RollbackPlan };

export interface RollbackReport extends RollbackPlan {
  /**
   * Relations from posts that SURVIVE into posts that would be deleted.
   * They vanish with the cascade; reported so the loss is visible before
   * it happens rather than discovered afterwards.
   */
  incomingRelationsLost: number;
  /** Ids the rollback would actually delete, given `includeEdited`. */
  deletablePostIds: number[];
  includeEdited: boolean;
}

/**
 * Build the rollback plan. READ-ONLY.
 *
 * Reuses `describeDrift` — the SAME function the forward planner uses to
 * decide whether a post is "already migrated and unchanged". One
 * definition of "changed" serves both directions, so a post can never be
 * simultaneously safe to skip on a re-run and unsafe to roll back, or the
 * reverse.
 */
export async function planNewsMigrationRollback(
  client: DbClient,
  manifest: NewsMigrationManifest,
  options: { includeEdited: boolean },
): Promise<RollbackReport> {
  const [language] = await client
    .select()
    .from(editorialLanguagesTable)
    .where(eq(editorialLanguagesTable.code, manifest.languageCode));

  const existing = await loadExistingNewsTranslations(client, language?.id ?? -1);
  const sourceRows = await client.select().from(websiteNewsPostsTable);
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));

  const candidates: RollbackCandidate[] = [];

  // Every post carrying this tool's provenance, whether or not its legacy
  // row still exists and whether or not it is in the manifest's language.
  // A rollback must be able to remove what a PREVIOUS run created even if
  // the source row has since been deleted — otherwise a migrated post
  // could become unrollbackable by an unrelated change to the legacy
  // table.
  const migratedPosts = await client
    .select()
    .from(editorialPostsTable)
    .where(eq(editorialPostsTable.migrationSourceTable, MIGRATION_SOURCE_TABLE));

  for (const post of migratedPosts) {
    const sourceId = post.migrationSourceId;
    const indexed = sourceId != null ? existing.byProvenance.get(sourceId) : undefined;
    const translation =
      indexed?.translation ??
      (
        await client
          .select()
          .from(editorialPostTranslationsTable)
          .where(eq(editorialPostTranslationsTable.postId, post.id))
      )[0];

    const editedReasons: string[] = [];
    const sourceRow = sourceId != null ? sourceById.get(sourceId) : undefined;

    if (!sourceRow) {
      // The legacy row is gone, so there is nothing to compare against.
      // Treated as EDITED — the conservative reading — because "I cannot
      // tell whether a human changed this" must never resolve to "it is
      // safe to delete".
      editedReasons.push(
        "the legacy row it was migrated from no longer exists, so the migration cannot prove this post still matches it",
      );
    } else if (indexed) {
      const result = mapNewsPost(sourceRow, manifest, {
        featuredPlacementKey: manifest.featuredPlacement?.placementKey ?? null,
      });
      if (!result.ok) {
        editedReasons.push(
          "the manifest no longer maps its legacy row, so the migration cannot prove this post still matches it",
        );
      } else {
        editedReasons.push(
          ...describeDrift(indexed, result.mapped, existing.topicIdsByPostId.get(post.id) ?? []),
        );
      }
    } else {
      editedReasons.push(
        "its translation is not in the manifest's language, so the migration cannot compare it",
      );
    }

    candidates.push({
      editorialPostId: post.id,
      sourceId: sourceId ?? -1,
      slug: translation?.slug ?? null,
      title: translation?.title ?? null,
      status: translation?.status ?? null,
      edited: editedReasons.length > 0,
      editedReasons,
    });
  }

  const deletable = candidates.filter((candidate) => options.includeEdited || !candidate.edited);
  const deletablePostIds = deletable.map((candidate) => candidate.editorialPostId);

  return {
    candidates,
    counts: {
      total: candidates.length,
      edited: candidates.filter((candidate) => candidate.edited).length,
      deletable: deletablePostIds.length,
    },
    incomingRelationsLost: await countIncomingRelations(client, deletablePostIds),
    deletablePostIds,
    includeEdited: options.includeEdited,
  };
}
