/**
 * DB-level tests for migrations 0135 (editorial_posts.news_category) and
 * 0136 (editorial_post_performance_refs) — Unified Website CMS slice 1.
 *
 * Runs against a dedicated DISPOSABLE local database that is first built
 * ONLY through 0134 (the Production head before this slice), seeded with
 * the real Production capture, and then brought forward with the REAL
 * drizzle migrator — so "apply over the current schema with real data" is
 * what is actually exercised. The fresh-apply path is exercised by every
 * other Unified CMS suite (they migrate an empty database end to end).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { migrateWithPool, recreateDisposableDb, seedGoldenRows } from "./__fixtures__/unifiedCmsTestDb";

process.env["DATABASE_URL"] = recreateDisposableDb("central_studio_disposable_unified_cms_migrations");
process.env["NODE_ENV"] = "test";
const { pool } = await import("@workspace/db");

after(async () => { await pool.end(); });

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../lib/db/migrations");

async function snapshot(table: string): Promise<string> {
  const { rows } = await pool.query(`SELECT to_jsonb(t) - 'news_category' AS row FROM "${table}" t ORDER BY id`);
  return JSON.stringify(rows);
}

async function expectPgError(sql: string, params: unknown[], code: string) {
  await assert.rejects(pool.query(sql, params), (err: { code?: string }) => err.code === code);
}

test("0135/0136 apply over the 0134 schema holding real data, without touching a single existing row", async () => {
  await migrateWithPool(pool, { throughTag: "0134_package_restriction_provenance" });
  await seedGoldenRows(pool);
  const tables = ["editorial_posts", "editorial_post_translations", "editorial_post_relations", "website_performances", "website_news_posts"];
  const before = await Promise.all(tables.map(snapshot));
  const { rows: [{ exists: refsBefore }] } = await pool.query(`SELECT to_regclass('editorial_post_performance_refs') IS NOT NULL AS exists`);
  assert.equal(refsBefore, false);

  await migrateWithPool(pool);

  assert.deepEqual(await Promise.all(tables.map(snapshot)), before);
  const { rows: categories } = await pool.query(`SELECT count(*)::int AS n, count(news_category)::int AS set FROM editorial_posts`);
  assert.deepEqual(categories[0], { n: 8, set: 0 });
  const { rows: [{ n: refs }] } = await pool.query(`SELECT count(*)::int AS n FROM editorial_post_performance_refs`);
  assert.equal(refs, 0);
  const { rows: [{ n: applied }] } = await pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
  assert.equal(applied, 137);
});

test("both migration files are idempotent: re-running them verbatim is a no-op", async () => {
  for (const file of ["0135_editorial_post_news_category.sql", "0136_editorial_post_performance_refs.sql"]) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) await pool.query(statement);
  }
  const { rows } = await pool.query(
    `SELECT conname FROM pg_constraint WHERE contype <> 'n' AND (conname LIKE 'editorial_post_performance_refs_%' OR conname = 'editorial_posts_news_category_not_blank') ORDER BY conname`,
  );
  assert.deepEqual(rows.map((row: { conname: string }) => row.conname), [
    "editorial_post_performance_refs_performance_id_fkey",
    "editorial_post_performance_refs_pkey",
    "editorial_post_performance_refs_position_non_negative",
    "editorial_post_performance_refs_post_id_fkey",
    "editorial_post_performance_refs_post_performance_unique",
    "editorial_posts_news_category_not_blank",
  ]);
  const { rows: indexes } = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'editorial_post_performance_refs' ORDER BY indexname`);
  assert.deepEqual(indexes.map((row: { indexname: string }) => row.indexname), [
    "editorial_post_performance_refs_performance_idx",
    "editorial_post_performance_refs_pkey",
    "editorial_post_performance_refs_post_performance_unique",
    "editorial_post_performance_refs_post_position_idx",
  ]);
});

test("news_category: NULL and any non-blank key are accepted by the DB; blank is refused (the allowed set is API-level)", async () => {
  await pool.query(`UPDATE editorial_posts SET news_category = 'awards' WHERE id = 7`);
  await pool.query(`UPDATE editorial_posts SET news_category = 'future-key' WHERE id = 7`);
  await expectPgError(`UPDATE editorial_posts SET news_category = '  ' WHERE id = 7`, [], "23514");
  await pool.query(`UPDATE editorial_posts SET news_category = NULL WHERE id = 7`);
});

test("performance refs: FK integrity, uniqueness, non-negative position, ordered read and both cascades", async () => {
  const { rows: [post] } = await pool.query(`INSERT INTO editorial_posts (channel) VALUES ('news') RETURNING id`);
  const { rows: perf } = await pool.query(`SELECT id FROM website_performances ORDER BY id`);
  await pool.query(
    `INSERT INTO editorial_post_performance_refs (post_id, performance_id, position) VALUES ($1, $2, 2), ($1, $3, 0), ($1, $4, 1)`,
    [post.id, perf[0].id, perf[1].id, perf[2].id],
  );
  const { rows: ordered } = await pool.query(`SELECT performance_id FROM editorial_post_performance_refs WHERE post_id = $1 ORDER BY position, id`, [post.id]);
  assert.deepEqual(ordered.map((row: { performance_id: number }) => row.performance_id), [perf[1].id, perf[2].id, perf[0].id]);

  await expectPgError(`INSERT INTO editorial_post_performance_refs (post_id, performance_id) VALUES ($1, $2)`, [post.id, perf[0].id], "23505");
  await expectPgError(`INSERT INTO editorial_post_performance_refs (post_id, performance_id) VALUES ($1, 999999)`, [post.id], "23503");
  await expectPgError(`INSERT INTO editorial_post_performance_refs (post_id, performance_id) VALUES (999999, $1)`, [perf[3].id], "23503");
  await expectPgError(`INSERT INTO editorial_post_performance_refs (post_id, performance_id, position) VALUES ($1, $2, -1)`, [post.id, perf[3].id], "23514");

  // Deleting a Performance (DBA-only; the app soft-deactivates) cascades its refs.
  await pool.query(`DELETE FROM website_performances WHERE id = $1`, [perf[0].id]);
  const { rows: [{ n: afterPerfDelete }] } = await pool.query(`SELECT count(*)::int AS n FROM editorial_post_performance_refs WHERE post_id = $1`, [post.id]);
  assert.equal(afterPerfDelete, 2);
  // Deleting the post cascades the rest.
  await pool.query(`DELETE FROM editorial_posts WHERE id = $1`, [post.id]);
  const { rows: [{ n: afterPostDelete }] } = await pool.query(`SELECT count(*)::int AS n FROM editorial_post_performance_refs`);
  assert.equal(afterPostDelete, 0);
});
