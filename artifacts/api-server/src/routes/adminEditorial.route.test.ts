/**
 * Real route + database integration tests for the Unified Editorial CMS
 * Wave 1.1 Admin CONTENT API (routes/adminEditorial.ts).
 *
 * Boots the ACTUAL Express router behind the ACTUAL global auth middleware,
 * issues real HTTP requests with real admin JWTs, and asserts on real rows
 * in a disposable local Postgres database — same convention as
 * websiteBranches.route.test.ts / adminBalletPaymentsTerminalState.route.test.ts.
 *
 * Website SETTINGS (Languages, Links) are covered by the sibling suite
 * adminEditorialSettings.route.test.ts, because they sit behind a different
 * permission family.
 *
 * WAVE 1 COVERAGE PRESERVED (updated for the multilingual shape, not
 * deleted): permission boundaries per action; the same slug accepted on the
 * other channel; published -> draft blocked; a published edit creating a
 * revision AND rolling back when the revision insert fails; topic
 * channel-mismatch / archived-topic; relation self / duplicate /
 * cross-channel; placement channel-mismatch / duplicate; media validation
 * (http, non-allowlisted host, missing image alt blocking publish);
 * oversized body; publish audit written in the same transaction.
 *
 * WAVE 1.1 COVERAGE ADDED: translation independence (status, publishedAt,
 * title, slug, body, alt per language; shared author/topics/feature image;
 * duplicate (post, language) rejected); slug generation, Unicode slugs,
 * collision suffixing, manual-slug conflict, post-publish immutability,
 * cross-channel same slug; author channel enforcement in BOTH directions;
 * feature image shared vs localized alt; lifecycle independence; revision
 * translation ISOLATION (an Arabic edit does not touch English; restoring
 * one does not clobber the other) and shared-field revision safety.
 *
 * The LIVE half of media validation (DNS + HEAD) is switched off for this
 * suite via the double-guarded NODE_ENV=test +
 * EDITORIAL_MEDIA_SKIP_LIVE_CHECK seam, so these tests make no outbound
 * network requests. The STATIC rules (https-only, host allowlist) are still
 * fully live and are asserted below.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL =
  process.env["EDITORIAL_TEST_DATABASE_URL"]
  ?? "postgres://localhost:5432/central_studio_disposable_editorial";

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

process.env["DATABASE_URL"] = DATABASE_URL;
process.env["NODE_ENV"] = "test";
process.env["EDITORIAL_MEDIA_SKIP_LIVE_CHECK"] = "1";
delete process.env["REDIS_URL"];
delete process.env["PUSH_NOTIFICATIONS_ENABLED"];

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";
const OK_IMAGE = "https://images.unsplash.com/photo-editorial-test.jpg";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: (typeof import("@workspace/db"))["pool"];
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let superAdminId: number;
/** Admin whose role grants view+create+edit+delete but NOT publish. */
let editorAdminId: number;
/** Admin whose role grants view only. */
let viewerAdminId: number;
/** Admin whose role grants nothing at all on website.posts. */
let noAccessAdminId: number;
const roleIds: number[] = [];
const adminIds: number[] = [];

/** Language ids, resolved in before(). 'en' is seeded by migration 0126. */
let enId: number;
let arId: number;

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

/**
 * `Response.json()` is typed `unknown`, and these are black-box assertions
 * against a real wire response whose shape is the thing under test — so the
 * body is read through one deliberately loose helper rather than ~80
 * separate casts. A wrong assumption about the shape still fails the
 * assertion at runtime, which is exactly what the test is for.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

function tokenFor(adminId: number, isSuperAdmin: boolean): string {
  return jwtSign({ sub: adminId, username: `editorial-${adminId}-${RUN}`, isSuperAdmin, roleId: null }, ADMIN_JWT_SECRET);
}

async function call(adminId: number, isSuper: boolean, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": tokenFor(adminId, isSuper),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const asSuper = (path: string, init?: RequestInit) => call(superAdminId, true, path, init);
const asEditor = (path: string, init?: RequestInit) => call(editorAdminId, false, path, init);
const asViewer = (path: string, init?: RequestInit) => call(viewerAdminId, false, path, init);
const asNoAccess = (path: string, init?: RequestInit) => call(noAccessAdminId, false, path, init);

async function createRole(name: string, permissions: Record<string, Record<string, boolean>>): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [name, JSON.stringify(permissions)],
  );
  roleIds.push(rows[0].id);
  return rows[0].id;
}

async function createAdmin(suffix: string, roleId: number | null, isSuperAdmin = false): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, role_id, is_super_admin)
     VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id`,
    [`editorial-${suffix}-${RUN}`, `editorial-${suffix}-${RUN}@example.invalid`, `Editorial ${suffix}`, roleId, isSuperAdmin],
  );
  adminIds.push(rows[0].id);
  return rows[0].id;
}

// ─── Fixture helpers (direct SQL, so a test never depends on the route it
//     is about to assert on) ────────────────────────────────────────────────

/** Channel-scoped author. `channel` is NOT NULL with no default in Wave 1.1. */
async function newAuthor(
  channel = "news",
  opts: { biography?: string | null; status?: string } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO editorial_authors (channel, public_name, role, biography, status)
     VALUES ($1, $2, 'Staff Writer', $3, $4) RETURNING id`,
    [
      channel,
      `Author ${RUN}-${Math.random().toString(36).slice(2, 7)}`,
      opts.biography === undefined ? "A bio." : opts.biography,
      opts.status ?? "active",
    ],
  );
  return rows[0].id;
}

async function newTopic(channel: string, status = "active"): Promise<number> {
  const slug = `t-${Math.random().toString(36).slice(2, 9)}`;
  const { rows } = await pool.query(
    `INSERT INTO editorial_topics (channel, name, slug, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [channel, slug, slug, status],
  );
  return rows[0].id;
}

const READY_BODY = { blocks: [{ type: "paragraph", text: "Opening night was electric." }] };

/** The shared post spine only. */
async function newPost(opts: {
  channel?: string;
  authorId?: number | null;
  featureImageUrl?: string | null;
} = {}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO editorial_posts (channel, author_id, feature_image_url) VALUES ($1, $2, $3) RETURNING id`,
    [
      opts.channel ?? "news",
      opts.authorId ?? null,
      opts.featureImageUrl === undefined ? OK_IMAGE : opts.featureImageUrl,
    ],
  );
  return rows[0].id;
}

/**
 * One translation. `channel` is passed but IRRELEVANT — the
 * sync_editorial_translation_channel trigger overwrites it from the parent
 * post, which several tests below assert on directly.
 */
async function newTranslation(
  postId: number,
  languageId: number,
  opts: {
    status?: string;
    title?: string;
    slug?: string;
    featureImageAlt?: string | null;
    body?: unknown;
    publishedAt?: string | null;
  } = {},
): Promise<number> {
  const slug = opts.slug ?? `p-${Math.random().toString(36).slice(2, 10)}`;
  const { rows } = await pool.query(
    `INSERT INTO editorial_post_translations
       (post_id, language_id, channel, title, slug, status, body, feature_image_alt, published_at)
     VALUES ($1, $2, 'news', $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
    [
      postId,
      languageId,
      opts.title ?? `Title ${slug}`,
      slug,
      opts.status ?? "draft",
      JSON.stringify(opts.body ?? READY_BODY),
      opts.featureImageAlt === undefined ? "A feature image" : opts.featureImageAlt,
      opts.publishedAt ?? null,
    ],
  );
  return rows[0].id;
}

/** A post with one publish-ready English draft translation. */
async function newReadyPost(channel = "news"): Promise<{ postId: number; translationId: number; authorId: number }> {
  const authorId = await newAuthor(channel);
  const postId = await newPost({ channel, authorId });
  const translationId = await newTranslation(postId, enId);
  return { postId, translationId, authorId };
}

async function translationRow(postId: number, languageId: number): Promise<{
  status: string; title: string; slug: string; featureImageAlt: string | null;
  publishedAt: string | null; publishedAtEpoch: number | null; body: { blocks: unknown[] };
}> {
  // published_at is read BOTH as Postgres' own text rendering (for a
  // null/not-null assertion) and as an epoch (for value comparison) —
  // Postgres' " +00" timestamptz text form is not parseable by JS's Date,
  // so comparing epochs is the only correct way to assert the value.
  const { rows } = await pool.query(
    `SELECT status, title, slug, feature_image_alt AS "featureImageAlt", body,
            published_at::text AS "publishedAt",
            extract(epoch FROM published_at)::float8 AS "publishedAtEpoch"
     FROM editorial_post_translations WHERE post_id = $1 AND language_id = $2`,
    [postId, languageId],
  );
  return rows[0];
}

async function revisionRows(postId: number): Promise<Array<{
  revision_number: number; translation_id: number | null; event_type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshot: any;
}>> {
  const { rows } = await pool.query(
    `SELECT revision_number, translation_id, event_type, snapshot
     FROM editorial_post_revisions WHERE post_id = $1 ORDER BY revision_number`,
    [postId],
  );
  return rows;
}

