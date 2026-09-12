/**
 * Real route + database integration tests for the Unified Editorial CMS
 * Wave 1 Admin API (routes/adminEditorial.ts).
 *
 * Boots the ACTUAL Express router behind the ACTUAL global auth middleware,
 * issues real HTTP requests with real admin JWTs, and asserts on real rows
 * in a disposable local Postgres database — same convention as
 * websiteBranches.route.test.ts / adminBalletPaymentsTerminalState.route.test.ts.
 *
 * Covers:
 *   - permission boundaries per action (view/create/edit/delete/publish)
 *   - duplicate (channel, slug) rejected; the SAME slug on the other
 *     channel accepted (the point of a per-channel unique)
 *   - invalid transitions rejected (published -> draft blocked)
 *   - a published edit creates a revision, AND the mutation rolls back when
 *     the revision insert fails
 *   - topic channel-mismatch / archived-topic rejected
 *   - relation self / duplicate / cross-channel rejected
 *   - placement channel-mismatch / duplicate rejected
 *   - media validation: http rejected, non-allowlisted host rejected,
 *     missing image alt blocks publish
 *   - oversized body rejected
 *   - publish audit row is written in the same transaction as the transition
 *
 * The LIVE half of media validation (DNS + HEAD) is switched off for this
 * suite via the double-guarded NODE_ENV=test + EDITORIAL_MEDIA_SKIP_LIVE_CHECK
 * seam, so these tests make no outbound network requests. The STATIC rules
 * (https-only, host allowlist) are still fully live and are asserted below.
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

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

/**
 * `Response.json()` is typed `unknown`, and these are black-box assertions
 * against a real wire response whose shape is the thing under test — so the
 * body is read through one deliberately loose helper rather than ~40
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

async function newAuthor(opts: { biography?: string | null; status?: string } = {}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO editorial_authors (public_name, role, biography, status)
     VALUES ($1, 'Staff Writer', $2, $3) RETURNING id`,
    [`Author ${RUN}-${Math.random().toString(36).slice(2, 7)}`, opts.biography === undefined ? "A bio." : opts.biography, opts.status ?? "active"],
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

async function newPost(opts: {
  channel?: string;
  status?: string;
  authorId?: number | null;
  featureImageUrl?: string | null;
  featureImageAlt?: string | null;
  body?: unknown;
  publishedAt?: string | null;
} = {}): Promise<number> {
  const slug = `p-${Math.random().toString(36).slice(2, 10)}`;
  const { rows } = await pool.query(
    `INSERT INTO editorial_posts
       (channel, slug, status, title, body, feature_image_url, feature_image_alt, author_id, published_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id`,
    [
      opts.channel ?? "news",
      slug,
      opts.status ?? "draft",
      `Post ${slug}`,
      JSON.stringify(opts.body ?? READY_BODY),
      opts.featureImageUrl === undefined ? OK_IMAGE : opts.featureImageUrl,
      opts.featureImageAlt === undefined ? "A feature image" : opts.featureImageAlt,
      opts.authorId ?? null,
      opts.publishedAt ?? null,
    ],
  );
  return rows[0].id;
}

async function postRow(id: number): Promise<{ status: string; title: string; publishedAt: string | null; publishedAtEpoch: number | null }> {
  // published_at is read BOTH as Postgres' own text rendering (for a
  // null/not-null assertion) and as an epoch (for value comparison) —
  // Postgres' " +00" timestamptz text form is not parseable by JS's Date,
  // so comparing epochs is the only correct way to assert the value.
  const { rows } = await pool.query(
    `SELECT status, title, published_at::text AS "publishedAt",
            extract(epoch FROM published_at)::float8 AS "publishedAtEpoch"
     FROM editorial_posts WHERE id = $1`,
    [id],
  );
  return rows[0];
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
  // editorial tables or in the two admin tables it seeded.
  await pool.query(`DELETE FROM editorial_post_revisions`);
  await pool.query(`DELETE FROM editorial_placements`);
  await pool.query(`DELETE FROM editorial_post_relations`);
  await pool.query(`DELETE FROM editorial_post_topics`);
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
  const body = await json(res);
  assert.deepEqual(body.requiredPermission, { module: "website.posts", action: "view" });
});

test("permissions: website.news grants do NOT leak into website.posts", async () => {
  // noAccessAdmin holds FULL website.news permissions and still cannot
  // create an editorial post — proof the new family is genuinely separate.
  const res = await asNoAccess("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", slug: "leak-check", title: "Leak", body: READY_BODY }),
  });
  assert.equal(res.status, 403);
});

test("permissions: view-only admin can read but cannot create", async () => {
  assert.equal((await asViewer("/admin/editorial/posts")).status, 200);
  const res = await asViewer("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", slug: "viewer-create", title: "Nope", body: READY_BODY }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual((await json(res)).requiredPermission, { module: "website.posts", action: "create" });
});

test("permissions: view-only admin cannot edit", async () => {
  const id = await newPost();
  const res = await asViewer(`/admin/editorial/posts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Edited by viewer" }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual((await json(res)).requiredPermission, { module: "website.posts", action: "edit" });
});

test("permissions: edit-level admin (no publish grant) cannot publish, archive, or restore", async () => {
  const id = await newPost({ authorId: await newAuthor() });
  for (const action of ["publish", "archive", "restore"]) {
    const res = await asEditor(`/admin/editorial/posts/${id}/${action}`, { method: "POST" });
    assert.equal(res.status, 403, `${action} must require website.posts:publish`);
    assert.deepEqual((await json(res)).requiredPermission, { module: "website.posts", action: "publish" });
  }
  assert.equal((await postRow(id)).status, "draft", "a refused transition changes nothing");
});

test("permissions: edit-level admin CAN create and edit", async () => {
  const res = await asEditor("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", slug: `editor-ok-${RUN}`, title: "Editor post", body: READY_BODY }),
  });
  assert.equal(res.status, 201);
  const created = await json(res);
  assert.equal(created.status, "draft", "creation always yields a draft");
  const patched = await asEditor(`/admin/editorial/posts/${created.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Editor post v2" }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await postRow(created.id)).title, "Editor post v2");
});

// ─── Slug uniqueness ────────────────────────────────────────────────────────

test("duplicate (channel, slug) is rejected with 409; the same slug on the OTHER channel is accepted", async () => {
  const slug = `dupe-${RUN}`;
  const first = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", slug, title: "First", body: READY_BODY }),
  });
  assert.equal(first.status, 201);

  const dupe = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "news", slug, title: "Second", body: READY_BODY }),
  });
  assert.equal(dupe.status, 409);

  const otherChannel = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({ channel: "experience", slug, title: "Other channel", body: READY_BODY }),
  });
  assert.equal(otherChannel.status, 201, "uniqueness is per (channel, slug), not global");
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

test("publish: a ready draft publishes, stamps publishedAt, and writes its audit row", async () => {
  const id = await newPost({ authorId: await newAuthor() });
  const res = await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" });
  assert.equal(res.status, 200, JSON.stringify(await json(res.clone())));
  const row = await postRow(id);
  assert.equal(row.status, "published");
  assert.ok(row.publishedAt, "publishedAt is stamped on first publish");
  assert.equal(await auditCount("publish", id), 1, "the publish audit row is written in the same transaction");
});

test("publish is blocked without an author", async () => {
  const id = await newPost({ authorId: null });
  const res = await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /needs an author/i);
  assert.equal((await postRow(id)).status, "draft");
});

test("publish is blocked when the author has no biography", async () => {
  const id = await newPost({ authorId: await newAuthor({ biography: null }) });
  const res = await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /no biography/i);
});

test("publish is blocked when the author is archived", async () => {
  const id = await newPost({ authorId: await newAuthor({ status: "archived" }) });
  const res = await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /archived/i);
});

test("publish is blocked without a feature image or its alt text", async () => {
  const noImage = await newPost({ authorId: await newAuthor(), featureImageUrl: null });
  assert.match((await json(await asSuper(`/admin/editorial/posts/${noImage}/publish`, { method: "POST" }))).error, /feature image/i);

  const noAlt = await newPost({ authorId: await newAuthor(), featureImageAlt: null });
  assert.match((await json(await asSuper(`/admin/editorial/posts/${noAlt}/publish`, { method: "POST" }))).error, /alt text/i);
});

test("publish is blocked when an image block is missing alt text", async () => {
  const id = await newPost({
    authorId: await newAuthor(),
    body: { blocks: [{ type: "paragraph", text: "x" }, { type: "image", url: OK_IMAGE, alt: "  " }] },
  });
  const res = await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /image needs alt text/i);
  assert.equal((await postRow(id)).status, "draft");
});

test("publish is blocked when the body has no blocks", async () => {
  const id = await newPost({ authorId: await newAuthor(), body: { blocks: [] } });
  const res = await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /at least one body block/i);
});

test("transitions: published -> draft is rejected (409); archive -> restore is the supported path", async () => {
  const id = await newPost({ status: "published", authorId: await newAuthor(), publishedAt: "2030-01-01T00:00:00Z" });

  const direct = await asSuper(`/admin/editorial/posts/${id}/restore`, { method: "POST" });
  assert.equal(direct.status, 409, "published -> draft must never be allowed");
  assert.match((await json(direct)).error, /Archive the post first/i);
  assert.equal((await postRow(id)).status, "published");

  assert.equal((await asSuper(`/admin/editorial/posts/${id}/archive`, { method: "POST" })).status, 200);
  assert.equal((await postRow(id)).status, "archived");

  assert.equal((await asSuper(`/admin/editorial/posts/${id}/restore`, { method: "POST" })).status, 200);
  const restored = await postRow(id);
  assert.equal(restored.status, "draft");
  assert.ok(restored.publishedAt, "publishedAt survives archive + restore");
});

test("re-publishing an archived post preserves the original publishedAt", async () => {
  const original = "2029-05-05T10:00:00Z";
  const id = await newPost({ status: "archived", authorId: await newAuthor(), publishedAt: original });
  assert.equal((await asSuper(`/admin/editorial/posts/${id}/restore`, { method: "POST" })).status, 200);
  assert.equal((await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" })).status, 200);
  const row = await postRow(id);
  assert.equal(row.status, "published");
  assert.equal(row.publishedAtEpoch, new Date(original).getTime() / 1000, "the original publication instant is preserved");
});

test("publishing an already-published post is rejected as a no-op transition", async () => {
  const id = await newPost({ status: "published", authorId: await newAuthor(), publishedAt: "2030-01-01T00:00:00Z" });
  const res = await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" });
  assert.equal(res.status, 409);
  assert.match((await json(res)).error, /already published/i);
});

// ─── Revisions ──────────────────────────────────────────────────────────────

test("editing a PUBLISHED post creates exactly one revision of the pre-change state", async () => {
  const id = await newPost({ status: "published", authorId: await newAuthor(), publishedAt: "2030-01-01T00:00:00Z" });
  const before = await postRow(id);
  assert.equal(await revisionCount(id), 0);

  const res = await asSuper(`/admin/editorial/posts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Revised headline" }),
  });
  assert.equal(res.status, 200);
  assert.equal(await revisionCount(id), 1);

  const { rows } = await pool.query(
    `SELECT revision_number, event_type, snapshot FROM editorial_post_revisions WHERE post_id = $1`,
    [id],
  );
  assert.equal(rows[0].revision_number, 1);
  assert.equal(rows[0].event_type, "published_edit");
  assert.equal(rows[0].snapshot.title, before.title, "the snapshot holds the PRE-change title");
  assert.equal((await postRow(id)).title, "Revised headline");
  assert.equal((await postRow(id)).publishedAt, before.publishedAt, "publishedAt never changes on edit");
});

test("editing a DRAFT creates no revision (a draft is working copy, not history)", async () => {
  const id = await newPost();
  assert.equal((await asSuper(`/admin/editorial/posts/${id}`, { method: "PATCH", body: JSON.stringify({ title: "Draft v2" }) })).status, 200);
  assert.equal(await revisionCount(id), 0);
});

test("revision numbers are per-post sequential", async () => {
  const id = await newPost({ status: "published", authorId: await newAuthor(), publishedAt: "2030-01-01T00:00:00Z" });
  for (const title of ["one", "two", "three"]) {
    assert.equal((await asSuper(`/admin/editorial/posts/${id}`, { method: "PATCH", body: JSON.stringify({ title }) })).status, 200);
  }
  const { rows } = await pool.query(
    `SELECT revision_number FROM editorial_post_revisions WHERE post_id = $1 ORDER BY revision_number`,
    [id],
  );
  assert.deepEqual(rows.map((r: { revision_number: number }) => r.revision_number), [1, 2, 3]);
});

/**
 * The rollback guarantee. A UNIQUE (post_id, revision_number) row is
 * planted so the service's computed next revision number collides — the
 * revision insert therefore FAILS, and the whole transaction (revision +
 * mutation + audit) must roll back with the post left untouched.
 */
