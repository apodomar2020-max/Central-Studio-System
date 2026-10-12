/**
 * GOLDEN regression gate for the public Website News + Performance
 * contracts (Unified Website CMS, slices 1–2).
 *
 * The fixtures in ./__fixtures__/unified-cms-golden are a READ-ONLY capture
 * of Production: the exact input rows (website_news_posts,
 * website_performances and every editorial_* table the projection reads —
 * 6 migrated posts + 2 native DRAFTS) and the exact public JSON the live API
 * served from them (`list.json`, `news-1..6.json`). The Performance detail
 * snapshots (`performance-<slug>.json`) were produced by the UNCHANGED
 * pre-slice code from those same rows before the resolver was touched.
 *
 * This suite seeds a FRESH, fully migrated disposable database with those
 * rows, boots the REAL public routers, issues real HTTP requests and
 * asserts deepEqual against the captured JSON. Nothing is normalized:
 * dates, labels, relation order, image URLs, author fields, gallery order
 * and body blocks are all compared byte-for-byte (as parsed JSON).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { goldenJson, migrateWithPool, recreateDisposableDb, seedGoldenRows } from "./__fixtures__/unifiedCmsTestDb";

const DB_NAME = "central_studio_disposable_unified_cms_golden";
process.env["DATABASE_URL"] = recreateDisposableDb(DB_NAME);
process.env["NODE_ENV"] = "test";
delete process.env["REDIS_URL"];

const { pool } = await import("@workspace/db");
await migrateWithPool(pool);
await seedGoldenRows(pool);

const express = (await import("express")).default;
const websiteNewsRouter = (await import("../routes/websiteNews")).default;
const websitePerformancesRouter = (await import("../routes/websitePerformances")).default;

let server: import("node:http").Server;
let port: number;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(websiteNewsRouter);
  app.use(websitePerformancesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

const GOLDEN_NEWS_SLUGS = ["news-1", "news-2", "news-3", "news-4", "news-5", "news-6"] as const;
const GOLDEN_PERFORMANCE_SLUGS = ["nutcracker-repertoire", "spring-showcase", "yagp-2027", "summer-showcase"] as const;

test("golden: GET /website/news equals the captured Production list exactly", async () => {
  const res = await get("/website/news");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, goldenJson("list.json"));
});

for (const slug of GOLDEN_NEWS_SLUGS) {
  test(`golden: GET /website/news/${slug} equals the captured Production detail exactly`, async () => {
    const res = await get(`/website/news/${slug}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, goldenJson(`${slug}.json`));
  });
}

test("golden: the two native DRAFTS (posts 7 and 8) are absent from the list and 404 on detail", async () => {
  const { rows } = await pool.query(`SELECT slug FROM editorial_post_translations WHERE post_id IN (7, 8) ORDER BY post_id`);
  assert.equal(rows.length, 2);
  const list = (await get("/website/news")).body as Array<{ slug: string }>;
  for (const { slug } of rows) {
    assert.equal(list.some((item) => item.slug === slug), false);
    assert.equal((await get(`/website/news/${encodeURIComponent(slug)}`)).status, 404);
  }
});

for (const slug of GOLDEN_PERFORMANCE_SLUGS) {
  test(`golden: GET /website/performances/${slug} equals the pre-slice snapshot exactly`, async () => {
    const res = await get(`/website/performances/${slug}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, goldenJson(`performance-${slug}.json`));
  });
}