async function revisionCount(postId: number): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM editorial_post_revisions WHERE post_id = $1`, [postId]);
  return rows[0].n;
}

async function auditCount(action: string, entityId: number | string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM admin_activity_logs WHERE module = 'website.posts' AND action = $1 AND entity_id = $2`,
    [action, String(entityId)],
  );
  return rows[0].n;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const adminEditorialRouter = (await import("./adminEditorial")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(requireAuth);
  app.use(adminEditorialRouter);
  await new Promise<void>((resolvePromise) => {
    server = app.listen(0, "127.0.0.1", () => resolvePromise());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  // 'en' is seeded by migration 0126 as the active default. 'ar' is added
  // here (rtl) so every translation test has a second real language.
  const en = await pool.query(`SELECT id FROM editorial_languages WHERE code = 'en'`);
  enId = en.rows[0].id;
  const ar = await pool.query(
    `INSERT INTO editorial_languages (code, name, native_name, direction, is_active, is_default, display_order)
     VALUES ('ar', 'Arabic', 'العربية', 'rtl', true, false, 1)
     ON CONFLICT (code) DO UPDATE SET is_active = true
     RETURNING id`,
  );
  arId = ar.rows[0].id;

  superAdminId = await createAdmin("super", null, true);
  editorAdminId = await createAdmin(
    "editor",
    await createRole(`editorial-editor-${RUN}`, {
      "website.posts": { view: true, create: true, edit: true, delete: true },
    }),
  );
  viewerAdminId = await createAdmin(
    "viewer",
    await createRole(`editorial-viewer-${RUN}`, { "website.posts": { view: true } }),
  );
  noAccessAdminId = await createAdmin(
    "noaccess",
    await createRole(`editorial-noaccess-${RUN}`, { "website.news": { view: true, create: true, edit: true, delete: true } }),
  );
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  // FK-dependency order; every row created by this suite lives in the
  // editorial tables or in the two admin tables it seeded. Languages are
  // NOT deleted (the 'en' row is migration-seeded and ON DELETE RESTRICT
  // guards it anyway) — only the translations that reference them.
  await pool.query(`DELETE FROM editorial_post_revisions`);
  await pool.query(`DELETE FROM editorial_placements`);
  await pool.query(`DELETE FROM editorial_post_relations`);
  await pool.query(`DELETE FROM editorial_post_topics`);
  await pool.query(`DELETE FROM editorial_post_translations`);
  await pool.query(`DELETE FROM editorial_posts`);
  await pool.query(`DELETE FROM editorial_topics`);
  await pool.query(`DELETE FROM editorial_authors`);
  await pool.query(`DELETE FROM admin_activity_logs WHERE module = 'website.posts'`);
  if (adminIds.length > 0) await pool.query(`DELETE FROM system_users WHERE id = ANY($1::int[])`, [adminIds]);
  if (roleIds.length > 0) await pool.query(`DELETE FROM roles WHERE id = ANY($1::int[])`, [roleIds]);
  await pool.end();
});

// ─── Permission boundaries ──────────────────────────────────────────────────

test("permissions: unauthenticated requests are rejected before reaching the handler", async () => {
  const res = await fetch(apiUrl("/admin/editorial/posts"), { headers: { "x-api-key": "test-api-secret-key" } });
  assert.equal(res.status, 401);
});

test("permissions: an admin with no website.posts grant gets 403 on view", async () => {
  const res = await asNoAccess("/admin/editorial/posts");
  assert.equal(res.status, 403);
  assert.deepEqual((await json(res)).requiredPermission, { module: "website.posts", action: "view" });
});

test("permissions: website.news grants do NOT leak into website.posts", async () => {
  // noAccessAdmin holds FULL website.news permissions and still cannot
  // create an editorial post — proof the family is genuinely separate.
  const res = await asNoAccess("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news" }),
  });
  assert.equal(res.status, 403);
});

test("permissions: view-only admin can read but cannot create", async () => {
  assert.equal((await asViewer("/admin/editorial/posts")).status, 200);
  const res = await asViewer("/admin/editorial/posts", { method: "POST", body: JSON.stringify({ channel: "news" }) });
  assert.equal(res.status, 403);
  assert.deepEqual((await json(res)).requiredPermission, { module: "website.posts", action: "create" });
});

test("permissions: view-only admin cannot edit a translation", async () => {
  const { postId } = await newReadyPost();
  const res = await asViewer(`/admin/editorial/posts/${postId}/translations/en`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Edited by viewer" }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual((await json(res)).requiredPermission, { module: "website.posts", action: "edit" });
});

test("permissions: edit-level admin (no publish grant) cannot publish, archive, or restore a translation", async () => {
  const { postId } = await newReadyPost();
  for (const action of ["publish", "archive", "restore"]) {
    const res = await asEditor(`/admin/editorial/posts/${postId}/translations/en/${action}`, { method: "POST" });
    assert.equal(res.status, 403, `${action} must require website.posts:publish`);
    assert.deepEqual((await json(res)).requiredPermission, { module: "website.posts", action: "publish" });
  }
  assert.equal((await translationRow(postId, enId)).status, "draft", "a refused transition changes nothing");
});

test("permissions: edit-level admin CAN create a post with a translation and edit it", async () => {
  const authorId = await newAuthor("news");
  const res = await asEditor("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({
      channel: "news",
      authorId,
      featureImageUrl: OK_IMAGE,
      translation: { languageCode: "en", title: "Editor post", body: READY_BODY },
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(await json(res.clone())));
  const created = await json(res);
  assert.equal(created.translation.status, "draft", "creation always yields a draft translation");

  const patched = await asEditor(`/admin/editorial/posts/${created.post.id}/translations/en`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Editor post v2" }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await translationRow(created.post.id, enId)).title, "Editor post v2");
});

// ─── Slug architecture ──────────────────────────────────────────────────────

test("slug: is auto-generated from the title when omitted", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "en", title: `Opening Night ${RUN} — At Last!`, body: READY_BODY }),
  });
  assert.equal(res.status, 201);
  const slug = (await json(res)).slug;
  assert.match(slug, /^opening-night-/, "derived from the title");
  assert.ok(!slug.includes("—") && !slug.includes("!"), "punctuation is collapsed to hyphens");
  assert.ok(!slug.startsWith("-") && !slug.endsWith("-"), "no leading or trailing hyphen");
});

test("slug: an auto-generated collision gets a deterministic -2 / -3 suffix", async () => {
  const title = `Collision Title ${RUN}`;
  const slugs: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const postId = await newPost({ authorId: await newAuthor("news") });
    const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
      method: "POST",
      body: JSON.stringify({ languageCode: "en", title, body: READY_BODY }),
    });
    assert.equal(res.status, 201);
    slugs.push((await json(res)).slug);
  }
  assert.equal(slugs[1], `${slugs[0]}-2`);
  assert.equal(slugs[2], `${slugs[0]}-3`);
});

test("slug: a MANUALLY supplied slug that collides is a 409 and is never silently altered", async () => {
  const slug = `manual-${RUN}`;
  const firstPost = await newPost({ authorId: await newAuthor("news") });
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${firstPost}/translations`, {
      method: "POST",
      body: JSON.stringify({ languageCode: "en", title: "First", slug, body: READY_BODY }),
    })).status,
    201,
  );

  const secondPost = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${secondPost}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "en", title: "Second", slug, body: READY_BODY }),
  });
  assert.equal(res.status, 409, "a manual collision is a conflict, not a rename");
  assert.match((await json(res)).error, /already used/i);

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM editorial_post_translations WHERE post_id = $1`,
    [secondPost],
  );
  assert.equal(rows[0].n, 0, "nothing was created under a different slug");
});

test("slug: the SAME slug is allowed on the OTHER channel (uniqueness is per channel per language)", async () => {
  const slug = `cross-channel-${RUN}`;
  const newsPost = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const expPost = await newPost({ channel: "experience", authorId: await newAuthor("experience") });

  for (const postId of [newsPost, expPost]) {
    const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
      method: "POST",
      body: JSON.stringify({ languageCode: "en", title: "Same slug", slug, body: READY_BODY }),
    });
    assert.equal(res.status, 201, `${postId} must accept the slug`);
  }
  const { rows } = await pool.query(
    `SELECT channel FROM editorial_post_translations WHERE slug = $1 ORDER BY channel`,
    [slug],
  );
  assert.deepEqual(rows.map((r: { channel: string }) => r.channel), ["experience", "news"]);
});

test("slug: the SAME slug is allowed in a DIFFERENT language on the same channel", async () => {
  const slug = `same-slug-two-langs-${RUN}`;
  const postId = await newPost({ authorId: await newAuthor("news") });
  for (const languageCode of ["en", "ar"]) {
    const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
      method: "POST",
      body: JSON.stringify({ languageCode, title: `T ${languageCode}`, slug, body: READY_BODY }),
    });
    assert.equal(res.status, 201, `${languageCode} must accept the shared slug`);
  }
});

test("slug: Unicode — an Arabic title yields an Arabic slug, stored and read back byte-exactly", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "ar", title: "ليلة الافتتاح", body: READY_BODY }),
  });
  assert.equal(res.status, 201, JSON.stringify(await json(res.clone())));
  const slug = (await json(res)).slug;
  assert.equal(slug, "ليلة-الافتتاح", "no transliteration, no stripping — the script is preserved");

  const { rows } = await pool.query(
    `SELECT slug, slug = $2 AS exact FROM editorial_post_translations WHERE post_id = $1 AND language_id = $3`,
    [postId, "ليلة-الافتتاح", arId],
  );
  assert.equal(rows[0].exact, true, "the stored bytes equal the expected literal");
});

test("slug: a manual slug in a non-NFC normal form is rejected rather than silently rewritten", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  // "cafe" + COMBINING ACUTE ACCENT — visibly "café" but NFD, not NFC.
  const nfd = "café-story";
  assert.notEqual(nfd.normalize("NFC"), nfd, "fixture really is non-NFC");
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "en", title: "Cafe", slug: nfd, body: READY_BODY }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /NFC/i);
});