test("a published edit rolls back entirely when the revision insert fails", async () => {
  const id = await newPost({ status: "published", authorId: await newAuthor(), publishedAt: "2030-01-01T00:00:00Z" });
  const before = await postRow(id);

  // Plant revision #1 directly. The service computes MAX+1 = 2... so to
  // force the collision we plant #1 AND a #2 whose existence MAX() cannot
  // see: instead, simplest deterministic collision — a CHECK-violating
  // event type is not reachable, so we make the insert fail by dropping a
  // NOT NULL requirement's value via a trigger-free route: plant #1, then
  // lower the sequence by inserting a duplicate through a partial index is
  // not possible. We instead use a BEFORE INSERT rule: a temporary trigger
  // that raises on any revision insert for THIS post.
  await pool.query(`
    CREATE OR REPLACE FUNCTION editorial_test_block_revision() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'editorial-test: revision insert blocked'; END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER editorial_test_block_revision_trg
      BEFORE INSERT ON editorial_post_revisions
      FOR EACH ROW WHEN (NEW.post_id = ${id})
      EXECUTE FUNCTION editorial_test_block_revision();
  `);
  try {
    const res = await asSuper(`/admin/editorial/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "This must never land" }),
    });
    assert.equal(res.status, 500, "a failed revision write must not succeed as a 2xx");
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS editorial_test_block_revision_trg ON editorial_post_revisions`);
    await pool.query(`DROP FUNCTION IF EXISTS editorial_test_block_revision()`);
  }

  const after_ = await postRow(id);
  assert.equal(after_.title, before.title, "the mutation rolled back with the failed revision");
  assert.equal(await revisionCount(id), 0, "no revision row was committed either");
});

