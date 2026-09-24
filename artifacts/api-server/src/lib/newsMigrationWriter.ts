/**
 * News → Editorial migration WRITER — Final Editorial, Phase B.
 *
 * The only module in this tool that writes anything. It is never called
 * with a plan that has blockers: `execute` re-plans first and refuses the
 * whole run if the plan is not executable (newsMigrationPlanner.ts).
 *
 * ─── TRANSACTION STRATEGY: ONE TRANSACTION PER LEGACY POST ───────────────
 *
 * Not one transaction for the whole migration, and not one per statement.
 *
 * ONE BIG TRANSACTION is wrong here. A content migration touches
 * editorial_posts, editorial_post_translations, editorial_post_topics,
 * editorial_post_revisions, editorial_placements, editorial_post_relations
 * and admin_activity_logs for every row; holding row locks on all of them
 * across the entire scope makes the migration un-resumable (a failure at
 * row 90 discards rows 1–89 and the next attempt redoes all the work that
 * had already succeeded), and turns a transient error into a total
 * restart.
 *
 * ONE TRANSACTION PER STATEMENT is worse: a post could commit without its
 * translation, or a translation could exist published without its topics,
 * and there would be no state in which "this legacy row is migrated" is a
 * single true-or-false fact.
 *
 * PER-POST is the unit where atomicity is actually meaningful. Everything
 * that makes one legacy row into one Editorial post — the post, its
 * translation, its topics, its gallery, its publish transition, its audit
 * rows — lands together or not at all. Between posts, the migration may be
 * interrupted freely: each committed post carries its provenance, and the
 * next run's provenance probe skips it. RESUMABILITY IS NOT A SEPARATE
 * MECHANISM — it is the same provenance uniqueness that provides
 * idempotency, which is why there is no checkpoint table to get out of
 * sync with reality.
 *
 * ─── WHY THERE ARE THREE PHASES ──────────────────────────────────────────
 *
 * 1. POSTS      — each legacy row becomes a post, one transaction each.
 * 2. RELATIONS  — recommendations, one transaction per source post.
 * 3. PLACEMENTS — the featured slot, one transaction.
 *
 * Phases 2 and 3 cannot be folded into phase 1. A news→news recommendation
 * can point FORWARD (row 1 recommends row 6), so the target post does not
 * exist yet while row 1 is being written; and the featured slot's ordering
 * is a property of the whole featured SET, not of any one row. Both are
 * re-derived from scratch and are themselves idempotent, so an interrupted
 * run simply re-runs them.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  editorialPlacementsTable,
  editorialPostRelationsTable,
  editorialPostTranslationsTable,
  editorialPostsTable,
  type EditorialPost,
} from "@workspace/db";
import type { DbClient } from "./dbTypes";
import type { ActivityActorSnapshot } from "./activityLog";
import {
  archiveTranslationInTx,
  createPostInTx,
  publishTranslationInTx,
  replacePlacement,
  replacePostRecommendations,
  replacePostTopics,
  type PublishReadinessDeps,
} from "./editorialPostsService";
import { MIGRATION_SOURCE_TABLE } from "./newsMigrationMapping";
import {
  NEWS_MIGRATION_TARGET_CHANNEL,
  type NewsMigrationManifest,
} from "./newsMigrationManifest";
import type { NewsMigrationPlan, PlanEntryCreate, PlanEntrySkip } from "./newsMigrationPlanner";

/**
 * The actor recorded on every audit row this tool writes.
 *
 * Deliberately NOT a real admin account and deliberately not anonymous.
 * Every editorial_posts / translation write in this codebase lands an
 * admin_activity_logs row naming who did it, and a migration is a real
 * actor with a real identity — it is just not a person. Borrowing a human
 * admin's identity would put a named individual's name on hundreds of rows
 * they never touched; `actorAdminId` is therefore null (the FK column
 * stays honest) while the name and email say plainly what did the work.
 */
export const NEWS_MIGRATION_ACTOR: ActivityActorSnapshot = {
  actorId: null,
  actorName: "News → Editorial migration",
  actorEmail: "migration@system.local",
};