test("slug: an uppercase or punctuated manual slug is rejected with a specific message", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  for (const [slug, pattern] of [["Opening-Night", /lowercase/i], ["opening_night", /hyphens/i]] as const) {
    const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
      method: "POST",
      body: JSON.stringify({ languageCode: "en", title: "X", slug, body: READY_BODY }),
    });
    assert.equal(res.status, 400, slug);
    assert.match((await json(res)).error, pattern);
  }
});

test("slug: editable BEFORE first publish, immutable after", async () => {
  const { postId } = await newReadyPost();
  const before = await asSuper(`/admin/editorial/posts/${postId}/translations/en`, {
    method: "PATCH",
    body: JSON.stringify({ slug: `renamed-pre-publish-${RUN}` }),
  });
  assert.equal(before.status, 200, "pre-publish rename is allowed");
  assert.equal((await translationRow(postId, enId)).slug, `renamed-pre-publish-${RUN}`);
  assert.equal(await auditCount("translation_slug_changed", (await json(before)).id), 1, "the rename is audited");

  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);

  const afterPublish = await asSuper(`/admin/editorial/posts/${postId}/translations/en`, {
    method: "PATCH",
    body: JSON.stringify({ slug: `renamed-post-publish-${RUN}` }),
  });
  assert.equal(afterPublish.status, 409, "the URL is public — the slug is now immutable");
  assert.match((await json(afterPublish)).error, /already been published/i);
  assert.equal((await translationRow(postId, enId)).slug, `renamed-pre-publish-${RUN}`, "unchanged");
});

test("slug: immutability survives archiving (the URL was still public)", async () => {
  const { postId } = await newReadyPost();
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/archive`, { method: "POST" })).status, 200);
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en`, {
    method: "PATCH",
    body: JSON.stringify({ slug: `after-archive-${RUN}` }),
  });
  assert.equal(res.status, 409, "archiving must not reopen a published slug for editing");
});

// ─── Author channel scoping (both directions) ───────────────────────────────

test("authors: a news post cannot take an EXPERIENCE author", async () => {
  const res = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", authorId: await newAuthor("experience") }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel.*news post/i);
});

test("authors: an experience post cannot take a NEWS author", async () => {
  const res = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "experience", authorId: await newAuthor("news") }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /news channel.*experience post/i);
});

test("authors: reassigning a post to a cross-channel author is rejected on update too", async () => {
  const postId = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}`, {
    method: "PATCH",
    body: JSON.stringify({ authorId: await newAuthor("experience") }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel/i);
});

test("authors: a same-channel author is accepted in both channels", async () => {
  for (const channel of ["news", "experience"]) {
    const res = await asSuper("/admin/editorial/posts", {
      method: "POST",
      body: JSON.stringify({ channel, authorId: await newAuthor(channel) }),
    });
    assert.equal(res.status, 201, channel);
  }
});

test("authors: the DATABASE refuses a cross-channel byline even when the service layer is bypassed", async () => {
  // Proof the invariant is not merely an application convention: this goes
  // straight to SQL, past every route and service check.
  const expAuthor = await newAuthor("experience");
  await assert.rejects(
    () => pool.query(`INSERT INTO editorial_posts (channel, author_id) VALUES ('news', $1)`, [expAuthor]),
    /belongs to the experience channel/,
  );
});

test("authors: an archived author cannot be newly assigned", async () => {
  const res = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", authorId: await newAuthor("news", { status: "archived" }) }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /archived/i);
});

test("authors: the create route requires a channel", async () => {
  const res = await asSuper("/admin/editorial/authors", {
    method: "POST",
    body: JSON.stringify({ publicName: `No Channel ${RUN}`, role: "Writer" }),
  });
  assert.equal(res.status, 400);
});

test("authors: channel is not editable through the author PATCH route", async () => {
  const authorId = await newAuthor("news");
  const res = await asSuper(`/admin/editorial/authors/${authorId}`, {
    method: "PATCH",
    body: JSON.stringify({ channel: "experience", publicName: "Renamed" }),
  });
  assert.equal(res.status, 200, "the unknown field is simply not applied");
  const { rows } = await pool.query(`SELECT channel, public_name FROM editorial_authors WHERE id = $1`, [authorId]);
  assert.equal(rows[0].channel, "news", "channel is unchanged");
  assert.equal(rows[0].public_name, "Renamed", "the legitimate field did change");
});

test("authors: the DATABASE refuses changing an author's channel while a post carries the byline", async () => {
  const authorId = await newAuthor("news");
  await newPost({ channel: "news", authorId });
  await assert.rejects(
    () => pool.query(`UPDATE editorial_authors SET channel = 'experience' WHERE id = $1`, [authorId]),
    /cannot change channel/,
  );
});

test("authors: editing an author ENTITY never rewrites a published translation's frozen snapshot", async () => {
  const { postId, authorId } = await newReadyPost();
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);
  await pool.query(
    `UPDATE editorial_post_translations
     SET author_snapshot = jsonb_build_object('name','Frozen Name','role','Frozen Role','avatarUrl',null,'biography','Frozen bio')
     WHERE post_id = $1`,
    [postId],
  );

  assert.equal(
    (await asSuper(`/admin/editorial/authors/${authorId}`, {
      method: "PATCH",
      body: JSON.stringify({ publicName: "Renamed Entirely" }),
    })).status,
    200,
  );

  const { rows } = await pool.query(
    `SELECT author_snapshot FROM editorial_post_translations WHERE post_id = $1`,
    [postId],
  );
  assert.equal(rows[0].author_snapshot.name, "Frozen Name", "the frozen byline is untouched by an author-entity edit");
});

// ─── Post channel immutability + derived translation channel ────────────────

test("post channel is immutable, and each translation's channel is DERIVED from the parent", async () => {
  const postId = await newPost({ channel: "experience", authorId: await newAuthor("experience") });
  // The fixture helper deliberately sends channel='news'; the trigger must
  // overwrite it with the parent post's 'experience'.
  await newTranslation(postId, enId);
  const { rows } = await pool.query(
    `SELECT channel FROM editorial_post_translations WHERE post_id = $1`,
    [postId],
  );
  assert.equal(rows[0].channel, "experience", "the trigger derives channel from the post, not from the caller");

  await assert.rejects(
    () => pool.query(`UPDATE editorial_posts SET channel = 'news' WHERE id = $1`, [postId]),
    /channel is immutable/,
  );
});

// ─── Translation independence ───────────────────────────────────────────────

test("translations: two languages of one post hold independent title, slug, body and alt text", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "en", title: "Opening Night", slug: `en-independent-${RUN}`,
      featureImageAlt: "Dancers on stage", body: { blocks: [{ type: "paragraph", text: "English prose." }] },
    }),
  });
  await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "ar", title: "ليلة الافتتاح", slug: `ar-independent-${RUN}`,
      featureImageAlt: "راقصون على المسرح", body: { blocks: [{ type: "paragraph", text: "نص عربي." }] },
    }),
  });

  const en = await translationRow(postId, enId);
  const ar = await translationRow(postId, arId);
  assert.notEqual(en.title, ar.title);
  assert.notEqual(en.slug, ar.slug);
  assert.notEqual(en.featureImageAlt, ar.featureImageAlt);
  assert.notDeepEqual(en.body, ar.body);

  // ...while the SHARED spine is genuinely one value.
  const { rows } = await pool.query(
    `SELECT author_id, feature_image_url FROM editorial_posts WHERE id = $1`,
    [postId],
  );
  assert.ok(rows[0].author_id, "one byline for the logical post");
  assert.equal(rows[0].feature_image_url, OK_IMAGE, "one feature image URL for every language");
});

test("translations: a duplicate (post, language) is rejected with 409", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const body = JSON.stringify({ languageCode: "en", title: "First", body: READY_BODY });
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations`, { method: "POST", body })).status, 201);
  const dupe = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "en", title: "Second", body: READY_BODY }),
  });
  assert.equal(dupe.status, 409);
  assert.match((await json(dupe)).error, /already has a en translation/i);
});

test("translations: an unregistered language code is a 404", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "zz", title: "Nope", body: READY_BODY }),
  });
  assert.equal(res.status, 404);
  assert.match((await json(res)).error, /not registered/i);
});

test("translations: a language code is matched case-insensitively via canonicalization", async () => {
  const { postId } = await newReadyPost();
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/EN`)).status, 200);
});

// ─── Lifecycle independence ─────────────────────────────────────────────────

test("lifecycle: publishing English leaves Arabic a draft, with its own null publishedAt", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId);
  await newTranslation(postId, arId);

  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);

  const en = await translationRow(postId, enId);
  const ar = await translationRow(postId, arId);
  assert.equal(en.status, "published");
  assert.ok(en.publishedAt, "English stamped its own publishedAt");
  assert.equal(ar.status, "draft", "Arabic is untouched");
  assert.equal(ar.publishedAt, null, "Arabic has no publishedAt of its own yet");
});

test("lifecycle: each translation stamps its OWN publishedAt, and one publish never moves another's", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId);
  await newTranslation(postId, arId);

  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);
  const enFirst = (await translationRow(postId, enId)).publishedAtEpoch;

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/ar/publish`, { method: "POST" })).status, 200);

  const en = await translationRow(postId, enId);
  const ar = await translationRow(postId, arId);
  assert.equal(en.publishedAtEpoch, enFirst, "English's publishedAt did not move");
  assert.ok(ar.publishedAtEpoch! > enFirst!, "Arabic stamped its own, later instant");
});

test("lifecycle: archiving one translation leaves the other published", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId);
  await newTranslation(postId, arId);
  for (const code of ["en", "ar"]) {
    assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/${code}/publish`, { method: "POST" })).status, 200);
  }
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/ar/archive`, { method: "POST" })).status, 200);

  assert.equal((await translationRow(postId, enId)).status, "published", "English stays live");
  assert.equal((await translationRow(postId, arId)).status, "archived");
});