test("revision list + read endpoints, and restoring from a revision", async () => {
  const authorId = await newAuthor();
  const id = await newPost({ status: "published", authorId, publishedAt: "2030-01-01T00:00:00Z" });
  const originalTitle = (await postRow(id)).title;
  assert.equal((await asSuper(`/admin/editorial/posts/${id}`, { method: "PATCH", body: JSON.stringify({ title: "Changed" }) })).status, 200);

  const listRes = await asSuper(`/admin/editorial/posts/${id}/revisions`);
  assert.equal(listRes.status, 200);
  const list = await json(listRes);
  assert.equal(list.length, 1);
  assert.equal(list[0].revisionNumber, 1);
  assert.equal(list[0].snapshot, undefined, "the list is metadata only");

  const readRes = await asSuper(`/admin/editorial/posts/${id}/revisions/${list[0].id}`);
  assert.equal(readRes.status, 200);
  assert.equal((await json(readRes)).snapshot.title, originalTitle);

  const restoreRes = await asSuper(`/admin/editorial/posts/${id}/revisions/${list[0].id}/restore`, { method: "POST" });
  assert.equal(restoreRes.status, 200);
  const restored = await postRow(id);
  assert.equal(restored.title, originalTitle, "content is restored from the snapshot");
  assert.equal(restored.status, "published", "a revision restores CONTENT, never lifecycle");
  assert.equal(await revisionCount(id), 2, "restoring itself snapshots the pre-restore state");
});

