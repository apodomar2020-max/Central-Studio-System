/**
 * News → Editorial migration — END-TO-END integration tests.
 *
 * DISPOSABLE LOCAL POSTGRES ONLY. The URL below is asserted to be a
 * localhost host with a disposable-looking database name before anything
 * is imported, and DATABASE_URL is deliberately left unset in normal use
 * so that default applies. There is no code path here that can reach a
 * managed database.
 *
 * These exercise the real writer against the real schema, because the
 * properties that matter most cannot be tested with fakes:
 *
 *   * `published_at` preservation depends on the REAL publishTranslation
 *     path's `?? now()` rule and on a real timestamptz round-trip.
 *   * idempotency depends on the REAL partial unique index from migration
 *     0130 and on the real provenance probe.
 *   * "a Performance reference never becomes a recommendation" is only
 *     meaningful when asserted against the actual rows in
 *     editorial_post_relations.
 *   * the archive lifecycle, the gallery jsonb round-trip and the cascade
 *     behaviour of rollback are all database behaviour.
 *
 * Media validation is injected with `skipLiveCheck: true`: the shape,
 * protocol, credential and HOST-ALLOWLIST rules all still run in full (the
 * fixtures use a genuinely allowlisted host), only the live HEAD request
 * and DNS lookup are skipped. Nothing about the migration's own logic is
 * bypassed.
 */
import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";