export interface WriterDeps {
  /**
   * Injected so tests do not perform live network media validation. In a
   * real run this is left undefined and the service's own default applies
   * — gallery, feature, listing and body image URLs all cross the SAME
   * media trust boundary as an Admin write.
   */
  publishDeps?: PublishReadinessDeps;
}

export interface WriteOutcome {
  sourceId: number;
  sourceSlug: string;
  editorialPostId: number;
  translationId: number;
  status: "published" | "archived";
}

export interface ExecuteResult {
  created: WriteOutcome[];
  skipped: Array<{ sourceId: number; sourceSlug: string; editorialPostId: number }>;
  recommendationsWritten: Array<{ sourcePostId: number; targets: number[] }>;
  placement: { key: string; postIds: number[] } | null;
  /**
   * Refs the migration deliberately did NOT write, carried out of execute
   * so the run's own output records them and not only the dry-run's.
   */
  crossTypePreserved: NewsMigrationPlan["crossTypePreservation"];
  unresolvedNewsRecommendations: NewsMigrationPlan["unresolvedNewsRecommendations"];
}

/**
 * PHASE 1 for ONE legacy row, inside ONE caller-supplied transaction.
 *
 * Every write goes through the same service functions Admin uses
 * (createPostInTx, replacePostTopics, publishTranslationInTx,
 * archiveTranslationInTx), so a migrated post is indistinguishable from an
 * authored one: same invariant checks, same slug resolution, same revision
 * and audit behaviour. The migration adds exactly ONE thing the Admin path
 * does not have — the provenance stamp.
 */
export async function writeOnePost(
  tx: DbClient,
  entry: PlanEntryCreate,
  languageId: number,
  deps: WriterDeps,
): Promise<WriteOutcome> {
  const mapped = entry.mapped;
  const ctx = {
    actor: NEWS_MIGRATION_ACTOR,
    actorAdminId: null,
    deps: deps.publishDeps,
  };

  const { post, translation } = await createPostInTx(
    tx,
    {
      channel: NEWS_MIGRATION_TARGET_CHANNEL,
      authorId: mapped.authorId,
      featureImageUrl: mapped.featureImageUrl,
      translation: {
        languageId,
        title: mapped.translation.title,
        // Passed as a MANUAL slug, so resolveTranslationSlug validates its
        // shape and REFUSES on collision rather than auto-suffixing it to
        // "-2". The planner has already classified collisions and would
        // have blocked the run; this is the backstop that makes a silent
        // rename impossible even if it had not.
        slug: mapped.translation.slug,
        deck: mapped.translation.deck,
        contextLabel: mapped.translation.contextLabel,
        featureImageAlt: mapped.translation.featureImageAlt,
        listingImageUrl: mapped.translation.listingImageUrl,
        body: mapped.translation.body,
        gallery: mapped.translation.gallery,
        readingTimeOverrideMinutes: mapped.translation.readingTimeOverrideMinutes,
        seoTitle: mapped.translation.seoTitle,
        seoDescription: mapped.translation.seoDescription,
        ogImageUrl: mapped.translation.ogImageUrl,
      },
    },
    ctx,
  );
  if (!translation) throw new Error("createPostInTx returned no translation");

  // ── The provenance stamp ───────────────────────────────────────────────
  //
  // Written in the SAME transaction as the post it describes. If it landed
  // separately, an interruption between the two would leave a migrated
  // post with no provenance — invisible to the next run's probe, which
  // would migrate the legacy row a SECOND time. The partial unique index
  // from migration 0130 is the database-level backstop for the same race.
  await tx
    .update(editorialPostsTable)
    .set({
      migrationSourceTable: MIGRATION_SOURCE_TABLE,
      migrationSourceId: mapped.sourceId,
    })
    .where(eq(editorialPostsTable.id, post.id));

  await replacePostTopics(tx, post.id, mapped.topicIds);

  // ── Pre-seed the historical publication date ───────────────────────────
  //
  // This is the whole mechanism for preserving a legacy publication date.
  // publishTranslationInTx stamps `publishedAt: translation.publishedAt ??
  // now()`, a rule that has existed since Wave 1.1 so that re-publishing
  // an archived translation keeps its original date. Seeding the draft row
  // here means the REAL publish path preserves the legacy timestamp for
  // exactly the same reason and through exactly the same line of code —
  // rather than the migration writing `status = 'published'` itself and
  // keeping a second, drift-prone copy of the publish rules.
  await tx
    .update(editorialPostTranslationsTable)
    .set({ publishedAt: mapped.publishedAt })
    .where(eq(editorialPostTranslationsTable.id, translation.id));

  const published = await publishTranslationInTx(tx, post.id, languageId, ctx);

  if (mapped.lifecycle === "published-then-archived") {
    // A legacy row with is_active = false WAS public and has since been
    // hidden. Publishing then archiving records both facts: the real
    // publication date on the row, and the real current visibility — plus
    // a revision and two audit entries that say so.
    const archived = await archiveTranslationInTx(tx, post.id, languageId, ctx);
    return {
      sourceId: mapped.sourceId,
      sourceSlug: mapped.sourceSlug,
      editorialPostId: post.id,
      translationId: archived.id,
      status: "archived",
    };
  }

  return {
    sourceId: mapped.sourceId,
    sourceSlug: mapped.sourceSlug,
    editorialPostId: post.id,
    translationId: published.id,
    status: published.status as "published",
  };
}