test("revision restore requires website.posts:publish", async () => {
  const id = await newPost({ status: "published", authorId: await newAuthor(), publishedAt: "2030-01-01T00:00:00Z" });
  await asSuper(`/admin/editorial/posts/${id}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) });
  const list = await json(await asSuper(`/admin/editorial/posts/${id}/revisions`));
  const res = await asEditor(`/admin/editorial/posts/${id}/revisions/${list[0].id}/restore`, { method: "POST" });
  assert.equal(res.status, 403);
});

test("changing the author of a PUBLISHED post writes an author_change revision and regenerates the snapshot", async () => {
  const first = await newAuthor();
  const second = await newAuthor();
  const id = await newPost({ status: "published", authorId: first, publishedAt: "2030-01-01T00:00:00Z" });
  await pool.query(
    `UPDATE editorial_posts SET author_snapshot = jsonb_build_object('name','Old','role','Old','avatarUrl',null,'biography','Old') WHERE id = $1`,
    [id],
  );

  const res = await asSuper(`/admin/editorial/posts/${id}`, { method: "PATCH", body: JSON.stringify({ authorId: second }) });
  assert.equal(res.status, 200);

  const { rows: revs } = await pool.query(`SELECT event_type FROM editorial_post_revisions WHERE post_id = $1`, [id]);
  assert.deepEqual(revs.map((r: { event_type: string }) => r.event_type), ["author_change"]);

  const { rows } = await pool.query(`SELECT author_id, author_snapshot FROM editorial_posts WHERE id = $1`, [id]);
  assert.equal(rows[0].author_id, second);
  assert.notEqual(rows[0].author_snapshot.name, "Old", "the snapshot is regenerated from the new author");
});

test("editing an author ENTITY never rewrites a published post's frozen snapshot", async () => {
  const authorId = await newAuthor();
  const id = await newPost({ status: "published", authorId, publishedAt: "2030-01-01T00:00:00Z" });
  assert.equal((await asSuper(`/admin/editorial/posts/${id}/publish`, { method: "POST" })).status, 409);
  await pool.query(
    `UPDATE editorial_posts SET author_snapshot = jsonb_build_object('name','Frozen Name','role','Frozen Role','avatarUrl',null,'biography','Frozen bio') WHERE id = $1`,
    [id],
  );

  const res = await asSuper(`/admin/editorial/authors/${authorId}`, {
    method: "PATCH",
    body: JSON.stringify({ publicName: "Renamed Entirely" }),
  });
  assert.equal(res.status, 200);

  const { rows } = await pool.query(`SELECT author_snapshot FROM editorial_posts WHERE id = $1`, [id]);
  assert.equal(rows[0].author_snapshot.name, "Frozen Name", "the frozen byline is untouched by an author-entity edit");
});

// ─── Topics ─────────────────────────────────────────────────────────────────

test("topics: a topic from the other channel is rejected", async () => {
  const id = await newPost({ channel: "news" });
  const res = await asSuper(`/admin/editorial/posts/${id}/topics`, {
    method: "PUT",
    body: JSON.stringify({ topicIds: [await newTopic("experience")] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel/i);
});

test("topics: an archived topic cannot be newly assigned", async () => {
  const id = await newPost({ channel: "news" });
  const res = await asSuper(`/admin/editorial/posts/${id}/topics`, {
    method: "PUT",
    body: JSON.stringify({ topicIds: [await newTopic("news", "archived")] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /archived/i);
});

test("topics: a duplicate topic id in one payload is rejected", async () => {
  const id = await newPost({ channel: "news" });
  const topicId = await newTopic("news");
  const res = await asSuper(`/admin/editorial/posts/${id}/topics`, {
    method: "PUT",
    body: JSON.stringify({ topicIds: [topicId, topicId] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /more than once/i);
});

test("topics: a valid same-channel assignment succeeds, and on a PUBLISHED post writes a topics_change revision", async () => {
  const topicId = await newTopic("news");
  const id = await newPost({ channel: "news", status: "published", authorId: await newAuthor(), publishedAt: "2030-01-01T00:00:00Z" });

  const res = await asSuper(`/admin/editorial/posts/${id}/topics`, { method: "PUT", body: JSON.stringify({ topicIds: [topicId] }) });
  assert.equal(res.status, 200);
  assert.deepEqual((await json(res)).map((t: { id: number }) => t.id), [topicId]);

  const { rows } = await pool.query(`SELECT event_type FROM editorial_post_revisions WHERE post_id = $1`, [id]);
  assert.deepEqual(rows.map((r: { event_type: string }) => r.event_type), ["topics_change"]);
  assert.equal(await auditCount("topics_changed", id), 1);
});

// ─── Recommendations ────────────────────────────────────────────────────────

test("recommendations: self-reference is rejected", async () => {
  const id = await newPost();
  const res = await asSuper(`/admin/editorial/posts/${id}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: id }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /cannot recommend itself/i);
});

