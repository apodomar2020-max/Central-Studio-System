/**
 * NATIVE Editorial News publication (Unified Website CMS, slice 1).
 *
 * A dedicated DISPOSABLE database is migrated from empty, seeded with the
 * Production capture (6 migrated posts + 2 native drafts), and then native
 * posts are added on top. The REAL public News router and the REAL Admin
 * Editorial router are booted behind the real auth middleware.
 *
 * Covers: per-row eligibility (draft / archived / non-default language /
 * inactive language absent), a valid native post present in BOTH list and
 * detail with its category, Cairo date (incl. a near-midnight-UTC case),
 * read time (override and computed), topics, gallery, author snapshot,
 * featured placement, NULL-category fallback, related items (News
 * recommendations then Performance refs, public/active only), detail 404,
 * and the Admin contract: newsCategory on create/shared-update and the
 * performance-refs replace endpoint (permissions, validation, audit,
 * idempotency).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { goldenJson, migrateWithPool, recreateDisposableDb, seedGoldenRows } from "./__fixtures__/unifiedCmsTestDb";

process.env["DATABASE_URL"] = recreateDisposableDb("central_studio_disposable_unified_cms_native");
process.env["NODE_ENV"] = "test";
process.env["EDITORIAL_MEDIA_SKIP_LIVE_CHECK"] = "1";
delete process.env["REDIS_URL"];
delete process.env["PUSH_NOTIFICATIONS_ENABLED"];

const { pool } = await import("@workspace/db");
await migrateWithPool(pool);
await seedGoldenRows(pool);

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";
const IMG = "https://images.unsplash.com/photo-native-test.jpg";

let server: import("node:http").Server;
let port: number;
let jwtSign: (payload: object, secret: string) => string;
let superAdminId: number;
let viewerAdminId: number;
let noAccessAdminId: number;
let enId: number;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function get(path: string): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

async function admin(adminId: number, isSuper: boolean, path: string, init: RequestInit = {}): Promise<{ status: number; body: Json }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": jwtSign({ sub: adminId, username: `native-${adminId}`, isSuperAdmin: isSuper, roleId: null }, ADMIN_JWT_SECRET),
    },
  });
  return { status: res.status, body: await res.json() };
}
const asSuper = (path: string, init?: RequestInit) => admin(superAdminId, true, path, init);

async function createAdmin(name: string, permissions: Record<string, Record<string, boolean>> | null, isSuper = false) {
  let roleId: number | null = null;
  if (permissions) {
    const { rows } = await pool.query(`INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`, [`native-${name}`, JSON.stringify(permissions)]);
    roleId = rows[0].id;
  }
  const { rows } = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, role_id, is_super_admin) VALUES ($1, $2, 'x', $1, $3, $4) RETURNING id`,
    [`native-${name}`, `native-${name}@example.invalid`, roleId, isSuper],
  );
  return rows[0].id as number;
}

const AUTHOR_SNAPSHOT = { name: "Nadia Native", role: "Studio Writer", avatarUrl: "https://images.unsplash.com/photo-avatar.jpg", biography: "Writes." };

/** A native (no provenance) news post with ONE translation, inserted directly so assertions never depend on the route under test. */
async function nativePost(opts: {
  slug: string; status?: "draft" | "published" | "archived"; publishedAt?: string | null; languageId?: number;
  newsCategory?: string | null; contextLabel?: string | null; deck?: string | null; override?: number | null;
  body?: Json; gallery?: Json; listingImageUrl?: string | null;
}): Promise<number> {
  const { rows: [post] } = await pool.query(
    `INSERT INTO editorial_posts (channel, author_id, feature_image_url, news_category) VALUES ('news', 1, $1, $2) RETURNING id`,
    [IMG, opts.newsCategory ?? null],
  );
  await pool.query(
    `INSERT INTO editorial_post_translations
       (post_id, language_id, channel, title, slug, deck, context_label, feature_image_alt, body, status, published_at,
        reading_time_override_minutes, author_snapshot, listing_image_url, gallery)
     VALUES ($1, $2, 'news', $3, $4, $5, $6, 'Alt', $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13::jsonb)`,
    [
      post.id, opts.languageId ?? enId, `Title ${opts.slug}`, opts.slug, opts.deck === undefined ? `Deck ${opts.slug}` : opts.deck,
      opts.contextLabel ?? null, JSON.stringify(opts.body ?? { blocks: [{ type: "paragraph", text: "Lead words here." }] }),
      opts.status ?? "published", opts.publishedAt === undefined ? "2026-09-01T09:00:00Z" : opts.publishedAt,
      opts.override ?? null, JSON.stringify(AUTHOR_SNAPSHOT), opts.listingImageUrl ?? null,
      JSON.stringify(opts.gallery ?? { items: [] }),
    ],
  );
  return post.id;
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
let mainId: number;

before(async () => {
  const express = (await import("express")).default;
  jwtSign = (await import("jsonwebtoken")).default.sign as never;
  const { requireAuth } = await import("../middlewares/auth");
  const app = express();
  app.use(express.json());
  app.use((await import("../routes/websiteNews")).default);
  app.use(requireAuth);
  app.use((await import("../routes/adminEditorial")).default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;

  enId = (await pool.query(`SELECT id FROM editorial_languages WHERE code = 'en'`)).rows[0].id;
  superAdminId = await createAdmin("super", null, true);
  viewerAdminId = await createAdmin("viewer", { "website.posts": { view: true } });
  noAccessAdminId = await createAdmin("noaccess", { "website.performance": { view: true, edit: true } });

  // The fully-featured native post every "present" assertion reads.
  mainId = await nativePost({
    slug: "native-main", newsCategory: "auditions", contextLabel: null, override: null,
    body: { blocks: [{ type: "paragraph", text: words(330) }, { type: "heading", level: 2, text: words(20) }, { type: "bulleted-list", items: [words(50), words(30)] }, { type: "quote", text: words(20) }] },
    gallery: { items: [{ url: "https://images.unsplash.com/g1.jpg", alt: "One" }, { url: "https://images.unsplash.com/g2.jpg", alt: "Two" }] },
    publishedAt: "2026-07-04T22:30:00Z", listingImageUrl: "https://images.unsplash.com/listing.jpg",
  });
  const { rows: topics } = await pool.query(`SELECT id, name FROM editorial_topics WHERE channel = 'news' AND status = 'active' ORDER BY name LIMIT 2`);
  for (const topic of topics) await pool.query(`INSERT INTO editorial_post_topics (post_id, topic_id) VALUES ($1, $2)`, [mainId, topic.id]);
  // News recs: a public migrated post, then a DRAFT (must be dropped), then another public one.
  await pool.query(`INSERT INTO editorial_post_relations (source_post_id, target_post_id, position) VALUES ($1, 3, 0), ($1, 7, 1), ($1, 1, 2)`, [mainId]);
  // Performance refs: yagp (active) at 1, spring-showcase at 0, then summer-showcase made INACTIVE.
  await pool.query(
    `INSERT INTO editorial_post_performance_refs (post_id, performance_id, position)
     SELECT $1, id, CASE slug WHEN 'spring-showcase' THEN 0 WHEN 'yagp-2027' THEN 1 ELSE 2 END
     FROM website_performances WHERE slug IN ('spring-showcase', 'yagp-2027', 'summer-showcase')`,
    [mainId],
  );
  await pool.query(`UPDATE website_performances SET is_active = false WHERE slug = 'summer-showcase'`);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ─── Eligibility ────────────────────────────────────────────────────────────

test("draft and archived native posts are absent from the list and 404 on detail", async () => {
  await nativePost({ slug: "native-draft", status: "draft", publishedAt: null });
  await nativePost({ slug: "native-archived", status: "archived" });
  const list = (await get("/website/news")).body as Array<{ slug: string }>;
  for (const slug of ["native-draft", "native-archived"]) {
    assert.equal(list.some((item) => item.slug === slug), false, slug);
    assert.equal((await get(`/website/news/${slug}`)).status, 404, slug);
  }
});

test("a published translation in a NON-DEFAULT active language, or an INACTIVE language, is not public", async () => {
  const ar = (await pool.query(`INSERT INTO editorial_languages (code, name, native_name, direction, is_active, is_default, display_order) VALUES ('ar', 'Arabic', 'العربية', 'rtl', true, false, 1) RETURNING id`)).rows[0].id;
  const fr = (await pool.query(`INSERT INTO editorial_languages (code, name, native_name, direction, is_active, is_default, display_order) VALUES ('fr', 'French', 'Français', 'ltr', false, false, 2) RETURNING id`)).rows[0].id;
  await nativePost({ slug: "native-ar-only", languageId: ar });
  await nativePost({ slug: "native-fr-only", languageId: fr });
  const list = (await get("/website/news")).body as Array<{ slug: string }>;
  for (const slug of ["native-ar-only", "native-fr-only"]) {
    assert.equal(list.some((item) => item.slug === slug), false, slug);
    assert.equal((await get(`/website/news/${encodeURIComponent(slug)}`)).status, 404, slug);
  }
});

test("detail 404 for an unknown slug", async () => {
  assert.equal((await get("/website/news/no-such-story")).status, 404);
});

// ─── A valid native post ────────────────────────────────────────────────────

test("a published native post appears in the LIST with Editorial-native fields, and the six migrated posts are unchanged", async () => {
  const list = (await get("/website/news")).body as Json[];
  const item = list.find((entry) => entry.slug === "native-main");
  assert.deepEqual(item, {
    slug: "native-main", category: "auditions", categoryLabel: "Auditions & Masterclasses", title: "Title native-main",
    excerpt: "Deck native-main", image: "https://images.unsplash.com/listing.jpg",
    // 2026-07-04T22:30Z is 2026-07-05 01:30 in Cairo (UTC+3): a UTC formatter would say July 04.
    publishedDate: "July 05, 2026",
    // 330 + 20 + 80 + 20 = 450 words at 200 wpm -> ceil(2.25) = 3
    readTime: "3 min read", isFeatured: false,
  });
  const golden = goldenJson<Json[]>("list.json");
  assert.deepEqual(list.filter((entry) => golden.some((g) => g.slug === entry.slug)), golden);
});

test("the native post DETAIL carries category, Cairo date, read time, topics, gallery, author snapshot and content", async () => {
  const res = await get("/website/news/native-main");
  assert.equal(res.status, 200);
  const d = res.body;
  assert.equal(d.category, "auditions");
  assert.equal(d.categoryLabel, "Auditions & Masterclasses");
  assert.equal(d.publishedDate, "July 05, 2026");
  assert.equal(d.readTime, "3 min read");
  assert.equal(d.subtitle, "Deck native-main");
  assert.equal(d.heroImageUrl, IMG);
  assert.equal(d.authorName, "Nadia Native");
  assert.equal(d.authorRole, "Studio Writer");
  assert.equal(d.authorAvatarUrl, AUTHOR_SNAPSHOT.avatarUrl);
  assert.deepEqual(d.author, { name: "Nadia Native", role: "Studio Writer", avatarUrl: AUTHOR_SNAPSHOT.avatarUrl });
  assert.deepEqual(d.galleryImages, ["https://images.unsplash.com/g1.jpg", "https://images.unsplash.com/g2.jpg"]);
  assert.deepEqual(d.gallery.items.map((item: Json) => item.alt), ["One", "Two"]);
  const { rows: topics } = await pool.query(`SELECT t.name FROM editorial_post_topics pt JOIN editorial_topics t ON t.id = pt.topic_id WHERE pt.post_id = $1 ORDER BY t.name`, [mainId]);
  assert.equal(topics.length, 2);
  assert.deepEqual(d.tags, topics.map((topic: Json) => topic.name));
  assert.equal(d.content.leadParagraph, words(330));
  assert.equal(d.content.sections[0].heading, words(20));
});

test("native related items: public News recommendations by position (draft dropped), THEN active Performance refs by position", async () => {
  const d = (await get("/website/news/native-main")).body;
  const news3 = goldenJson<Json>("news-1.json").relatedItems.find((item: Json) => item.slug === "news-3");
  const news1 = goldenJson<Json>("news-2.json").relatedItems.find((item: Json) => item.slug === "news-1");
  const spring = goldenJson<Json>("performance-nutcracker-repertoire.json").relatedItems.find((item: Json) => item.slug === "spring-showcase");
  const yagp = goldenJson<Json>("performance-spring-showcase.json").relatedItems.find((item: Json) => item.slug === "yagp-2027");
  assert.ok(news3 && news1 && spring && yagp);
  // Same per-item shape and values the migrated path emits for these targets.
  assert.deepEqual(d.relatedItems, [news3, news1, spring, yagp]);
});

test("read time: the override wins; a tiny body is never below 1 minute", async () => {
  await nativePost({ slug: "native-override", override: 9, body: { blocks: [{ type: "paragraph", text: words(1000) }] } });
  await nativePost({ slug: "native-tiny", body: { blocks: [{ type: "paragraph", text: "Hi." }] } });
  assert.equal((await get("/website/news/native-override")).body.readTime, "9 min read");
  assert.equal((await get("/website/news/native-tiny")).body.readTime, "1 min read");
});

test("category label: a translation context label wins over the known label", async () => {
  await nativePost({ slug: "native-labelled", newsCategory: "press", contextLabel: "In the Press" });
  const d = (await get("/website/news/native-labelled")).body;
  assert.equal(d.category, "press");
  assert.equal(d.categoryLabel, "In the Press");
});

test("NULL news_category: still public, with the documented fallback (category 'news', label = context label or 'News'), deck null -> ''", async () => {
  await nativePost({ slug: "native-uncategorised", newsCategory: null, deck: null });
  await nativePost({ slug: "native-uncategorised-labelled", newsCategory: null, contextLabel: "Announcements" });
  const list = (await get("/website/news")).body as Json[];
  const plain = list.find((item) => item.slug === "native-uncategorised");
  assert.equal(plain.category, "news");
  assert.equal(plain.categoryLabel, "News");
  assert.equal(plain.excerpt, "");
  const detail = (await get("/website/news/native-uncategorised")).body;
  assert.equal(detail.subtitle, "");
  assert.equal(detail.category, "news");
  assert.equal(list.find((item) => item.slug === "native-uncategorised-labelled").categoryLabel, "Announcements");
});

test("featured placement works for a native post", async () => {
  const id = await nativePost({ slug: "native-featured" });
  await pool.query(`INSERT INTO editorial_placements (key, channel, post_id, position) VALUES ('featured', 'news', $1, 1)`, [id]);
  const list = (await get("/website/news")).body as Json[];
  assert.equal(list.find((item) => item.slug === "native-featured").isFeatured, true);
  assert.equal(list.find((item) => item.slug === "news-1").isFeatured, true);
});

test("list order is publishedAt DESC across migrated and native posts", async () => {
  const list = (await get("/website/news")).body as Json[];
  const { rows } = await pool.query(
    `SELECT t.slug FROM editorial_post_translations t JOIN editorial_posts p ON p.id = t.post_id JOIN editorial_languages l ON l.id = t.language_id
     WHERE t.status = 'published' AND l.is_default AND l.is_active AND p.channel = 'news' ORDER BY t.published_at DESC, p.id DESC`,
  );
  assert.deepEqual(list.map((item) => item.slug), rows.map((row: Json) => row.slug));
});

// ─── Admin: newsCategory ────────────────────────────────────────────────────

test("admin create: works with NO category (null), stores a valid one, rejects an unknown key and a category on an experience post", async () => {
  const none = await asSuper("/admin/editorial/posts", { method: "POST", body: JSON.stringify({ channel: "news" }) });
  assert.equal(none.status, 201);
  assert.equal(none.body.post.newsCategory, null);

  const withCat = await asSuper("/admin/editorial/posts", { method: "POST", body: JSON.stringify({ channel: "news", newsCategory: "events" }) });
  assert.equal(withCat.status, 201);
  assert.equal(withCat.body.post.newsCategory, "events");
  const { rows: audit } = await pool.query(`SELECT after FROM admin_activity_logs WHERE module = 'website.posts' AND action = 'create' AND entity_id = $1`, [String(withCat.body.post.id)]);
  assert.equal(audit[0].after.newsCategory, "events");

  assert.equal((await asSuper("/admin/editorial/posts", { method: "POST", body: JSON.stringify({ channel: "news", newsCategory: "gossip" }) })).status, 400);
  assert.equal((await asSuper("/admin/editorial/posts", { method: "POST", body: JSON.stringify({ channel: "experience", newsCategory: "events" }) })).status, 400);
});

test("admin shared update: sets and clears newsCategory with an audit row and (when published) a shared revision carrying the prior value", async () => {
  const set = await asSuper(`/admin/editorial/posts/${mainId}`, { method: "PATCH", body: JSON.stringify({ newsCategory: "awards" }) });
  assert.equal(set.status, 200);
  assert.equal(set.body.newsCategory, "awards");
  const { rows: audit } = await pool.query(
    `SELECT before, after FROM admin_activity_logs WHERE module = 'website.posts' AND action = 'news_category_changed' AND entity_id = $1`,
    [String(mainId)],
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].before.newsCategory, "auditions");
  assert.equal(audit[0].after.newsCategory, "awards");
  const { rows: revisions } = await pool.query(`SELECT snapshot FROM editorial_post_revisions WHERE post_id = $1 AND translation_id IS NULL ORDER BY revision_number DESC LIMIT 1`, [mainId]);
  assert.equal(revisions[0].snapshot.newsCategory, "auditions");
  assert.equal((await get("/website/news/native-main")).body.category, "awards");

  assert.equal((await asSuper(`/admin/editorial/posts/${mainId}`, { method: "PATCH", body: JSON.stringify({ newsCategory: "nope" }) })).status, 400);
  const back = await asSuper(`/admin/editorial/posts/${mainId}`, { method: "PATCH", body: JSON.stringify({ newsCategory: "auditions" }) });
  assert.equal(back.body.newsCategory, "auditions");
  const get1 = await asSuper(`/admin/editorial/posts/${mainId}`);
  assert.equal(get1.body.post.newsCategory, "auditions");
});

// ─── Admin: performance refs ────────────────────────────────────────────────

test("performance-refs: view permission reads, edit permission is required to write, other families are refused", async () => {
  const read = await admin(viewerAdminId, false, `/admin/editorial/posts/${mainId}/performance-refs`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.map((ref: Json) => [ref.performanceSlug, ref.position, ref.performanceIsActive]), [
    ["spring-showcase", 0, true], ["yagp-2027", 1, true], ["summer-showcase", 2, false],
  ]);
  assert.equal((await admin(viewerAdminId, false, `/admin/editorial/posts/${mainId}/performance-refs`, { method: "PUT", body: JSON.stringify({ items: [] }) })).status, 403);
  assert.equal((await admin(noAccessAdminId, false, `/admin/editorial/posts/${mainId}/performance-refs`)).status, 403);
});

test("performance-refs: duplicates, unknown, inactive, and a non-news post are clear 400s; unknown post is 404", async () => {
  const { rows: perf } = await pool.query(`SELECT id, slug, is_active FROM website_performances ORDER BY id`);
  const active = perf.filter((row: Json) => row.is_active);
  const inactive = perf.find((row: Json) => !row.is_active);
  const put = (id: number, items: unknown) => asSuper(`/admin/editorial/posts/${id}/performance-refs`, { method: "PUT", body: JSON.stringify({ items }) });

  const dup = await put(mainId, [{ performanceId: active[0].id }, { performanceId: active[0].id }]);
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /more than once/);
  const unknown = await put(mainId, [{ performanceId: 999999 }]);
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /not found/);
  const off = await put(mainId, [{ performanceId: inactive.id }]);
  assert.equal(off.status, 400);
  assert.match(off.body.error, /inactive/);
  const { rows: [exp] } = await pool.query(`INSERT INTO editorial_posts (channel) VALUES ('experience') RETURNING id`);
  assert.equal((await put(exp.id, [{ performanceId: active[0].id }])).status, 400);
  assert.equal((await put(999999, [])).status, 404);
  // Nothing was written by any rejected call.
  assert.equal((await asSuper(`/admin/editorial/posts/${mainId}/performance-refs`)).body.length, 3);
});

test("performance-refs: replace semantics, idempotent, ordered, audited — and the public order follows", async () => {
  const { rows: perf } = await pool.query(`SELECT id, slug FROM website_performances WHERE is_active ORDER BY id`);
  const body = JSON.stringify({ items: [{ performanceId: perf[2].id }, { performanceId: perf[0].id }] });
  const first = await asSuper(`/admin/editorial/posts/${mainId}/performance-refs`, { method: "PUT", body });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.map((ref: Json) => [ref.performanceId, ref.position]), [[perf[2].id, 0], [perf[0].id, 1]]);
  const second = await asSuper(`/admin/editorial/posts/${mainId}/performance-refs`, { method: "PUT", body });
  assert.deepEqual(second.body, first.body);
  const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM editorial_post_performance_refs WHERE post_id = $1`, [mainId]);
  assert.equal(n, 2);
  const { rows: audit } = await pool.query(
    `SELECT before, after FROM admin_activity_logs WHERE module = 'website.posts' AND action = 'performance_refs_changed' AND entity_id = $1 ORDER BY id`,
    [String(mainId)],
  );
  assert.equal(audit.length, 2);
  assert.deepEqual(audit[0].after.performanceRefs, [perf[2].id, perf[0].id]);
  const related = (await get("/website/news/native-main")).body.relatedItems as Json[];
  assert.deepEqual(related.filter((item) => item.type === "performance").map((item) => item.slug), [perf[2].slug, perf[0].slug]);
  assert.deepEqual(related.map((item) => item.type), ["news", "news", "performance", "performance"]);

  const cleared = await asSuper(`/admin/editorial/posts/${mainId}/performance-refs`, { method: "PUT", body: JSON.stringify({ items: [] }) });
  assert.deepEqual(cleared.body, []);
  assert.deepEqual((await get("/website/news/native-main")).body.relatedItems.map((item: Json) => item.type), ["news", "news"]);
});

test("the recommendations endpoint's existing request shape is unchanged and does not touch performance refs", async () => {
  const { rows: perf } = await pool.query(`SELECT id FROM website_performances WHERE is_active ORDER BY id LIMIT 1`);
  await asSuper(`/admin/editorial/posts/${mainId}/performance-refs`, { method: "PUT", body: JSON.stringify({ items: [{ performanceId: perf[0].id }] }) });
  const recs = await asSuper(`/admin/editorial/posts/${mainId}/recommendations`, { method: "PUT", body: JSON.stringify({ items: [{ targetPostId: 2 }] }) });
  assert.equal(recs.status, 200);
  assert.deepEqual(recs.body.map((rec: Json) => rec.targetPostId), [2]);
  assert.equal((await asSuper(`/admin/editorial/posts/${mainId}/performance-refs`)).body.length, 1);
});