/**
 * PHASE 2 — news→news recommendations for ONE source post.
 *
 * Only legacy refs of type 'news' reach here; type 'performance' refs were
 * split out by the mapping into the cross-type preservation manifest and
 * are NEVER passed to this function. That is the invariant that keeps
 * editorial_post_relations same-channel: the cross-channel edge is not
 * rejected downstream, it is never constructed.
 *
 * `position` is the legacy ref's own index, RE-COMPACTED after dropping
 * performance refs and unresolvable targets. Re-compaction is deliberate:
 * keeping the original indexes would leave gaps (0, 2, 5) that read as a
 * corrupt ordering, while the relative order — which is what the editor
 * actually chose — is preserved exactly.
 */
export async function writeRecommendationsForPost(
  tx: DbClient,
  sourcePostId: number,
  targetPostIds: readonly number[],
): Promise<void> {
  await replacePostRecommendations(
    tx,
    sourcePostId,
    targetPostIds.map((targetPostId, index) => ({ targetPostId, position: index })),
  );
}

/**
 * PHASE 3 — the featured placement slot.
 *
 * ADDITIVE, not a wholesale replace. `replacePlacement` deletes the slot
 * before inserting, so handing it only the migrated posts would silently
 * delete anything an editor had already curated into that slot. The
 * existing entries are therefore read first, kept in their existing
 * order and at the FRONT, and the migrated posts are appended after them.
 *
 * Migrated posts are ordered NEWEST FIRST by their legacy publication
 * date. That is the only ordering the legacy model actually contains:
 * `is_featured` is a bare boolean with no rank of its own, so any other
 * order would be invented.
 */
export async function writeFeaturedPlacement(
  tx: DbClient,
  key: string,
  migratedPostIdsNewestFirst: readonly number[],
): Promise<number[]> {
  const existing = await tx
    .select({ postId: editorialPlacementsTable.postId, position: editorialPlacementsTable.position })
    .from(editorialPlacementsTable)
    .where(
      and(
        eq(editorialPlacementsTable.channel, NEWS_MIGRATION_TARGET_CHANNEL),
        eq(editorialPlacementsTable.key, key),
      ),
    )
    .orderBy(editorialPlacementsTable.position);

  const ordered: number[] = [];
  for (const row of existing) {
    if (!ordered.includes(row.postId)) ordered.push(row.postId);
  }
  for (const postId of migratedPostIdsNewestFirst) {
    // Already curated into the slot by a human: leave it where THEY put
    // it rather than moving it to the migrated block.
    if (!ordered.includes(postId)) ordered.push(postId);
  }

  await replacePlacement(
    tx,
    key,
    NEWS_MIGRATION_TARGET_CHANNEL,
    ordered.map((postId, index) => ({ postId, position: index })),
  );
  return ordered;
}

/**
 * Resolve the provenance → editorial post id map for the whole scope.
 *
 * Used by phases 2 and 3, which need the ids of posts created by EARLIER
 * per-post transactions (and by earlier interrupted runs). Read fresh
 * rather than accumulated in memory, so a resumed run sees the posts its
 * predecessor committed.
 */