test("recommendations: a duplicate target is rejected", async () => {
  const id = await newPost();
  const target = await newPost();
  const res = await asSuper(`/admin/editorial/posts/${id}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: target }, { targetPostId: target }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /more than once/i);
});

test("recommendations: a cross-channel target is rejected", async () => {
  const id = await newPost({ channel: "news" });
  const target = await newPost({ channel: "experience" });
  const res = await asSuper(`/admin/editorial/posts/${id}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: target }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel/i);
});

test("recommendations: a same-channel target is accepted and order is preserved", async () => {
  const id = await newPost({ channel: "news" });
  const a = await newPost({ channel: "news" });
  const b = await newPost({ channel: "news" });
  const res = await asSuper(`/admin/editorial/posts/${id}/recommendations`, {
    method: "PUT",
    body: JSON.stringify({ items: [{ targetPostId: b }, { targetPostId: a }] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await json(res)).map((r: { targetPostId: number }) => r.targetPostId), [b, a]);
  assert.equal(await auditCount("recommendations_changed", id), 1);
});

// ─── Placements ─────────────────────────────────────────────────────────────

test("placements: a post from the other channel is rejected", async () => {
  const postId = await newPost({ channel: "experience" });
  const res = await asSuper(`/admin/editorial/placements?key=news-hero-${RUN}`, {
    method: "PUT",
    body: JSON.stringify({ channel: "news", items: [{ postId }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /experience channel/i);
});

test("placements: the same post twice in one placement is rejected", async () => {
  const postId = await newPost({ channel: "news" });
  const res = await asSuper(`/admin/editorial/placements?key=dupe-${RUN}`, {
    method: "PUT",
    body: JSON.stringify({ channel: "news", items: [{ postId }, { postId }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /at most once/i);
});

test("placements: a valid placement round-trips in position order and is audited", async () => {
  const key = `news-hero-ok-${RUN}`;
  const a = await newPost({ channel: "news" });
  const b = await newPost({ channel: "news" });
  const res = await asSuper(`/admin/editorial/placements?key=${key}`, {
    method: "PUT",
    body: JSON.stringify({ channel: "news", items: [{ postId: b }, { postId: a }] }),
  });
  assert.equal(res.status, 200);
  const read = await json(await asSuper(`/admin/editorial/placements?key=${key}`));
  assert.deepEqual(read.map((e: { postId: number }) => e.postId), [b, a]);
  assert.equal(await auditCount("placement_changed", key), 1);
});

// ─── Media validation through the route ─────────────────────────────────────

test("media: an http feature image URL is rejected on create", async () => {
  const res = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({
      channel: "news",
      slug: `http-media-${RUN}`,
      title: "Insecure",
      body: READY_BODY,
      featureImageUrl: "http://images.unsplash.com/x.jpg",
    }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /must use https/i);
});

test("media: a non-allowlisted host is rejected on create, including inside a body image block", async () => {
  const feature = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({
      channel: "news", slug: `bad-host-${RUN}`, title: "Bad host", body: READY_BODY,
      featureImageUrl: "https://evil.example.com/x.jpg",
    }),
  });
  assert.equal(feature.status, 400);
  assert.match((await json(feature)).error, /approved image list/i);

  const inBody = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({
      channel: "news", slug: `bad-host-body-${RUN}`, title: "Bad host in body",
      body: { blocks: [{ type: "image", url: "https://evil.example.com/y.jpg", alt: "bad" }] },
    }),
  });
  assert.equal(inBody.status, 400);
  assert.match((await json(inBody)).error, /approved image list/i);
});

test("media: an author avatar on a non-allowlisted host is rejected", async () => {
  const res = await asSuper("/admin/editorial/authors", {
    method: "POST",
    body: JSON.stringify({ publicName: "Avatar Test", role: "Writer", avatarUrl: "https://evil.example.com/a.png" }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /approved image list/i);
});

// ─── Body limits through the route ──────────────────────────────────────────

test("body: an oversized body (>250 blocks) is rejected", async () => {
  const res = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({
      channel: "news", slug: `oversized-${RUN}`, title: "Too big",
      body: { blocks: Array.from({ length: 251 }, () => ({ type: "paragraph", text: "x" })) },
    }),
  });
  assert.equal(res.status, 400);
  // Either layer may reject first — the generated wire schema (maxItems)
  // or the domain block schema. Both are real 400s at the 250-block cap.
  assert.match((await json(res)).error, /250 (blocks|element)/i);
});

test("body: more than 30 image blocks is rejected", async () => {
  const res = await asSuper("/admin/editorial/posts", {
    method: "POST",
    body: JSON.stringify({
      channel: "news", slug: `too-many-images-${RUN}`, title: "Too many images",
      body: { blocks: Array.from({ length: 31 }, () => ({ type: "image", url: OK_IMAGE, alt: "a" })) },
    }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /30 image blocks/i);
});

// ─── Listing / filtering ────────────────────────────────────────────────────

test("list: filters by channel and status and paginates", async () => {
  const authorId = await newAuthor();
  await newPost({ channel: "experience", status: "published", authorId, publishedAt: "2030-01-01T00:00:00Z" });
  await newPost({ channel: "experience", status: "draft" });

  const res = await asSuper("/admin/editorial/posts?channel=experience&status=published&limit=100");
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.ok(body.total >= 1);
  assert.ok(body.items.every((p: { channel: string; status: string }) => p.channel === "experience" && p.status === "published"));
  assert.equal(body.limit, 100);
  assert.equal(body.page, 1);
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
    body: JSON.stringify({ publicName: `Round Trip ${RUN}`, role: "Editor", biography: "Bio." }),
  });
  assert.equal(author.status, 201);
  const authorBody = await json(author);
  assert.equal((await asSuper(`/admin/editorial/authors/${authorBody.id}`)).status, 200);
});

test("404s: unknown post, topic, author, and revision", async () => {
  assert.equal((await asSuper("/admin/editorial/posts/99999999")).status, 404);
  assert.equal((await asSuper("/admin/editorial/topics/99999999")).status, 404);
  assert.equal((await asSuper("/admin/editorial/authors/99999999")).status, 404);
  const id = await newPost();
  assert.equal((await asSuper(`/admin/editorial/posts/${id}/revisions/99999999`)).status, 404);
});