test("lifecycle: published -> draft is rejected (409) per translation; archive -> restore is the supported path", async () => {
  const { postId } = await newReadyPost();
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);

  const direct = await asSuper(`/admin/editorial/posts/${postId}/translations/en/restore`, { method: "POST" });
  assert.equal(direct.status, 409, "published -> draft must never be allowed");
  assert.match((await json(direct)).error, /Archive the translation first/i);
  assert.equal((await translationRow(postId, enId)).status, "published");

  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/archive`, { method: "POST" })).status, 200);
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/restore`, { method: "POST" })).status, 200);
  const restored = await translationRow(postId, enId);
  assert.equal(restored.status, "draft");
  assert.ok(restored.publishedAt, "publishedAt survives archive + restore");
});

test("lifecycle: re-publishing an archived translation preserves its original publishedAt", async () => {
  const original = "2029-05-05T10:00:00Z";
  const { postId } = await newReadyPost();
  await pool.query(
    `UPDATE editorial_post_translations SET status = 'archived', published_at = $2 WHERE post_id = $1`,
    [postId, original],
  );
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/restore`, { method: "POST" })).status, 200);
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);
  const row = await translationRow(postId, enId);
  assert.equal(row.status, "published");
  assert.equal(row.publishedAtEpoch, new Date(original).getTime() / 1000, "the original publication instant is preserved");
});

test("lifecycle: publishing an already-published translation is rejected as a no-op transition", async () => {
  const { postId } = await newReadyPost();
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status, 200);
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 409);
  assert.match((await json(res)).error, /already published/i);
});

// ─── Publish readiness gate ─────────────────────────────────────────────────

test("publish: a ready draft publishes, stamps publishedAt, and writes its audit row in the same transaction", async () => {
  const { postId, translationId } = await newReadyPost();
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 200, JSON.stringify(await json(res.clone())));
  const row = await translationRow(postId, enId);
  assert.equal(row.status, "published");
  assert.ok(row.publishedAt);
  assert.equal(await auditCount("translation_published", translationId), 1);
});

test("publish is blocked without an author on the parent post", async () => {
  const postId = await newPost({ authorId: null });
  await newTranslation(postId, enId);
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /needs an author/i);
  assert.equal((await translationRow(postId, enId)).status, "draft");
});

test("publish is blocked when the author has no biography", async () => {
  const postId = await newPost({ authorId: await newAuthor("news", { biography: null }) });
  await newTranslation(postId, enId);
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /no biography/i);
});

test("publish is blocked when the author is archived", async () => {
  const authorId = await newAuthor("news");
  const postId = await newPost({ authorId });
  await newTranslation(postId, enId);
  await pool.query(`UPDATE editorial_authors SET status = 'archived' WHERE id = $1`, [authorId]);
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /archived/i);
});

test("publish is blocked without the post's SHARED feature image, or without this translation's LOCALIZED alt", async () => {
  const noImage = await newPost({ authorId: await newAuthor("news"), featureImageUrl: null });
  await newTranslation(noImage, enId);
  assert.match(
    (await json(await asSuper(`/admin/editorial/posts/${noImage}/translations/en/publish`, { method: "POST" }))).error,
    /post needs a feature image/i,
  );

  const noAlt = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(noAlt, enId, { featureImageAlt: null });
  assert.match(
    (await json(await asSuper(`/admin/editorial/posts/${noAlt}/translations/en/publish`, { method: "POST" }))).error,
    /alt text for the feature image, in its own language/i,
  );
});

test("publish is blocked when an image block is missing alt text", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, {
    body: { blocks: [{ type: "paragraph", text: "x" }, { type: "image", url: OK_IMAGE, alt: "  " }] },
  });
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /image needs alt text/i);
  assert.equal((await translationRow(postId, enId)).status, "draft");
});

test("publish is blocked when the body has no blocks", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { body: { blocks: [] } });
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /at least one body block/i);
});

test("publish is blocked into an INACTIVE language, and the other language still publishes fine", async () => {
  // A throwaway language so deactivating it cannot affect other tests.
  const { rows } = await pool.query(
    `INSERT INTO editorial_languages (code, name, native_name, direction, is_active, display_order)
     VALUES ('fr', 'French', 'Français', 'ltr', true, 9)
     ON CONFLICT (code) DO UPDATE SET is_active = true RETURNING id`,
  );
  const frId = rows[0].id;

  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, frId);
  await newTranslation(postId, enId);
  await pool.query(`UPDATE editorial_languages SET is_active = false WHERE id = $1`, [frId]);

  const blocked = await asSuper(`/admin/editorial/posts/${postId}/translations/fr/publish`, { method: "POST" });
  assert.equal(blocked.status, 400);
  assert.match((await json(blocked)).error, /inactive/i);
  assert.equal((await translationRow(postId, frId)).status, "draft", "the stored status was not touched");

  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" })).status,
    200,
    "an active language is unaffected",
  );
});

test("translations: a NEW translation cannot be added in an inactive language, but the existing one is retained", async () => {
  const { rows } = await pool.query(
    `INSERT INTO editorial_languages (code, name, native_name, direction, is_active, display_order)
     VALUES ('de', 'German', 'Deutsch', 'ltr', false, 10)
     ON CONFLICT (code) DO UPDATE SET is_active = false RETURNING id`,
  );
  const deId = rows[0].id;

  const postId = await newPost({ authorId: await newAuthor("news") });
  const retained = await newTranslation(postId, deId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });

  const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "de", title: "Neu", body: READY_BODY }),
  });
  assert.ok(res.status === 400 || res.status === 409, `expected a refusal, got ${res.status}`);

  const { rows: kept } = await pool.query(
    `SELECT status FROM editorial_post_translations WHERE id = $1`,
    [retained],
  );
  assert.equal(kept[0].status, "published", "deactivating a language never rewrites existing content");
});

// ─── Revisions: translation isolation ───────────────────────────────────────

test("revisions: editing a PUBLISHED translation creates exactly one TRANSLATION-scoped revision of its pre-change state", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const enT = await newTranslation(postId, enId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });
  const before = await translationRow(postId, enId);
  assert.equal(await revisionCount(postId), 0);

  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Revised headline" }),
  });
  assert.equal(res.status, 200);

  const revs = await revisionRows(postId);
  assert.equal(revs.length, 1);
  assert.equal(revs[0].revision_number, 1);
  assert.equal(revs[0].event_type, "published_edit");
  assert.equal(revs[0].translation_id, enT, "the revision names the translation it belongs to");
  assert.equal(revs[0].snapshot.scope, "translation");
  assert.equal(revs[0].snapshot.title, before.title, "the snapshot holds the PRE-change title");
  assert.equal(revs[0].snapshot.languageCode, "en");

  const after_ = await translationRow(postId, enId);
  assert.equal(after_.title, "Revised headline");
  assert.equal(after_.publishedAt, before.publishedAt, "publishedAt never changes on edit");
});

test("revisions: editing a DRAFT translation creates no revision (a draft is working copy, not history)", async () => {
  const { postId } = await newReadyPost();
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}/translations/en`, {
      method: "PATCH", body: JSON.stringify({ title: "Draft v2" }),
    })).status,
    200,
  );
  assert.equal(await revisionCount(postId), 0);
});

test("revisions: ISOLATION — editing the Arabic translation does not touch English or create an English revision", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const enT = await newTranslation(postId, enId, { status: "published", title: "English Title", publishedAt: "2030-01-01T00:00:00Z" });
  const arT = await newTranslation(postId, arId, { status: "published", title: "العنوان العربي", publishedAt: "2030-01-01T00:00:00Z" });

  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}/translations/ar`, {
      method: "PATCH", body: JSON.stringify({ title: "عنوان منقّح" }),
    })).status,
    200,
  );

  assert.equal((await translationRow(postId, enId)).title, "English Title", "English prose is untouched");
  assert.equal((await translationRow(postId, arId)).title, "عنوان منقّح");

  const revs = await revisionRows(postId);
  assert.equal(revs.length, 1, "exactly one revision was written");
  assert.equal(revs[0].translation_id, arT, "and it is scoped to the ARABIC translation");
  assert.notEqual(revs[0].translation_id, enT);
  assert.equal(revs[0].snapshot.languageCode, "ar");
  assert.equal(revs[0].snapshot.title, "العنوان العربي", "the Arabic pre-change title");
});

test("revisions: restoring one language's revision does not clobber the other language", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", title: "EN original", publishedAt: "2030-01-01T00:00:00Z" });
  await newTranslation(postId, arId, { status: "published", title: "AR original", publishedAt: "2030-01-01T00:00:00Z" });

  // Edit BOTH so each has history, then restore only Arabic.
  for (const [code, title] of [["en", "EN changed"], ["ar", "AR changed"]] as const) {
    assert.equal(
      (await asSuper(`/admin/editorial/posts/${postId}/translations/${code}`, {
        method: "PATCH", body: JSON.stringify({ title }),
      })).status,
      200,
    );
  }

  const list = await json(await asSuper(`/admin/editorial/posts/${postId}/revisions?languageCode=ar`));
  assert.equal(list.length, 1, "the languageCode filter returns only Arabic history");
  assert.equal(list[0].languageCode, "ar");

  const restore = await asSuper(`/admin/editorial/posts/${postId}/revisions/${list[0].id}/restore`, { method: "POST" });
  assert.equal(restore.status, 200, JSON.stringify(await json(restore.clone())));

  assert.equal((await translationRow(postId, arId)).title, "AR original", "Arabic content is restored");
  assert.equal((await translationRow(postId, enId)).title, "EN changed", "English is NOT clobbered by the Arabic restore");
  assert.equal((await translationRow(postId, arId)).status, "published", "a revision restores CONTENT, never lifecycle");
});

test("revisions: restoring itself snapshots the pre-restore state, so it is undoable", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", title: "Original", publishedAt: "2030-01-01T00:00:00Z" });
  await asSuper(`/admin/editorial/posts/${postId}/translations/en`, { method: "PATCH", body: JSON.stringify({ title: "Changed" }) });

  const list = await json(await asSuper(`/admin/editorial/posts/${postId}/revisions`));
  assert.equal(list[0].snapshot, undefined, "the list is metadata only");
  const read = await json(await asSuper(`/admin/editorial/posts/${postId}/revisions/${list[0].id}`));
  assert.equal(read.snapshot.title, "Original");

  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/revisions/${list[0].id}/restore`, { method: "POST" })).status, 200);
  const revs = await revisionRows(postId);
  assert.equal(revs.length, 2);
  assert.equal(revs[1].event_type, "restore");
  assert.equal(revs[1].snapshot.title, "Changed", "the pre-restore state was captured");
});