export async function loadMigratedPostIds(
  client: DbClient,
): Promise<Map<number, EditorialPost>> {
  const rows = await client
    .select()
    .from(editorialPostsTable)
    .where(eq(editorialPostsTable.migrationSourceTable, MIGRATION_SOURCE_TABLE));
  const bySourceId = new Map<number, EditorialPost>();
  for (const row of rows) {
    if (row.migrationSourceId != null) bySourceId.set(row.migrationSourceId, row);
  }
  return bySourceId;
}

/** How the three phases are driven. Injected so tests can drive them too. */
export interface TransactionRunner {
  <T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
}

/**
 * Run the whole migration from an ALREADY-VALIDATED, executable plan.
 *
 * Each phase-1 row gets its own transaction via `runInTransaction`. A
 * throw from any one row aborts THAT row's transaction and the run, but
 * leaves every previously committed row intact and re-runnable — which is
 * exactly what resumability means here.
 */
export async function executeNewsMigration(
  runInTransaction: TransactionRunner,
  plan: NewsMigrationPlan,
  manifest: NewsMigrationManifest,
  deps: WriterDeps = {},
): Promise<ExecuteResult> {
  const created: WriteOutcome[] = [];
  const skipped: ExecuteResult["skipped"] = [];

  for (const entry of plan.entries) {
    if (entry.action === "skip") {
      skipped.push({
        sourceId: entry.sourceId,
        sourceSlug: entry.sourceSlug,
        editorialPostId: entry.existingPostId,
      });
      continue;
    }
    if (entry.action !== "create") continue;
    const outcome = await runInTransaction((tx) =>
      writeOnePost(tx, entry, plan.languageId, deps),
    );
    created.push(outcome);
  }

  // ── Phase 2 — recommendations ──────────────────────────────────────────
  //
  // Over EVERY migrated post, not only the ones this run created.
  //
  // A run resumed after an interruption sees its predecessor's committed
  // posts as `skip`. If phases 2 and 3 only covered `create` entries,
  // those posts would never get their recommendations or their placement
  // entry — not on this run, and not on any future one, because they stay
  // skips forever. Both phases replace wholesale and are therefore
  // idempotent, so re-deriving them for every migrated post each run is
  // both correct and self-healing.
  const migratedEntries = plan.entries.filter(
    (entry): entry is PlanEntryCreate | PlanEntrySkip =>
      entry.action === "create" || entry.action === "skip",
  );

  const recommendationsWritten: ExecuteResult["recommendationsWritten"] = [];
  const bySourceId = await runInTransaction((tx) => loadMigratedPostIds(tx));
  const postIdBySourceSlug = new Map<string, number>();
  for (const entry of plan.entries) {
    const post = bySourceId.get(entry.sourceId);
    if (post) postIdBySourceSlug.set(entry.sourceSlug, post.id);
  }

  for (const entry of migratedEntries) {
    const sourcePostId = bySourceId.get(entry.sourceId)?.id;
    if (sourcePostId == null) continue;
    const targets: number[] = [];
    for (const rec of entry.mapped.newsRecommendations) {
      const targetId = postIdBySourceSlug.get(rec.targetSlug);
      // Dropped with a reason, never redirected: the planner already
      // recorded it in unresolvedNewsRecommendations.
      if (targetId == null) continue;
      // editorial_post_relations forbids self-reference at the DB level
      // (a CHECK) — a legacy row that related to itself would otherwise
      // fail the whole transaction here.
      if (targetId === sourcePostId) continue;
      if (!targets.includes(targetId)) targets.push(targetId);
    }
    if (targets.length === 0) continue;
    await runInTransaction((tx) => writeRecommendationsForPost(tx, sourcePostId, targets));
    recommendationsWritten.push({ sourcePostId, targets });
  }

  // ── Phase 3 — the featured placement ───────────────────────────────────
  let placement: ExecuteResult["placement"] = null;
  const key = manifest.featuredPlacement?.placementKey ?? null;
  if (key) {
    const featured = migratedEntries
      .filter((entry) => entry.mapped.featuredPlacementKey === key)
      .sort((a, b) => Date.parse(b.mapped.publishedAt) - Date.parse(a.mapped.publishedAt))
      .map((entry) => bySourceId.get(entry.sourceId)?.id)
      .filter((id): id is number => id != null);
    if (featured.length > 0) {
      const postIds = await runInTransaction((tx) => writeFeaturedPlacement(tx, key, featured));
      placement = { key, postIds };
    }
  }

  return {
    created,
    skipped,
    recommendationsWritten,
    placement,
    crossTypePreserved: plan.crossTypePreservation,
    unresolvedNewsRecommendations: plan.unresolvedNewsRecommendations,
  };
}