const DATABASE_URL =
  process.env.NEWS_MIGRATION_TEST_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_news_migration`;

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);
process.env.DATABASE_URL = DATABASE_URL;

type DbClient = import("./dbTypes").DbClient;
type NewsMigrationManifest = import("./newsMigrationManifest").NewsMigrationManifest;

const {
  db,
  pool,
  editorialAuthorsTable,
  editorialLanguagesTable,
  editorialPlacementsTable,
  editorialPostRelationsTable,
  editorialPostTopicsTable,
  editorialPostTranslationsTable,
  editorialPostsTable,
  editorialTopicsTable,
  websiteNewsPostsTable,
} = await import("@workspace/db");
const { eq, sql } = await import("drizzle-orm");
const { parseNewsMigrationManifest } = await import("./newsMigrationManifest");
const { planNewsMigration, planIsExecutable } = await import("./newsMigrationPlanner");
const { executeNewsMigration, deleteMigratedPosts } = await import("./newsMigrationWriter");
const { verifyNewsMigration } = await import("./newsMigrationVerify");
const { planNewsMigrationRollback } = await import("./newsMigrationRollback");
const { readStoredGallery } = await import("./editorialGallery");

const HOST = "https://images.unsplash.com";
const WRITER_DEPS = { publishDeps: { media: { skipLiveCheck: true } } };

/** One transaction per legacy post — the real runner shape. */
const perPostTransaction = <T,>(fn: (tx: DbClient) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => fn(tx as unknown as DbClient));

let languageId = 0;
let authorVanceId = 0;
let authorVanceDirectorId = 0;
let topicYagpId = 0;

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function resetEditorial(): Promise<void> {
  // Truncating in FK order. website_news_posts is included ONLY because
  // this test seeds it; the migration itself never writes to it, which is
  // asserted explicitly further down.
  await db.execute(sql`
    TRUNCATE TABLE
      editorial_post_relations, editorial_placements, editorial_post_topics,
      editorial_post_revisions, editorial_post_translations, editorial_posts,
      editorial_topics, editorial_authors, editorial_languages,
      website_news_posts, admin_activity_logs
    RESTART IDENTITY CASCADE
  `);

  const [language] = await db
    .insert(editorialLanguagesTable)
    .values({ code: "en", name: "English", nativeName: "English", direction: "ltr", isDefault: true, isActive: true })
    .returning();
  languageId = language.id;

  const authors = await db
    .insert(editorialAuthorsTable)
    .values([
      {
        channel: "news",
        publicName: "Victoria Vance",
        role: "Artistic Director & Master Teacher",
        biography: "Victoria has directed the company since 2014.",
        status: "active",
      },
      {
        channel: "news",
        publicName: "Victoria Vance",
        role: "Artistic Director",
        biography: "Victoria has directed the company since 2014.",
        status: "active",
      },
    ])
    .returning();
  authorVanceId = authors[0].id;
  authorVanceDirectorId = authors[1].id;

  const [topic] = await db
    .insert(editorialTopicsTable)
    .values({ channel: "news", name: "YAGP", slug: "yagp", status: "active" })
    .returning();
  topicYagpId = topic.id;
}

async function seedSourceRows(): Promise<void> {
  await db.insert(websiteNewsPostsTable).values([
    {
      slug: "news-1",
      category: "awards",
      categoryLabel: "Awards & Recognition",
      title: "A triumph at YAGP",
      subtitle: "Four soloists, four offers.",
      heroImageUrl: `${HOST}/hero-1.jpg`,
      listingImageUrl: `${HOST}/listing-1.jpg`,
      publishedDate: "July 18, 2026",
      publishedAt: "2026-07-18T00:00:00.000Z",
      readTime: "4 min read",
      isFeatured: true,
      authorName: "Victoria Vance",
      authorRole: "Artistic Director & Master Teacher",
      tags: ["YAGP"],
      galleryImages: [`${HOST}/g1.jpg`, `${HOST}/g2.jpg`],
      content: {
        leadParagraph: "Lead paragraph.",
        sections: [
          {
            heading: "On the international stage",
            paragraphs: ["First paragraph.", "Second paragraph."],
            quote: { text: "They communicated true soul.", author: "Victoria Vance", role: "Artistic Director" },
            bulletPoints: ["Clara Dupont", "Julian Thorne"],
            image: `${HOST}/section-1.jpg`,
            imageCaption: "Clara during her winning solo.",
          },
        ],
      },
      // One news ref and one PERFORMANCE ref, interleaved on purpose.
      relatedRefs: [
        { type: "news", slug: "news-2" },
        { type: "performance", slug: "nutcracker-repertoire" },
      ],
      isActive: true,
    },
    {
      slug: "news-2",
      category: "auditions",
      categoryLabel: "Auditions & Masterclasses",
      title: "Audition dates announced",
      subtitle: "Registration is open.",
      heroImageUrl: `${HOST}/hero-2.jpg`,
      listingImageUrl: null,
      publishedDate: "July 05, 2026",
      publishedAt: "2026-07-05T00:00:00.000Z",
      readTime: "3 min read",
      isFeatured: false,
      authorName: "Victoria Vance",
      authorRole: "Artistic Director",
      tags: [],
      galleryImages: [],
      content: { leadParagraph: "Auditions open.", sections: [] },
      relatedRefs: [{ type: "news", slug: "news-1" }],
      isActive: true,
    },
    {
      // Soft-hidden in the legacy CMS: WAS public, now hidden.
      slug: "news-3",
      category: "events",
      categoryLabel: "Events",
      title: "A retired announcement",
      subtitle: "No longer shown.",
      heroImageUrl: `${HOST}/hero-3.jpg`,
      listingImageUrl: null,
      publishedDate: "June 01, 2026",
      publishedAt: "2026-06-01T00:00:00.000Z",
      readTime: null,
      isFeatured: false,
      authorName: "Victoria Vance",
      authorRole: "Artistic Director",
      tags: [],
      galleryImages: [],
      content: { leadParagraph: "Retired." , sections: [] },
      relatedRefs: [],
      isActive: false,
    },
  ]);
}

function manifest(overrides: Record<string, unknown> = {}): NewsMigrationManifest {
  return parseNewsMigrationManifest({
    manifestVersion: 1,
    sourceTable: "website_news_posts",
    targetChannel: "news",
    languageCode: "en",
    authors: [
      // The SAME PERSON under two roles, mapped to two DIFFERENT author
      // rows — the decision a human made, recorded explicitly.
      { sourceName: "Victoria Vance", sourceRole: "Artistic Director & Master Teacher", editorialAuthorId: authorVanceId },
      { sourceName: "Victoria Vance", sourceRole: "Artistic Director", editorialAuthorId: authorVanceDirectorId },
    ],
    topics: [{ sourceTag: "YAGP", editorialTopicId: topicYagpId }],
    featuredPlacement: { placementKey: "news-featured" },
    featureImageAlt: [
      { sourceSlug: "news-1", alt: "Dancers mid-leap on a lit stage." },
      { sourceSlug: "news-2", alt: "An empty studio with a barre." },
      { sourceSlug: "news-3", alt: "A closed theatre door." },
    ],
    bodyImageAlt: [{ sourceSlug: "news-1", sectionIndex: 0, alt: "A dancer in a white tutu, arms raised." }],
    galleryAlt: [
      { sourceSlug: "news-1", index: 0, alt: "The company bowing." },
      { sourceSlug: "news-1", index: 1, alt: "A dancer backstage." },
    ],
    ...overrides,
  });
}

const readOnly = <T,>(fn: (tx: DbClient) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return fn(tx as unknown as DbClient);
  });

async function runFullMigration() {
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  assert.equal(planIsExecutable(plan), true, JSON.stringify(plan.entries, null, 2));
  return executeNewsMigration(perPostTransaction, plan, manifest(), WRITER_DEPS);
}

before(async () => {
  await resetEditorial();
});

beforeEach(async () => {
  await resetEditorial();
  await seedSourceRows();
});

after(async () => {
  await pool.end();
});

// ─── DRY-RUN ─────────────────────────────────────────────────────────────────

test("dry-run plans every row and writes nothing at all", async () => {
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(editorialPostsTable);
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  const after = await db.select({ n: sql<number>`count(*)::int` }).from(editorialPostsTable);

  assert.deepEqual(plan.counts, { total: 3, create: 3, skip: 0, blocked: 0 });
  assert.equal(planIsExecutable(plan), true);
  assert.equal(before[0].n, after[0].n, "a dry-run must not create anything");
});

test("dry-run surfaces the cross-type preservation manifest without writing it anywhere", async () => {
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  assert.deepEqual(plan.crossTypePreservation, [
    { sourceSlug: "news-1", targetType: "performance", targetSlug: "nutcracker-repertoire", position: 1 },
  ]);
});

test("dry-run blocks the whole run when one manifest decision is missing", async () => {
  const plan = await readOnly((tx) =>
    planNewsMigration(tx, manifest({ galleryAlt: [{ sourceSlug: "news-1", index: 0, alt: "Only the first." }] })),
  );
  assert.equal(planIsExecutable(plan), false);
  assert.equal(plan.counts.blocked, 1);
});

test("dry-run blocks when a manifest author has no biography — publishing would be impossible", async () => {
  await db
    .update(editorialAuthorsTable)
    .set({ biography: null })
    .where(eq(editorialAuthorsTable.id, authorVanceId));
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  assert.equal(planIsExecutable(plan), false);
  assert.ok(plan.manifestBlockers.some((b) => /no biography/.test(b.message)));
});

// ─── EXECUTE ─────────────────────────────────────────────────────────────────

test("execute creates one Editorial post per legacy row, stamped with its provenance", async () => {
  const result = await runFullMigration();
  assert.equal(result.created.length, 3);

  const posts = await db.select().from(editorialPostsTable);
  assert.equal(posts.length, 3);
  for (const post of posts) {
    assert.equal(post.channel, "news");
    assert.equal(post.migrationSourceTable, "website_news_posts");
    assert.ok(post.migrationSourceId != null);
  }
});

test("execute PRESERVES the historical publication date through the real publish path", async () => {
  await runFullMigration();
  const [row] = await db
    .select()
    .from(editorialPostTranslationsTable)
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));
  assert.equal(row.status, "published");
  assert.equal(
    new Date(row.publishedAt!).toISOString(),
    "2026-07-18T00:00:00.000Z",
    "the legacy date must survive; a fresh now() would be today",
  );
});

test("a soft-hidden legacy row lands ARCHIVED, keeping the date it was really published", async () => {
  await runFullMigration();
  const [row] = await db
    .select()
    .from(editorialPostTranslationsTable)
    .where(eq(editorialPostTranslationsTable.slug, "news-3"));
  assert.equal(row.status, "archived", "is_active=false is hidden-but-once-public, not a draft");
  assert.equal(new Date(row.publishedAt!).toISOString(), "2026-06-01T00:00:00.000Z");
});

test("execute carries the gallery across with its order and its alt text", async () => {
  await runFullMigration();
  const [row] = await db
    .select()
    .from(editorialPostTranslationsTable)
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));
  assert.deepEqual(readStoredGallery(row.gallery).items, [
    { url: `${HOST}/g1.jpg`, alt: "The company bowing." },
    { url: `${HOST}/g2.jpg`, alt: "A dancer backstage." },
  ]);
});

test("execute maps the body, keeping the quote's speaker and role", async () => {
  await runFullMigration();
  const [row] = await db
    .select()
    .from(editorialPostTranslationsTable)
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));
  const blocks = (row.body as { blocks: Array<Record<string, unknown>> }).blocks;
  assert.deepEqual(blocks.map((b) => b.type), [
    "paragraph", "heading", "paragraph", "paragraph", "quote", "bulleted-list", "image",
  ]);
  assert.deepEqual(blocks.find((b) => b.type === "quote"), {
    type: "quote",
    text: "They communicated true soul.",
    attribution: "Victoria Vance",
    attributionRole: "Artistic Director",
  });
});

test("the same byline under two roles reaches the two author rows the manifest named", async () => {
  await runFullMigration();
  const rows = await db
    .select({ slug: editorialPostTranslationsTable.slug, authorId: editorialPostsTable.authorId })
    .from(editorialPostTranslationsTable)
    .innerJoin(editorialPostsTable, eq(editorialPostTranslationsTable.postId, editorialPostsTable.id));
  const bySlug = new Map(rows.map((row) => [row.slug, row.authorId]));
  assert.equal(bySlug.get("news-1"), authorVanceId);
  assert.equal(bySlug.get("news-2"), authorVanceDirectorId);
});

test("topics are assigned from the manifest and nothing else", async () => {
  await runFullMigration();
  const links = await db.select().from(editorialPostTopicsTable);
  assert.equal(links.length, 1, "only news-1 carries a tag");
  assert.equal(links[0].topicId, topicYagpId);
});

test("is_featured becomes a placement entry in the declared slot", async () => {
  await runFullMigration();
  const placements = await db.select().from(editorialPlacementsTable);
  assert.equal(placements.length, 1);
  assert.equal(placements[0].key, "news-featured");
  assert.equal(placements[0].channel, "news");
});

// ─── CROSS-TYPE PRESERVATION — the invariant, asserted against real rows ─────

test("a Performance reference NEVER becomes an Editorial recommendation", async () => {
  const result = await runFullMigration();

  const relations = await db
    .select({
      source: editorialPostRelationsTable.sourcePostId,
      target: editorialPostRelationsTable.targetPostId,
    })
    .from(editorialPostRelationsTable);

  // news-1 → news-2 and news-2 → news-1. The performance ref contributes
  // nothing: two source refs on news-1, but only one relation from it.
  assert.equal(relations.length, 2);

  const posts = await db.select().from(editorialPostsTable);
  const idBySourceId = new Map(posts.map((p) => [p.migrationSourceId, p.id]));
  const newsPosts = await db.select().from(websiteNewsPostsTable);
  const sourceIdBySlug = new Map(newsPosts.map((r) => [r.slug, r.id]));
  const news1 = idBySourceId.get(sourceIdBySlug.get("news-1")!)!;
  const news2 = idBySourceId.get(sourceIdBySlug.get("news-2")!)!;

  assert.deepEqual(
    relations.map((r) => `${r.source}->${r.target}`).sort(),
    [`${news1}->${news2}`, `${news2}->${news1}`].sort(),
  );

  // And it IS recorded, in the preservation manifest, with its position.
  assert.deepEqual(result.crossTypePreserved, [
    { sourceSlug: "news-1", targetType: "performance", targetSlug: "nutcracker-repertoire", position: 1 },
  ]);
});

test("no Editorial relation crosses a channel after a migration", async () => {
  await runFullMigration();
  const report = await readOnly((tx) => verifyNewsMigration(tx, manifest()));
  assert.equal(report.findings.filter((f) => f.code === "cross_channel_relation").length, 0);
});

// ─── SCOPE PROTECTION ────────────────────────────────────────────────────────

test("the migration never modifies website_news_posts", async () => {
  const before = await db.select().from(websiteNewsPostsTable).orderBy(websiteNewsPostsTable.id);
  await runFullMigration();
  const after = await db.select().from(websiteNewsPostsTable).orderBy(websiteNewsPostsTable.id);
  assert.deepEqual(after, before, "the legacy table is the live public source and must be untouched");
});

// ─── VERIFY ──────────────────────────────────────────────────────────────────

test("verify passes on a complete, untouched migration", async () => {
  await runFullMigration();
  const report = await readOnly((tx) => verifyNewsMigration(tx, manifest()));
  assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
  assert.equal(report.checked.migratedPosts, 3);
});

test("verify FAILS when a source row was never migrated", async () => {
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  // Migrate only the first row, simulating an interrupted run.
  await executeNewsMigration(
    perPostTransaction,
    { ...plan, entries: plan.entries.slice(0, 1) },
    manifest(),
    WRITER_DEPS,
  );
  const report = await readOnly((tx) => verifyNewsMigration(tx, manifest()));
  assert.equal(report.ok, false);
  assert.equal(report.findings.filter((f) => f.code === "source_row_not_migrated").length, 2);
});

test("verify FAILS when a recommendation was added by hand", async () => {
  await runFullMigration();
  const posts = await db.select().from(editorialPostsTable);
  await db.insert(editorialPostRelationsTable).values({
    sourcePostId: posts[0].id,
    targetPostId: posts[2].id,
    relationType: "recommended",
    position: 9,
  });
  const report = await readOnly((tx) => verifyNewsMigration(tx, manifest()));
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === "recommendation_count_mismatch"));
});

// ─── IDEMPOTENCY ─────────────────────────────────────────────────────────────

test("a second dry-run over a completed migration is all skips", async () => {
  await runFullMigration();
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  assert.deepEqual(plan.counts, { total: 3, create: 0, skip: 3, blocked: 0 });
});

test("a second EXECUTE writes nothing and creates no duplicate posts", async () => {
  await runFullMigration();
  const firstIds = (await db.select({ id: editorialPostsTable.id }).from(editorialPostsTable)).map((r) => r.id);

  const secondResult = await runFullMigration();
  assert.equal(secondResult.created.length, 0);
  assert.equal(secondResult.skipped.length, 3);

  const secondIds = (await db.select({ id: editorialPostsTable.id }).from(editorialPostsTable)).map((r) => r.id);
  assert.deepEqual(secondIds.sort(), firstIds.sort(), "no row may be migrated twice");
});

test("the database itself refuses a duplicate provenance pair (migration 0130)", async () => {
  await runFullMigration();
  const [post] = await db.select().from(editorialPostsTable);
  await assert.rejects(
    db.insert(editorialPostsTable).values({
      channel: "news",
      migrationSourceTable: post.migrationSourceTable,
      migrationSourceId: post.migrationSourceId,
    }),
    // Asserted on the INDEX NAME, reached through the driver's `cause`:
    // drizzle's own message is only "Failed query: …", so matching on that
    // would pass for any error at all and prove nothing.
    (err: unknown) => {
      const cause = (err as { cause?: { constraint?: string } }).cause;
      assert.equal(
        cause?.constraint,
        "editorial_posts_migration_source_unique",
        "idempotency must be a DATABASE guarantee (migration 0130), not only an application convention",
      );
      return true;
    },
  );
});

test("a hand-authored post keeps NULL provenance and is not affected by the unique index", async () => {
  // The partial index covers only migrated rows; two hand-authored posts
  // must remain perfectly legal.
  await db.insert(editorialPostsTable).values([{ channel: "news" }, { channel: "news" }]);
  const rows = await db.select().from(editorialPostsTable);
  assert.equal(rows.length, 2);
});

// ─── DRIFT: FAIL CLOSED ON POST-MIGRATION HUMAN EDITS ────────────────────────

test("an editor's change after migration BLOCKS a re-run instead of being reverted", async () => {
  await runFullMigration();
  await db
    .update(editorialPostTranslationsTable)
    .set({ deck: "An editor rewrote this deck." })
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));

  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  assert.equal(planIsExecutable(plan), false);
  const blocked = plan.entries.find((entry) => entry.action === "blocked");
  assert.ok(blocked && blocked.action === "blocked");
  assert.equal(blocked.blockers[0].code, "post_migration_drift");
  assert.match(blocked.blockers[0].message, /deck differs/);
  assert.match(blocked.blockers[0].remedy, /no update mode/);

  // And the editor's text is still there — nothing was reverted.
  const [row] = await db
    .select()
    .from(editorialPostTranslationsTable)
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));
  assert.equal(row.deck, "An editor rewrote this deck.");
});

test("a gallery REORDER after migration is detected as drift", async () => {
  await runFullMigration();
  await db
    .update(editorialPostTranslationsTable)
    .set({
      gallery: {
        items: [
          { url: `${HOST}/g2.jpg`, alt: "A dancer backstage." },
          { url: `${HOST}/g1.jpg`, alt: "The company bowing." },
        ],
      },
    })
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  const blocked = plan.entries.find((entry) => entry.action === "blocked");
  assert.ok(blocked && blocked.action === "blocked");
  assert.match(blocked.blockers[0].message, /gallery differs/);
});

// ─── SLUG COLLISIONS ─────────────────────────────────────────────────────────

test("an UNRELATED hand-authored post holding a legacy slug blocks the run", async () => {
  const [post] = await db.insert(editorialPostsTable).values({ channel: "news", authorId: authorVanceId }).returning();
  await db.insert(editorialPostTranslationsTable).values({
    postId: post.id,
    languageId,
    channel: "news",
    title: "Someone else's article",
    slug: "news-1",
    body: { blocks: [] },
  });

  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  assert.equal(planIsExecutable(plan), false);
  const blocked = plan.entries.find((entry) => entry.action === "blocked");
  assert.ok(blocked && blocked.action === "blocked");
  assert.equal(blocked.blockers[0].code, "slug_collision_unrelated");
});

test("a manifest slug override resolves a collision without renaming anyone's URL", async () => {
  const [post] = await db.insert(editorialPostsTable).values({ channel: "news", authorId: authorVanceId }).returning();
  await db.insert(editorialPostTranslationsTable).values({
    postId: post.id,
    languageId,
    channel: "news",
    title: "Someone else's article",
    slug: "news-1",
    body: { blocks: [] },
  });

  const resolved = manifest({ slugOverrides: [{ sourceSlug: "news-1", slug: "yagp-triumph-2026" }] });
  const plan = await readOnly((tx) => planNewsMigration(tx, resolved));
  assert.equal(planIsExecutable(plan), true);
  await executeNewsMigration(perPostTransaction, plan, resolved, WRITER_DEPS);

  // The existing post keeps its slug; the migrated one takes the new one.
  const slugs = (await db.select({ slug: editorialPostTranslationsTable.slug }).from(editorialPostTranslationsTable))
    .map((r) => r.slug)
    .sort();
  assert.ok(slugs.includes("news-1"));
  assert.ok(slugs.includes("yagp-triumph-2026"));
});

// ─── ROLLBACK ────────────────────────────────────────────────────────────────

test("rollback-dry-run lists every migrated post and deletes nothing", async () => {
  await runFullMigration();
  const report = await readOnly((tx) => planNewsMigrationRollback(tx, manifest(), { includeEdited: false }));
  assert.equal(report.counts.total, 3);
  assert.equal(report.counts.edited, 0);
  assert.equal(report.counts.deletable, 3);

  const still = await db.select({ n: sql<number>`count(*)::int` }).from(editorialPostsTable);
  assert.equal(still[0].n, 3, "a rollback DRY-RUN must not delete anything");
});

test("rollback PROTECTS a post an editor has changed since it was migrated", async () => {
  await runFullMigration();
  await db
    .update(editorialPostTranslationsTable)
    .set({ deck: "Edited after migration." })
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));

  const report = await readOnly((tx) => planNewsMigrationRollback(tx, manifest(), { includeEdited: false }));
  assert.equal(report.counts.edited, 1);
  assert.equal(report.counts.deletable, 2);

  await db.transaction(async (tx) =>
    deleteMigratedPosts(tx as unknown as DbClient, report.deletablePostIds),
  );

  const survivors = await db.select().from(editorialPostTranslationsTable);
  assert.equal(survivors.length, 1);
  assert.equal(survivors[0].slug, "news-1", "the edited post must survive a default rollback");
});

test("--include-edited deletes the edited post too, but only on that explicit decision", async () => {
  await runFullMigration();
  await db
    .update(editorialPostTranslationsTable)
    .set({ deck: "Edited after migration." })
    .where(eq(editorialPostTranslationsTable.slug, "news-1"));

  const report = await readOnly((tx) => planNewsMigrationRollback(tx, manifest(), { includeEdited: true }));
  assert.equal(report.counts.deletable, 3);
  await db.transaction(async (tx) =>
    deleteMigratedPosts(tx as unknown as DbClient, report.deletablePostIds),
  );
  const survivors = await db.select().from(editorialPostsTable);
  assert.equal(survivors.length, 0);
});

test("rollback deletes ONLY migrated posts, never a hand-authored one", async () => {
  await runFullMigration();
  const [handAuthored] = await db
    .insert(editorialPostsTable)
    .values({ channel: "news", authorId: authorVanceId })
    .returning();
  await db.insert(editorialPostTranslationsTable).values({
    postId: handAuthored.id,
    languageId,
    channel: "news",
    title: "Written in Admin",
    slug: "written-in-admin",
    body: { blocks: [] },
  });

  const report = await readOnly((tx) => planNewsMigrationRollback(tx, manifest(), { includeEdited: true }));
  assert.equal(report.candidates.some((c) => c.editorialPostId === handAuthored.id), false);

  // Even if the hand-authored id were handed in directly, the provenance
  // predicate in the DELETE makes it unreachable.
  const deleted = await db.transaction(async (tx) =>
    deleteMigratedPosts(tx as unknown as DbClient, [...report.deletablePostIds, handAuthored.id]),
  );
  assert.equal(deleted, 3);
  const survivors = await db.select().from(editorialPostsTable);
  assert.deepEqual(survivors.map((p) => p.id), [handAuthored.id]);
});

test("rollback leaves website_news_posts, authors and topics completely untouched", async () => {
  await runFullMigration();
  const newsBefore = await db.select().from(websiteNewsPostsTable).orderBy(websiteNewsPostsTable.id);

  const report = await readOnly((tx) => planNewsMigrationRollback(tx, manifest(), { includeEdited: true }));
  await db.transaction(async (tx) =>
    deleteMigratedPosts(tx as unknown as DbClient, report.deletablePostIds),
  );

  assert.deepEqual(await db.select().from(websiteNewsPostsTable).orderBy(websiteNewsPostsTable.id), newsBefore);
  assert.equal((await db.select().from(editorialAuthorsTable)).length, 2);
  assert.equal((await db.select().from(editorialTopicsTable)).length, 1);
  // The audit trail of the migration survives its own rollback.
  const logs = await db.execute(sql`SELECT count(*)::int AS n FROM admin_activity_logs`);
  assert.ok(Number((logs.rows[0] as { n: number }).n) > 0);
});

test("a migration can be re-run cleanly after a full rollback", async () => {
  await runFullMigration();
  const report = await readOnly((tx) => planNewsMigrationRollback(tx, manifest(), { includeEdited: true }));
  await db.transaction(async (tx) =>
    deleteMigratedPosts(tx as unknown as DbClient, report.deletablePostIds),
  );
  const again = await runFullMigration();
  assert.equal(again.created.length, 3);
  const verify = await readOnly((tx) => verifyNewsMigration(tx, manifest()));
  assert.equal(verify.ok, true, JSON.stringify(verify.findings, null, 2));
});

// ─── RESUMABILITY ────────────────────────────────────────────────────────────

test("an interrupted run keeps its committed posts and is completed by re-running", async () => {
  // Per-post transactions mean a failure at row 2 leaves row 1 committed.
  const plan = await readOnly((tx) => planNewsMigration(tx, manifest()));
  let seen = 0;
  await assert.rejects(
    executeNewsMigration(
      (fn) => {
        seen += 1;
        if (seen === 2) throw new Error("simulated interruption");
        return db.transaction(async (tx) => fn(tx as unknown as DbClient));
      },
      plan,
      manifest(),
      WRITER_DEPS,
    ),
    /simulated interruption/,
  );
  assert.equal((await db.select().from(editorialPostsTable)).length, 1, "the first post must have committed");

  // Re-running finishes the job, without duplicating the committed row.
  const result = await runFullMigration();
  assert.equal(result.created.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal((await db.select().from(editorialPostsTable)).length, 3);

  const verify = await readOnly((tx) => verifyNewsMigration(tx, manifest()));
  assert.equal(verify.ok, true, JSON.stringify(verify.findings, null, 2));
});