test("revisions: a SHARED/post-scoped revision cannot be restored as a translation", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });
  // An author change produces a shared revision AND per-translation ones;
  // pick the shared one (translationId null) deliberately.
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}`, {
      method: "PATCH", body: JSON.stringify({ authorId: await newAuthor("news") }),
    })).status,
    200,
  );
  const { rows } = await pool.query(
    `SELECT id FROM editorial_post_revisions WHERE post_id = $1 AND translation_id IS NULL LIMIT 1`,
    [postId],
  );
  assert.ok(rows[0], "a shared revision exists");
  const res = await asSuper(`/admin/editorial/posts/${postId}/revisions/${rows[0].id}/restore`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /shared post change/i);
});

test("revisions: numbers are per-POST sequential across BOTH languages (one timeline per story)", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });
  await newTranslation(postId, arId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });
  for (const code of ["en", "ar", "en"]) {
    assert.equal(
      (await asSuper(`/admin/editorial/posts/${postId}/translations/${code}`, {
        method: "PATCH", body: JSON.stringify({ title: `t-${code}-${Math.random()}` }),
      })).status,
      200,
    );
  }
  const revs = await revisionRows(postId);
  assert.deepEqual(revs.map((r) => r.revision_number), [1, 2, 3], "no per-language numbering collision");
  assert.equal(new Set(revs.map((r) => r.translation_id)).size, 2, "both languages appear in the one timeline");
});

/**
 * The rollback guarantee, preserved from Wave 1. A temporary trigger makes
 * the revision insert FAIL, and the whole transaction (revision + mutation
 * + audit) must roll back with the translation left untouched.
 */
test("revisions: a published translation edit rolls back entirely when the revision insert fails", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", title: "Must survive", publishedAt: "2030-01-01T00:00:00Z" });
  const before = await translationRow(postId, enId);

  await pool.query(`
    CREATE OR REPLACE FUNCTION editorial_test_block_revision() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'editorial-test: revision insert blocked'; END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER editorial_test_block_revision_trg
      BEFORE INSERT ON editorial_post_revisions
      FOR EACH ROW WHEN (NEW.post_id = ${postId})
      EXECUTE FUNCTION editorial_test_block_revision();
  `);
  try {
    const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en`, {
      method: "PATCH",
      body: JSON.stringify({ title: "This must never land" }),
    });
    assert.equal(res.status, 500, "a failed revision write must not succeed as a 2xx");
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS editorial_test_block_revision_trg ON editorial_post_revisions`);
    await pool.query(`DROP FUNCTION IF EXISTS editorial_test_block_revision()`);
  }

  assert.equal((await translationRow(postId, enId)).title, before.title, "the mutation rolled back with the failed revision");
  assert.equal(await revisionCount(postId), 0, "no revision row was committed either");
});

test("revisions: revision restore requires website.posts:publish", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });
  await asSuper(`/admin/editorial/posts/${postId}/translations/en`, { method: "PATCH", body: JSON.stringify({ title: "x" }) });
  const list = await json(await asSuper(`/admin/editorial/posts/${postId}/revisions`));
  assert.equal((await asEditor(`/admin/editorial/posts/${postId}/revisions/${list[0].id}/restore`, { method: "POST" })).status, 403);
});

// ─── Shared-field changes ───────────────────────────────────────────────────

test("shared: changing the author on a post with a published translation is revision- and audit-safe, and non-destructive", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const enT = await newTranslation(postId, enId, { status: "published", title: "Keep this prose", publishedAt: "2030-01-01T00:00:00Z" });
  await pool.query(
    `UPDATE editorial_post_translations
     SET author_snapshot = jsonb_build_object('name','Old','role','Old','avatarUrl',null,'biography','Old')
     WHERE id = $1`,
    [enT],
  );
  const second = await newAuthor("news");

  const res = await asSuper(`/admin/editorial/posts/${postId}`, {
    method: "PATCH",
    body: JSON.stringify({ authorId: second }),
  });
  assert.equal(res.status, 200);

  const revs = await revisionRows(postId);
  // One SHARED revision of the spine, plus one TRANSLATION revision per
  // published translation whose frozen byline was refreshed.
  const shared = revs.filter((r) => r.translation_id === null);
  const perTranslation = revs.filter((r) => r.translation_id !== null);
  assert.equal(shared.length, 1, "the shared spine change is recorded once");
  assert.equal(shared[0].event_type, "author_change");
  assert.equal(shared[0].snapshot.scope, "shared");
  assert.ok(!("title" in shared[0].snapshot), "a shared snapshot holds no prose");
  assert.equal(perTranslation.length, 1, "each published translation's history records the byline refresh");
  assert.equal(perTranslation[0].translation_id, enT);

  const { rows } = await pool.query(`SELECT author_id FROM editorial_posts WHERE id = $1`, [postId]);
  assert.equal(rows[0].author_id, second);
  const { rows: t } = await pool.query(
    `SELECT title, author_snapshot FROM editorial_post_translations WHERE id = $1`,
    [enT],
  );
  assert.equal(t[0].title, "Keep this prose", "prose is untouched by a shared-field change");
  assert.notEqual(t[0].author_snapshot.name, "Old", "the frozen byline is regenerated from the new author");
  assert.equal(await auditCount("author_changed", postId), 1);
});

test("shared: an author change on a post with NO published translation writes no revision", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId); // draft
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}`, {
      method: "PATCH", body: JSON.stringify({ authorId: await newAuthor("news") }),
    })).status,
    200,
  );
  assert.equal(await revisionCount(postId), 0, "nothing was public, so there is no history to keep");
});

test("shared: changing the feature image URL is revision-safe and does NOT clear any translation's localized alt", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", featureImageAlt: "Dancers on stage", publishedAt: "2030-01-01T00:00:00Z" });
  await newTranslation(postId, arId, { status: "published", featureImageAlt: "راقصون على المسرح", publishedAt: "2030-01-01T00:00:00Z" });

  const replacement = "https://images.unsplash.com/photo-replacement.jpg";
  const res = await asSuper(`/admin/editorial/posts/${postId}`, {
    method: "PATCH",
    body: JSON.stringify({ featureImageUrl: replacement }),
  });
  assert.equal(res.status, 200);

  const { rows } = await pool.query(`SELECT feature_image_url FROM editorial_posts WHERE id = $1`, [postId]);
  assert.equal(rows[0].feature_image_url, replacement, "ONE shared image URL changed");
  assert.equal((await translationRow(postId, enId)).featureImageAlt, "Dancers on stage");
  assert.equal((await translationRow(postId, arId)).featureImageAlt, "راقصون على المسرح");

  const revs = await revisionRows(postId);
  assert.equal(revs.length, 1);
  assert.equal(revs[0].translation_id, null, "a feature-image change is a SHARED revision");
  assert.equal(revs[0].event_type, "shared_field_change");
  assert.equal(await auditCount("feature_image_changed", postId), 1);
});

// ─── Topics (shared across translations) ────────────────────────────────────

test("topics: a topic from the other channel is rejected", async () => {
  const postId = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/topics`, {
    method: "PUT",
    body: JSON.stringify({ topicIds: [await newTopic("experience")] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel/i);
});

test("topics: an archived topic cannot be newly assigned", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/topics`, {
    method: "PUT",
    body: JSON.stringify({ topicIds: [await newTopic("news", "archived")] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /archived/i);
});

test("topics: a duplicate topic id in one payload is rejected", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const topicId = await newTopic("news");
  const res = await asSuper(`/admin/editorial/posts/${postId}/topics`, {
    method: "PUT",
    body: JSON.stringify({ topicIds: [topicId, topicId] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /more than once/i);
});

test("topics: are SHARED by every translation, and a change on a published post writes a SHARED revision", async () => {
  const topicId = await newTopic("news");
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });
  await newTranslation(postId, arId, { status: "draft" });

  const res = await asSuper(`/admin/editorial/posts/${postId}/topics`, {
    method: "PUT",
    body: JSON.stringify({ topicIds: [topicId] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await json(res)).map((t: { id: number }) => t.id), [topicId]);

  // One topic set for the post, not one per language.
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM editorial_post_topics WHERE post_id = $1`,
    [postId],
  );
  assert.equal(rows[0].n, 1, "topics are attached to the post, once");

  const revs = await revisionRows(postId);
  assert.equal(revs.length, 1);
  assert.equal(revs[0].event_type, "topics_change");
  assert.equal(revs[0].translation_id, null, "post-scoped, because topics are not localized");
  assert.equal(await auditCount("topics_changed", postId), 1);
});

// ─── Recommendations ────────────────────────────────────────────────────────

test("recommendations: self-reference is rejected", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: postId }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /cannot recommend itself/i);
});

test("recommendations: a duplicate target is rejected", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const target = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: target }, { targetPostId: target }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /more than once/i);
});

test("recommendations: a cross-channel target is rejected", async () => {
  const postId = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const target = await newPost({ channel: "experience", authorId: await newAuthor("experience") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: target }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel/i);
});

test("recommendations: a same-channel target is accepted, order is preserved, and the label comes from the target's translation", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const a = await newPost({ authorId: await newAuthor("news") });
  const b = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(a, enId, { title: "Target A" });
  await newTranslation(b, enId, { title: "Target B" });

  const res = await asSuper(`/admin/editorial/posts/${postId}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: b }, { targetPostId: a }] }),
  });
  assert.equal(res.status, 200);
  const items = await json(res);
  assert.deepEqual(items.map((r: { targetPostId: number }) => r.targetPostId), [b, a]);
  assert.deepEqual(items.map((r: { targetTitle: string }) => r.targetTitle), ["Target B", "Target A"]);
  assert.equal(items[0].targetLanguageCode, "en");
  assert.equal(await auditCount("recommendations_changed", postId), 1);
});