/**
 * ROLLBACK — delete every post this tool created, and nothing else.
 *
 * SCOPED BY PROVENANCE ALONE. The DELETE predicate is
 * `migration_source_table = 'website_news_posts'`, so a hand-authored
 * Editorial post is not reachable by it under any circumstances, however
 * similar its content. There is no slug-based, title-based or date-based
 * clause anywhere in this function.
 *
 * WHAT GOES WITH IT, AND WHY IT IS SAFE. Deleting an editorial_posts row
 * cascades to its translations, its topic links, its revisions, its
 * placements entries and its relations (both directions) — every one of
 * those FKs is ON DELETE CASCADE by design. Nothing else in the schema
 * points at editorial_posts, so the delete is complete rather than
 * partial.
 *
 * WHAT IS DELIBERATELY NOT UNDONE:
 *   * admin_activity_logs rows. An audit log that can be erased by the
 *     thing it audits is not an audit log. The rollback WRITES its own
 *     entry instead, so "migrated then rolled back" is legible.
 *   * editorial_authors and editorial_topics. The migration never created
 *     any (it only ever points at rows a human made), so there is nothing
 *     of its own to remove — and deleting a human's author or topic
 *     because a migration once referenced it would be destroying data the
 *     migration does not own.
 *   * website_news_posts. Untouched by the migration in every mode, and
 *     therefore untouched by its rollback. The legacy table remains the
 *     live public source throughout.
 *
 * POST-ROLLBACK HUMAN EDITS. A post that has been edited since it was
 * migrated is reported by `planRollback` and, by default, REFUSES to be
 * deleted: rolling back a migration must not silently destroy work an
 * editor did on top of it. Forcing past that is a separate, explicit
 * operator decision.
 */
export interface RollbackCandidate {
  editorialPostId: number;
  sourceId: number;
  slug: string | null;
  title: string | null;
  status: string | null;
  /** True when the post no longer matches what the migration produced. */
  edited: boolean;
  editedReasons: string[];
}

export interface RollbackPlan {
  candidates: RollbackCandidate[];
  counts: { total: number; edited: number; deletable: number };
}

export async function deleteMigratedPosts(
  tx: DbClient,
  editorialPostIds: readonly number[],
): Promise<number> {
  if (editorialPostIds.length === 0) return 0;
  // Re-asserting the provenance predicate alongside the id list is not
  // redundant: it makes it impossible for a caller to hand this function
  // an id of a hand-authored post, whatever it computed upstream.
  const deleted = await tx
    .delete(editorialPostsTable)
    .where(
      and(
        inArray(editorialPostsTable.id, [...editorialPostIds]),
        eq(editorialPostsTable.migrationSourceTable, MIGRATION_SOURCE_TABLE),
      ),
    )
    .returning({ id: editorialPostsTable.id });
  return deleted.length;
}

/**
 * Relations pointing AT a post being rolled back are removed by the
 * cascade, but relations FROM a surviving post to a deleted one would be
 * too — which is correct, and stated here so the behaviour is not a
 * surprise: a recommendation whose target no longer exists cannot be kept.
 * Counted before the delete so the report can say how many disappear.
 */
export async function countIncomingRelations(
  client: DbClient,
  editorialPostIds: readonly number[],
): Promise<number> {
  if (editorialPostIds.length === 0) return 0;
  const rows = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(editorialPostRelationsTable)
    .where(inArray(editorialPostRelationsTable.targetPostId, [...editorialPostIds]));
  return rows[0]?.count ?? 0;
}
