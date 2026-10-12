/**
 * Performance ↔ News relation compatibility (Unified Website CMS, slice 2).
 *
 * Dedicated DISPOSABLE database, migrated from empty and seeded with the
 * Production capture; REAL routers behind the real auth middleware.
 *
 * - Public Performance detail resolves 'news' refs through the PUBLIC
 *   Editorial projection: a migrated story archived in Editorial disappears
 *   (it used to leak via legacy is_active=true); a native public story can
 *   be linked and renders with Editorial-native fields.
 * - Admin validateRelatedRefs accepts Editorial slugs OR legacy slugs (union).
 * - The picker endpoint lists only public News and is gated by
 *   website.performance:view, not website.posts.
 * The unchanged output for the existing saved refs is proven by
 * publicEditorialNews.golden.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrateWithPool, recreateDisposableDb, seedGoldenRows } from "../lib/__fixtures__/unifiedCmsTestDb";

process.env["DATABASE_URL"] = recreateDisposableDb("central_studio_disposable_unified_cms_performance");
process.env["NODE_ENV"] = "test";
delete process.env["REDIS_URL"];
delete process.env["PUSH_NOTIFICATIONS_ENABLED"];

const { pool } = await import("@workspace/db");
await migrateWithPool(pool);
await seedGoldenRows(pool);

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

let server: import("node:http").Server;
let port: number;
let jwtSign: (payload: object, secret: string) => string;
let performanceOnlyId: number;
let postsOnlyId: number;
let superId: number;

async function call(path: string, adminId?: number, isSuper = false, init: RequestInit = {}): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (adminId != null) {
    headers["x-api-key"] = "test-api-secret-key";
    headers["x-admin-token"] = jwtSign({ sub: adminId, username: `perf-${adminId}`, isSuperAdmin: isSuper, roleId: null }, ADMIN_JWT_SECRET);
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers });
  return { status: res.status, body: await res.json() };
}

async function createAdmin(name: string, permissions: Record<string, Record<string, boolean>> | null, isSuper = false) {
  let roleId: number | null = null;
  if (permissions) {
    roleId = (await pool.query(`INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`, [`perf-${name}`, JSON.stringify(permissions)])).rows[0].id;
  }
  return (await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, role_id, is_super_admin) VALUES ($1, $2, 'x', $1, $3, $4) RETURNING id`,
    [`perf-${name}`, `perf-${name}@example.invalid`, roleId, isSuper],
  )).rows[0].id as number;
}

async function nativeNews(slug: string, status: "published" | "draft"): Promise<number> {
  const { rows: [post] } = await pool.query(
    `INSERT INTO editorial_posts (channel, author_id, feature_image_url, news_category) VALUES ('news', 1, 'https://images.unsplash.com/native-hero.jpg', 'press') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO editorial_post_translations (post_id, language_id, channel, title, slug, deck, feature_image_alt, body, status, published_at, author_snapshot)
     VALUES ($1, (SELECT id FROM editorial_languages WHERE code = 'en'), 'news', $2, $3, 'Native deck', 'Alt', '{"blocks":[{"type":"paragraph","text":"Body."}]}'::jsonb, $4, $5, '{"name":"N","role":"R","avatarUrl":null,"biography":"B"}'::jsonb)`,
    [post.id, `Native ${slug}`, slug, status, status === "published" ? "2026-09-10T21:15:00Z" : null],
  );
  return post.id;
}

before(async () => {
  const express = (await import("express")).default;
  jwtSign = (await import("jsonwebtoken")).default.sign as never;
  const { requireAuth } = await import("../middlewares/auth");
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(requireAuth);
  app.use((await import("./websitePerformances")).default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;

  superId = await createAdmin("super", null, true);
  performanceOnlyId = await createAdmin("performance-only", { "website.performance": { view: true } });
  postsOnlyId = await createAdmin("posts-only", { "website.posts": { view: true, edit: true } });
  await nativeNews("native-public", "published");
  await nativeNews("native-draft", "draft");
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("authority leak fixed: a migrated story ARCHIVED in Editorial disappears from Performance pages even though its legacy row is still active", async () => {
  const before = (await call("/website/performances/yagp-2027")).body.relatedItems.map((item: Json) => item.slug);
  assert.deepEqual(before, ["news-1", "news-6", "spring-showcase"]);
  await pool.query(`UPDATE editorial_post_translations SET status = 'archived' WHERE slug = 'news-6'`);
  const { rows: [legacy] } = await pool.query(`SELECT is_active FROM website_news_posts WHERE slug = 'news-6'`);
  assert.equal(legacy.is_active, true);
  const afterArchive = (await call("/website/performances/yagp-2027")).body.relatedItems.map((item: Json) => item.slug);
  assert.deepEqual(afterArchive, ["news-1", "spring-showcase"]);
  await pool.query(`UPDATE editorial_post_translations SET status = 'published' WHERE slug = 'news-6'`);
});

test("a NATIVE public story can be linked from a Performance and renders with Editorial-native fields; a native draft cannot be seen", async () => {
  await pool.query(
    `UPDATE website_performances SET related_refs = '[{"type":"news","slug":"native-public"},{"type":"news","slug":"native-draft"},{"type":"performance","slug":"yagp-2027"}]'::jsonb WHERE slug = 'summer-showcase'`,
  );
  const related = (await call("/website/performances/summer-showcase")).body.relatedItems;
  assert.deepEqual(related[0], {
    type: "news", slug: "native-public", title: "Native native-public", subtitle: "Native deck",
    categoryLabel: "Press & Media", image: "https://images.unsplash.com/native-hero.jpg",
    // 21:15Z on Sep 10 is Sep 11 00:15 in Cairo.
    date: "September 11, 2026",
  });
  assert.deepEqual(related.map((item: Json) => item.slug), ["native-public", "yagp-2027"]);
});

test("admin validator: Editorial slugs (any state) and legacy slugs are both accepted; an unknown slug is a 400", async () => {
  const patch = (refs: unknown) => call("/admin/website/performances/spring-showcase", superId, true, { method: "PATCH", body: JSON.stringify({ relatedRefs: refs }) });
  const legacy = await patch([{ type: "news", slug: "news-2" }]);
  assert.equal(legacy.status, 200);
  const native = await patch([{ type: "news", slug: "native-public" }, { type: "news", slug: "native-draft" }]);
  assert.equal(native.status, 200);
  assert.deepEqual(native.body.relatedRefs, [{ type: "news", slug: "native-public" }, { type: "news", slug: "native-draft" }]);
  const unknown = await patch([{ type: "news", slug: "never-existed" }]);
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /never-existed/);
  // A legacy-only slug (no Editorial translation) still validates.
  await pool.query(
    `INSERT INTO website_news_posts (slug, category, category_label, title, subtitle, hero_image_url, published_date, published_at, author_name, author_role, content)
     SELECT 'legacy-only', category, category_label, title, subtitle, hero_image_url, published_date, published_at, author_name, author_role, content FROM website_news_posts WHERE slug = 'news-1'`,
  );
  assert.equal((await patch([{ type: "news", slug: "legacy-only" }])).status, 200);
});

test("picker: lists only PUBLIC News (migrated + native, newest first) and is gated by website.performance:view, not website.posts", async () => {
  const ok = await call("/admin/website/performance-news-options", performanceOnlyId);
  assert.equal(ok.status, 200);
  const slugs = ok.body.map((item: Json) => item.slug);
  assert.deepEqual(slugs, ["native-public", "news-1", "news-2", "news-3", "news-4", "news-5", "news-6"]);
  assert.deepEqual(ok.body.find((item: Json) => item.slug === "news-1"), {
    slug: "news-1", title: "Central Studio Dancers Sweep Top Honors at Youth America Grand Prix (YAGP) Finals",
    categoryLabel: "Competition & Awards", image: "https://images.unsplash.com/photo-1547153760-18fc86324498?auto=format&fit=crop&q=80&w=1200",
  });
  assert.equal((await call("/admin/website/performance-news-options", postsOnlyId)).status, 403);
  assert.equal((await call("/admin/website/performance-news-options")).status, 401);
});