// ─── Placements ─────────────────────────────────────────────────────────────

test("placements: a post from the other channel is rejected", async () => {
  const postId = await newPost({ channel: "experience", authorId: await newAuthor("experience") });
  const res = await asSuper(`/admin/editorial/placements?key=news-hero-${RUN}`, {
    method: "PUT",
    body: JSON.stringify({ channel: "news", items: [{ postId }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel/i);
});

test("placements: the same post twice in one placement is rejected", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/placements?key=dupe-${RUN}`, {
    method: "PUT",
    body: JSON.stringify({ channel: "news", items: [{ postId }, { postId }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /at most once/i);
});

test("placements: a valid placement round-trips in position order and is audited", async () => {
  const key = `news-hero-ok-${RUN}`;
  const a = await newPost({ authorId: await newAuthor("news") });
  const b = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(a, enId, { title: "Placed A" });
  await newTranslation(b, enId, { title: "Placed B" });

  const res = await asSuper(`/admin/editorial/placements?key=${key}`, {
    method: "PUT",
    body: JSON.stringify({ channel: "news", items: [{ postId: b }, { postId: a }] }),
  });
  assert.equal(res.status, 200);
  const read = await json(await asSuper(`/admin/editorial/placements?channel=news&key=${key}`));
  assert.deepEqual(read.map((e: { postId: number }) => e.postId), [b, a]);
  assert.deepEqual(read.map((e: { postTitle: string }) => e.postTitle), ["Placed B", "Placed A"]);
  // The audited entity is the SLOT, and a slot is (channel, key) — Wave 2.0.
  assert.equal(await auditCount("placement_changed", `news:${key}`), 1);
});

// ─── Issue #23: placements are scoped by (channel, key), never key alone ─────
//
// `key` is free text and "featured" is the obvious slot name in BOTH
// channels. Wave 1 identified a slot by `key` alone in the UNIQUE, the
// index, the service DELETE predicate and the route SELECT predicate, so
// news:featured and experience:featured were one slot: writing either
// destroyed the other, and reading either returned both interleaved.
//
// Each test below asserts on the REAL ROWS as well as the wire response, so
// a fix that merely filtered the response while still deleting the other
// channel's rows would fail.

async function placementRows(channel: string, key: string): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT post_id FROM editorial_placements WHERE channel = $1 AND key = $2 ORDER BY position, id`,
    [channel, key],
  );
  return rows.map((row: { post_id: number }) => row.post_id);
}

/** PUT a slot; returns the response so a caller can assert on its status. */
function putPlacement(channel: string, key: string, postIds: number[]): Promise<Response> {
  return asSuper(`/admin/editorial/placements?channel=${channel}&key=${key}`, {
    method: "PUT",
    body: JSON.stringify({ channel, items: postIds.map((postId) => ({ postId })) }),
  });
}

test("placements #23: the same key is usable in BOTH channels at once", async () => {
  const key = `shared-featured-a-${RUN}`;
  const newsPost = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const expPost = await newPost({ channel: "experience", authorId: await newAuthor("experience") });

  assert.equal((await putPlacement("news", key, [newsPost])).status, 200);
  assert.equal((await putPlacement("experience", key, [expPost])).status, 200);

  // Both slots exist independently, in the database, under the same key.
  assert.deepEqual(await placementRows("news", key), [newsPost]);
  assert.deepEqual(await placementRows("experience", key), [expPost]);
});

test("placements #23: replacing a slot in one channel leaves the other channel's rows untouched", async () => {
  const key = `shared-featured-b-${RUN}`;
  const newsA = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const newsB = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const expA = await newPost({ channel: "experience", authorId: await newAuthor("experience") });

  await putPlacement("news", key, [newsA, newsB]);
  await putPlacement("experience", key, [expA]);

  // Re-curate the EXPERIENCE slot — under Wave 1 this DELETEd the news rows.
  assert.equal((await putPlacement("experience", key, [])).status, 200);

  assert.deepEqual(await placementRows("news", key), [newsA, newsB], "news slot survived an experience write");
  assert.deepEqual(await placementRows("experience", key), []);
});

test("placements #23: clearing a slot in one channel does not clear the other", async () => {
  const key = `shared-featured-c-${RUN}`;
  const newsA = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const expA = await newPost({ channel: "experience", authorId: await newAuthor("experience") });

  await putPlacement("news", key, [newsA]);
  await putPlacement("experience", key, [expA]);
  assert.equal((await putPlacement("news", key, [])).status, 200);

  assert.deepEqual(await placementRows("news", key), []);
  assert.deepEqual(await placementRows("experience", key), [expA], "experience slot survived a news clear");
});

test("placements #23: a read in one channel never returns the other channel's entries", async () => {
  const key = `shared-featured-d-${RUN}`;
  const newsA = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const expA = await newPost({ channel: "experience", authorId: await newAuthor("experience") });
  await newTranslation(newsA, enId, { title: "News entry" });
  await newTranslation(expA, enId, { title: "Experience entry" });

  await putPlacement("news", key, [newsA]);
  await putPlacement("experience", key, [expA]);

  const newsRead = await json(await asSuper(`/admin/editorial/placements?channel=news&key=${key}`));
  const expRead = await json(await asSuper(`/admin/editorial/placements?channel=experience&key=${key}`));

  assert.deepEqual(newsRead.map((e: { postId: number }) => e.postId), [newsA]);
  assert.deepEqual(expRead.map((e: { postId: number }) => e.postId), [expA]);
  assert.ok(newsRead.every((e: { channel: string }) => e.channel === "news"));
  assert.ok(expRead.every((e: { channel: string }) => e.channel === "experience"));
});

test("placements #23: a read without a channel is rejected", async () => {
  const res = await asSuper(`/admin/editorial/placements?key=anything-${RUN}`);
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /channel/i);
});

test("placements #23: duplicate post in the SAME channel+key is still rejected", async () => {
  const key = `same-channel-dupe-${RUN}`;
  const postId = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const res = await putPlacement("news", key, [postId, postId]);
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /at most once/i);
});

test("placements #23: each channel's slot is audited as its own entity", async () => {
  const key = `audit-scope-${RUN}`;
  const newsA = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const expA = await newPost({ channel: "experience", authorId: await newAuthor("experience") });
  await putPlacement("news", key, [newsA]);
  await putPlacement("experience", key, [expA]);

  assert.equal(await auditCount("placement_changed", `news:${key}`), 1);
  assert.equal(await auditCount("placement_changed", `experience:${key}`), 1);
});

test("placements #23: CONCURRENT writes to the same key in different channels both succeed", async () => {
  // Before the fix these two requests raced for the same rows and one
  // silently destroyed the other's work. After it they touch disjoint row
  // sets under disjoint (channel, key) predicates, so both must commit
  // fully — no interleaving, no lost update, no deadlock.
  const key = `concurrent-${RUN}`;
  const newsA = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const newsB = await newPost({ channel: "news", authorId: await newAuthor("news") });
  const expA = await newPost({ channel: "experience", authorId: await newAuthor("experience") });
  const expB = await newPost({ channel: "experience", authorId: await newAuthor("experience") });

  const [newsRes, expRes] = await Promise.all([
    putPlacement("news", key, [newsA, newsB]),
    putPlacement("experience", key, [expA, expB]),
  ]);

  assert.equal(newsRes.status, 200);
  assert.equal(expRes.status, 200);
  assert.deepEqual(await placementRows("news", key), [newsA, newsB]);
  assert.deepEqual(await placementRows("experience", key), [expA, expB]);
});

test("placements #23: permission behavior is unchanged by channel scoping", async () => {
  const key = `perm-${RUN}`;
  // view-only may READ but not WRITE; no-access may do neither.
  assert.equal((await asViewer(`/admin/editorial/placements?channel=news&key=${key}`)).status, 200);
  assert.equal(
    (await asViewer(`/admin/editorial/placements?channel=news&key=${key}`, {
      method: "PUT",
      body: JSON.stringify({ channel: "news", items: [] }),
    })).status,
    403,
  );
  assert.equal((await asNoAccess(`/admin/editorial/placements?channel=news&key=${key}`)).status, 403);
  assert.equal(
    (await asEditor(`/admin/editorial/placements?channel=news&key=${key}`, {
      method: "PUT",
      body: JSON.stringify({ channel: "news", items: [] }),
    })).status,
    200,
  );
});

// ─── Media validation through the route ─────────────────────────────────────

test("media: an http feature image URL is rejected on create", async () => {
  const res = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", featureImageUrl: "http://images.unsplash.com/x.jpg" }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /must use https/i);
});

test("media: a non-allowlisted host is rejected on create, including inside a body image block", async () => {
  const feature = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", featureImageUrl: "https://evil.example.com/x.jpg" }),
  });
  assert.equal(feature.status, 400);
  assert.match((await json(feature)).error, /approved image list/i);

  const postId = await newPost({ authorId: await newAuthor("news") });
  const inBody = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "en", title: "Bad host in body",
      body: { blocks: [{ type: "image", url: "https://evil.example.com/y.jpg", alt: "bad" }] },
    }),
  });
  assert.equal(inBody.status, 400);
  assert.match((await json(inBody)).error, /approved image list/i);
});

test("media: an author avatar on a non-allowlisted host is rejected", async () => {
  const res = await asSuper("/admin/editorial/authors", {
    method: "POST",
    body: JSON.stringify({ channel: "news", publicName: "Avatar Test", role: "Writer", avatarUrl: "https://evil.example.com/a.png" }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /approved image list/i);
});

// ─── Body limits through the route ──────────────────────────────────────────

test("body: an oversized body (>250 blocks) is rejected", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "en", title: "Too big",
      body: { blocks: Array.from({ length: 251 }, () => ({ type: "paragraph", text: "x" })) },
    }),
  });
  assert.equal(res.status, 400);
  // Either layer may reject first — the generated wire schema (maxItems)
  // or the domain block schema. Both are real 400s at the 250-block cap.
  assert.match((await json(res)).error, /250 (blocks|element)/i);
});

test("body: more than 30 image blocks is rejected", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "en", title: "Too many images",
      body: { blocks: Array.from({ length: 31 }, () => ({ type: "image", url: OK_IMAGE, alt: "a" })) },
    }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /30 image blocks/i);
});

// ─── Reading time (per translation) ─────────────────────────────────────────

test("reading time: the override is per-translation, not shared", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "en", title: "EN", body: READY_BODY, readingTimeOverrideMinutes: 4 }),
  });
  await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({ languageCode: "ar", title: "AR", body: READY_BODY, readingTimeOverrideMinutes: 7 }),
  });
  const { rows } = await pool.query(
    `SELECT language_id, reading_time_override_minutes AS m
     FROM editorial_post_translations WHERE post_id = $1 ORDER BY language_id`,
    [postId],
  );
  const byLang = new Map(rows.map((r: { language_id: number; m: number }) => [r.language_id, r.m]));
  assert.equal(byLang.get(enId), 4);
  assert.equal(byLang.get(arId), 7, "the same story is not the same length in every language");
});

// ─── SEO localization ───────────────────────────────────────────────────────

test("SEO: title, description and og image are all per-translation", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "en", title: "EN", body: READY_BODY,
      seoTitle: "English SEO", seoDescription: "English description", ogImageUrl: OK_IMAGE,
    }),
  });
  await asSuper(`/admin/editorial/posts/${postId}/translations`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "ar", title: "AR", body: READY_BODY,
      seoTitle: "عنوان عربي", seoDescription: "وصف عربي",
      ogImageUrl: "https://images.unsplash.com/photo-arabic-og.jpg",
    }),
  });
  const { rows } = await pool.query(
    `SELECT language_id, seo_title, seo_description, og_image_url
     FROM editorial_post_translations WHERE post_id = $1`,
    [postId],
  );
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((r: { seo_title: string }) => r.seo_title)).size, 2);
  assert.equal(new Set(rows.map((r: { og_image_url: string }) => r.og_image_url)).size, 2);
});

// ─── Listing / detail ───────────────────────────────────────────────────────

test("list: filters by channel and by a specific language's translation status", async () => {
  const postId = await newPost({ channel: "experience", authorId: await newAuthor("experience") });
  await newTranslation(postId, enId, { status: "published", publishedAt: "2030-01-01T00:00:00Z" });
  await newTranslation(postId, arId, { status: "draft" });

  const published = await asSuper("/admin/editorial/posts?channel=experience&languageCode=en&translationStatus=published&limit=100");
  assert.equal(published.status, 200);
  const body = await json(published);
  assert.ok(body.items.some((item: { post: { id: number } }) => item.post.id === postId));
  assert.ok(body.items.every((item: { post: { channel: string } }) => item.post.channel === "experience"));
  assert.equal(body.limit, 100);
  assert.equal(body.page, 1);

  // The SAME post must NOT match "the Arabic translation is published".
  const arPublished = await json(await asSuper("/admin/editorial/posts?languageCode=ar&translationStatus=published&limit=100"));
  assert.ok(
    !arPublished.items.some((item: { post: { id: number } }) => item.post.id === postId),
    "the language + status filter is evaluated per translation, not per post",
  );
});

test("list: a post appears once even when several of its translations match", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { status: "draft" });
  await newTranslation(postId, arId, { status: "draft" });
  const body = await json(await asSuper("/admin/editorial/posts?translationStatus=draft&limit=100"));
  const matches = body.items.filter((item: { post: { id: number } }) => item.post.id === postId);
  assert.equal(matches.length, 1, "the EXISTS subquery must not multiply rows");
  assert.equal(matches[0].translations.length, 2, "but both translations are summarized on the row");
});

test("list: an unregistered languageCode filter is a 404, not a silently unfiltered page", async () => {
  assert.equal((await asSuper("/admin/editorial/posts?languageCode=zz")).status, 404);
});

test("detail: returns the shared spine, every translation, topics, and recommendations", async () => {
  const postId = await newPost({ authorId: await newAuthor("news") });
  await newTranslation(postId, enId, { title: "EN detail" });
  await newTranslation(postId, arId, { title: "AR detail" });
  const topicId = await newTopic("news");
  await asSuper(`/admin/editorial/posts/${postId}/topics`, { method: "PUT", body: JSON.stringify({ topicIds: [topicId] }) });

  const res = await asSuper(`/admin/editorial/posts/${postId}`);
  assert.equal(res.status, 200);
  const detail = await json(res);
  assert.equal(detail.post.id, postId);
  assert.ok(!("title" in detail.post), "the post spine carries no prose");
  assert.equal(detail.translations.length, 2);
  assert.deepEqual(detail.translations.map((t: { languageCode: string }) => t.languageCode).sort(), ["ar", "en"]);
  assert.equal(detail.translations.find((t: { languageCode: string }) => t.languageCode === "ar").languageDirection, "rtl");
  assert.deepEqual(detail.topics.map((t: { id: number }) => t.id), [topicId]);
});

test("topics + authors entity endpoints round-trip", async () => {
  const created = await asSuper("/admin/editorial/topics", {
    method: "POST",
    body: JSON.stringify({ channel: "news", name: "Backstage", slug: `backstage-${RUN}` }),
  });
  assert.equal(created.status, 201);
  const topic = await json(created);
  assert.equal(topic.status, "active");

  const patched = await asSuper(`/admin/editorial/topics/${topic.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await json(patched)).status, "archived");

  const author = await asSuper("/admin/editorial/authors", {
    method: "POST",
    body: JSON.stringify({ channel: "experience", publicName: `Round Trip ${RUN}`, role: "Editor", biography: "Bio." }),
  });
  assert.equal(author.status, 201);
  const authorBody = await json(author);
  assert.equal(authorBody.channel, "experience");
  assert.equal((await asSuper(`/admin/editorial/authors/${authorBody.id}`)).status, 200);

  const filtered = await json(await asSuper("/admin/editorial/authors?channel=experience"));
  assert.ok(filtered.every((a: { channel: string }) => a.channel === "experience"), "the channel filter works");
});

test("404s: unknown post, topic, author, revision, and a post with no translation in a language", async () => {
  assert.equal((await asSuper("/admin/editorial/posts/99999999")).status, 404);
  assert.equal((await asSuper("/admin/editorial/topics/99999999")).status, 404);
  assert.equal((await asSuper("/admin/editorial/authors/99999999")).status, 404);
  const postId = await newPost({ authorId: await newAuthor("news") });
  assert.equal((await asSuper(`/admin/editorial/posts/${postId}/revisions/99999999`)).status, 404);

  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/ar`);
  assert.equal(res.status, 404);
  assert.match((await json(res)).error, /no translation in that language/i);
});

// ─── Issue #24: published content cannot be edited into an unpublishable state ─
//
// Wave 1.1 ran the readiness gate only on the draft -> published
// TRANSITION. Once live, a translation could be edited into a state the
// gate would have refused — body emptied, feature-image alt blanked, the
// shared image cleared, the byline moved to an author with no biography —
// and the edit committed, so the public page rendered the broken state.
//
// Wave 2.0 re-asserts the SAME gate against the RESULT of every edit to
// published content, inside the mutation's transaction. Each test asserts
// on the real rows AND on the revision/audit tables, because the whole
// point is that a rejection leaves no trace at all: no partial save, no
// orphan revision, no misleading "success" audit row, and no silent
// demotion to draft.

/** A post with a PUBLISHED English translation, ready to be edited. */
async function publishedEnPost(): Promise<{ postId: number; authorId: number }> {
  const authorId = await newAuthor("news");
  const postId = await newPost({ channel: "news", authorId });
  await newTranslation(postId, enId);
  const res = await asSuper(`/admin/editorial/posts/${postId}/translations/en/publish`, { method: "POST" });
  assert.equal(res.status, 200, "fixture must publish");
  return { postId, authorId };
}

function editTranslation(postId: number, lang: string, body: unknown): Promise<Response> {
  return asSuper(`/admin/editorial/posts/${postId}/translations/${lang}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function editShared(postId: number, body: unknown): Promise<Response> {
  return asSuper(`/admin/editorial/posts/${postId}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function auditCountForPost(action: string, postId: number): Promise<number> {
  return auditCount(action, postId);
}

test("#24 (1): emptying the body of a PUBLISHED translation is rejected and changes nothing", async () => {
  const { postId } = await publishedEnPost();
  const beforeRow = await translationRow(postId, enId);
  const beforeRevisions = await revisionCount(postId);

  const res = await editTranslation(postId, "en", { body: { blocks: [] } });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /published/i);

  const afterRow = await translationRow(postId, enId);
  assert.deepEqual(afterRow.body, beforeRow.body, "body preserved exactly");
  assert.equal(afterRow.status, "published", "NOT demoted to draft");
  assert.equal(afterRow.title, beforeRow.title);
  // The rollback proof: the pre-change revision written inside the
  // transaction must have been rolled back with it.
  assert.equal(await revisionCount(postId), beforeRevisions, "zero orphan revision rows");
  assert.equal(await auditCountForPost("translation_edited", postId), 0, "zero misleading audit rows");
});

test("#24 (1b): blanking the feature-image alt of a PUBLISHED translation is rejected", async () => {
  const { postId } = await publishedEnPost();
  const beforeRevisions = await revisionCount(postId);

  const res = await editTranslation(postId, "en", { featureImageAlt: "   " });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /alt text/i);

  assert.equal((await translationRow(postId, enId)).featureImageAlt, "A feature image");
  assert.equal(await revisionCount(postId), beforeRevisions);
});

test("#24 (2): an invalid edit to a published AR translation is rejected", async () => {
  const { postId } = await publishedEnPost();
  await newTranslation(postId, arId, { title: "عنوان", featureImageAlt: "صورة" });
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}/translations/ar/publish`, { method: "POST" })).status,
    200,
  );

  const res = await editTranslation(postId, "ar", { body: { blocks: [] } });
  assert.equal(res.status, 400);
  assert.equal((await translationRow(postId, arId)).status, "published");
});

test("#24 (3): a rejected AR edit leaves the published EN sibling completely untouched", async () => {
  const { postId } = await publishedEnPost();
  await newTranslation(postId, arId, { title: "عنوان", featureImageAlt: "صورة" });
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}/translations/ar/publish`, { method: "POST" })).status,
    200,
  );
  const enBefore = await translationRow(postId, enId);
  const arBefore = await translationRow(postId, arId);
  const revisionsBefore = await revisionCount(postId);

  assert.equal((await editTranslation(postId, "ar", { body: { blocks: [] } })).status, 400);

  assert.deepEqual(await translationRow(postId, enId), enBefore, "EN is byte-for-byte unchanged");
  assert.deepEqual(await translationRow(postId, arId), arBefore, "AR is byte-for-byte unchanged");
  assert.equal(await revisionCount(postId), revisionsBefore, "no revision row for either language");
});

test("#24 (4): clearing the SHARED feature image while a translation is published is rejected", async () => {
  const { postId } = await publishedEnPost();
  const revisionsBefore = await revisionCount(postId);

  const res = await editShared(postId, { featureImageUrl: null });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /feature image/i);

  const { rows } = await pool.query(`SELECT feature_image_url FROM editorial_posts WHERE id = $1`, [postId]);
  assert.equal(rows[0].feature_image_url, OK_IMAGE, "the shared image is preserved");
  assert.equal((await translationRow(postId, enId)).status, "published");
  assert.equal(await revisionCount(postId), revisionsBefore, "no orphan shared revision");
  assert.equal(await auditCountForPost("feature_image_changed", postId), 0);
});

test("#24 (5): reassigning the byline to an author with no biography is rejected while published", async () => {
  const { postId } = await publishedEnPost();
  const biolessAuthor = await newAuthor("news", { biography: null });
  const revisionsBefore = await revisionCount(postId);

  const res = await editShared(postId, { authorId: biolessAuthor });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /biography/i);

  const { rows } = await pool.query(`SELECT author_id FROM editorial_posts WHERE id = $1`, [postId]);
  assert.notEqual(rows[0].author_id, biolessAuthor, "the byline did not move");
  assert.equal(await revisionCount(postId), revisionsBefore);
  assert.equal(await auditCountForPost("author_changed", postId), 0);
});

test("#24 (6): a shared edit that would invalidate ANY published translation of a multi-language post is rejected", async () => {
  // EN and AR both published; the resulting spine breaks BOTH.
  const { postId } = await publishedEnPost();
  await newTranslation(postId, arId, { title: "عنوان", featureImageAlt: "صورة" });
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}/translations/ar/publish`, { method: "POST" })).status,
    200,
  );

  const bioless = await newAuthor("news", { biography: "" });
  const res = await editShared(postId, { authorId: bioless });
  assert.equal(res.status, 400);

  // BOTH languages survive untouched, and neither got a revision row.
  assert.equal((await translationRow(postId, enId)).status, "published");
  assert.equal((await translationRow(postId, arId)).status, "published");
  const revisions = await revisionRows(postId);
  assert.equal(
    revisions.filter((r) => r.event_type === "published_edit").length,
    0,
    "no per-language byline revision leaked from the rejected shared edit",
  );
});

test("#24 (6b): ANY means ANY — a shared edit is rejected when it breaks only ONE of two published translations", async () => {
  // The previous test's spine broke both languages symmetrically, so it
  // cannot distinguish "checks all" from "checks the first one". This one
  // is ASYMMETRIC: the resulting spine is fine for EN and invalid for AR
  // alone, so it passes only if the gate genuinely iterates every published
  // translation.
  //
  // The asymmetry is the language-active rule, the one readiness rule that
  // can differ between two translations of the same post: AR is retired
  // while its translation stays published (deactivation deliberately never
  // rewrites content — see editorialLanguagesService).
  const { postId } = await publishedEnPost();
  await newTranslation(postId, arId, { title: "عنوان", featureImageAlt: "صورة" });
  assert.equal(
    (await asSuper(`/admin/editorial/posts/${postId}/translations/ar/publish`, { method: "POST" })).status,
    200,
  );
  const goodAuthor = await newAuthor("news", { biography: "A real biography." });

  await pool.query(`UPDATE editorial_languages SET is_active = false WHERE id = $1`, [arId]);
  try {
    const res = await editShared(postId, { authorId: goodAuthor });
    assert.equal(res.status, 400, "rejected on AR's account, though EN alone would have passed");
    assert.match((await json(res)).error, /inactive/i);

    const { rows } = await pool.query(`SELECT author_id FROM editorial_posts WHERE id = $1`, [postId]);
    assert.notEqual(rows[0].author_id, goodAuthor, "the byline did not move");
  } finally {
    await pool.query(`UPDATE editorial_languages SET is_active = true WHERE id = $1`, [arId]);
  }

  // With AR active again the very same edit succeeds, proving the rejection
  // was caused by AR's state and nothing else.
  assert.equal((await editShared(postId, { authorId: goodAuthor })).status, 200);
});

test("#24 (7): a VALID edit to a published translation still succeeds, with its revision and audit", async () => {
  const { postId } = await publishedEnPost();
  const revisionsBefore = await revisionCount(postId);

  const res = await editTranslation(postId, "en", {
    title: "A better headline",
    body: { blocks: [{ type: "paragraph", text: "Rewritten, and still valid." }] },
  });
  assert.equal(res.status, 200);

  const after = await translationRow(postId, enId);
  assert.equal(after.title, "A better headline");
  assert.equal(after.status, "published");
  assert.equal(await revisionCount(postId), revisionsBefore + 1, "the pre-change revision is still written");
  assert.equal(await auditCountForPost("translation_edited", postId), 0);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM admin_activity_logs
     WHERE module = 'website.posts' AND action = 'translation_edited'`,
  );
  assert.ok(rows[0].n > 0, "the edit is audited");
});

test("#24 (8): a VALID shared-field edit still succeeds while published", async () => {
  const { postId } = await publishedEnPost();
  const goodAuthor = await newAuthor("news", { biography: "A real biography." });

  const res = await editShared(postId, { authorId: goodAuthor });
  assert.equal(res.status, 200);

  const { rows } = await pool.query(`SELECT author_id FROM editorial_posts WHERE id = $1`, [postId]);
  assert.equal(rows[0].author_id, goodAuthor, "the byline moved");
  assert.equal(await auditCountForPost("author_changed", postId), 1);
  // The frozen byline on the published translation was refreshed.
  const snap = await pool.query(
    `SELECT author_snapshot FROM editorial_post_translations WHERE post_id = $1 AND language_id = $2`,
    [postId, enId],
  );
  assert.ok(snap.rows[0].author_snapshot, "the published translation's frozen byline was refreshed");
});

test("#24: DRAFT translations remain permissive — the gate is published-only", async () => {
  const { postId } = await newReadyPost("news");
  // Exactly the edit that is rejected on a published translation.
  const res = await editTranslation(postId, "en", { body: { blocks: [] } });
  assert.equal(res.status, 200, "a draft may be saved in an unpublishable state");
  assert.deepEqual((await translationRow(postId, enId)).body, { blocks: [] });
});

test("#24: a shared edit on a post with NO published translation remains permissive", async () => {
  const { postId } = await newReadyPost("news");
  const res = await editShared(postId, { featureImageUrl: null });
  assert.equal(res.status, 200, "no published translation means nothing to protect");
  const { rows } = await pool.query(`SELECT feature_image_url FROM editorial_posts WHERE id = $1`, [postId]);
  assert.equal(rows[0].feature_image_url, null);
});
