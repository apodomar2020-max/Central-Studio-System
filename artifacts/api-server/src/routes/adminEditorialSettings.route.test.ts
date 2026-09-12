/**
 * Real route + database integration tests for Website Settings
 * (routes/adminEditorialSettings.ts) — content LANGUAGES and app-store
 * LINKS, Wave 1.1.
 *
 * Separate from adminEditorial.route.test.ts because these endpoints sit
 * behind a DIFFERENT permission family (`website.settings`, not
 * `website.posts`), and one of the things under test is precisely that the
 * two do not leak into each other.
 *
 * Runs against its OWN disposable database, not the content suite's, so
 * language-registry mutations (deactivating, promoting a new default)
 * cannot interfere with the content suite running before or after it.
 *
 * Covers:
 *   - permission boundaries: website.posts grants do NOT confer
 *     website.settings, and view cannot edit
 *   - language creation, BCP-47 code validation, canonicalization, code
 *     uniqueness, LTR and RTL
 *   - single-default ATOMICITY: promotion demotes the incumbent in one
 *     transaction, and the database's partial unique index rejects a second
 *     default even against direct SQL
 *   - the default language cannot be deactivated (and the DB CHECK backs it)
 *   - the last active language cannot be deactivated
 *   - deactivation RETAINS the language and every translation's stored
 *     status; reactivation mutates no content
 *   - links: https required, malformed rejected, markup rejected, empty
 *     allowed and normalized to null, and every change audited per field
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL =
  process.env["EDITORIAL_SETTINGS_TEST_DATABASE_URL"]
  ?? "postgres://localhost:5432/central_studio_disposable_editorial_settings";

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

let app: import("express").Express;
let server: import("node:http").Server;
let pool: (typeof import("@workspace/db"))["pool"];
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let superAdminId: number;
/** website.settings:view+edit. */
let settingsAdminId: number;
/** website.settings:view only. */
let settingsViewerId: number;
/** FULL website.posts, nothing on website.settings — the leak check. */
let contentAdminId: number;
const roleIds: number[] = [];
const adminIds: number[] = [];

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

function tokenFor(adminId: number, isSuperAdmin: boolean): string {
  return jwtSign({ sub: adminId, username: `settings-${adminId}-${RUN}`, isSuperAdmin, roleId: null }, ADMIN_JWT_SECRET);
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
const asSettings = (path: string, init?: RequestInit) => call(settingsAdminId, false, path, init);
const asSettingsViewer = (path: string, init?: RequestInit) => call(settingsViewerId, false, path, init);
const asContentOnly = (path: string, init?: RequestInit) => call(contentAdminId, false, path, init);

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
    [`settings-${suffix}-${RUN}`, `settings-${suffix}-${RUN}@example.invalid`, `Settings ${suffix}`, roleId, isSuperAdmin],
  );
  adminIds.push(rows[0].id);
  return rows[0].id;
}

async function languageRow(code: string): Promise<{
  id: number; code: string; direction: string; is_active: boolean; is_default: boolean; display_order: number;
}> {
  const { rows } = await pool.query(`SELECT * FROM editorial_languages WHERE code = $1`, [code]);
  return rows[0];
}

async function defaultCodes(): Promise<string[]> {
  const { rows } = await pool.query(`SELECT code FROM editorial_languages WHERE is_default ORDER BY code`);
  return rows.map((r: { code: string }) => r.code);
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM admin_activity_logs WHERE module = 'website.posts' AND action = $1`,
    [action],
  );
  return rows[0].n;
}

/** A unique two-letter code per call, so tests never collide on `code`. */
let codeCounter = 0;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
function freshCode(): string {
  codeCounter += 1;
  const a = CODE_ALPHABET[Math.floor(codeCounter / 26) % 26];
  const b = CODE_ALPHABET[codeCounter % 26];
  return `q${a}${b}`.slice(0, 3);
}

async function createLanguageViaApi(overrides: Record<string, unknown> = {}): Promise<{ id: number; code: string }> {
  const code = (overrides["code"] as string | undefined) ?? freshCode();
  const res = await asSuper("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({
      code,
      name: `Lang ${code}`,
      nativeName: `Native ${code}`,
      direction: "ltr",
      ...overrides,
    }),
  });
  assert.equal(res.status, 201, `create ${code}: ${JSON.stringify(await json(res.clone()))}`);
  const row = await json(res);
  return { id: row.id, code: row.code };
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const settingsRouter = (await import("./adminEditorialSettings")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(requireAuth);
  app.use(settingsRouter);
  await new Promise<void>((resolvePromise) => {
    server = app.listen(0, "127.0.0.1", () => resolvePromise());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  superAdminId = await createAdmin("super", null, true);
  settingsAdminId = await createAdmin(
    "editor",
    await createRole(`settings-editor-${RUN}`, { "website.settings": { view: true, edit: true } }),
  );
  settingsViewerId = await createAdmin(
    "viewer",
    await createRole(`settings-viewer-${RUN}`, { "website.settings": { view: true } }),
  );
  contentAdminId = await createAdmin(
    "content",
    await createRole(`settings-content-${RUN}`, {
      "website.posts": { view: true, create: true, edit: true, delete: true, publish: true },
      "website.backgrounds": { view: true, edit: true },
    }),
  );
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.query(`DELETE FROM editorial_post_translations`);
  await pool.query(`DELETE FROM editorial_posts`);
  await pool.query(`DELETE FROM editorial_authors`);
  // Restore 'en' as the sole default so the database is left as migration
  // 0126 seeded it, then drop every language this suite added.
  await pool.query(`UPDATE editorial_languages SET is_default = false WHERE code <> 'en'`);
  await pool.query(`UPDATE editorial_languages SET is_default = true, is_active = true WHERE code = 'en'`);
  await pool.query(`DELETE FROM editorial_languages WHERE code <> 'en'`);
  await pool.query(`UPDATE editorial_website_links SET google_play_url = NULL, app_store_url = NULL WHERE id = 1`);
  await pool.query(`DELETE FROM admin_activity_logs WHERE module = 'website.posts'`);
  if (adminIds.length > 0) await pool.query(`DELETE FROM system_users WHERE id = ANY($1::int[])`, [adminIds]);
  if (roleIds.length > 0) await pool.query(`DELETE FROM roles WHERE id = ANY($1::int[])`, [roleIds]);
  await pool.end();
});

// ─── Permission boundaries ──────────────────────────────────────────────────

test("permissions: unauthenticated requests are rejected before reaching the handler", async () => {
  const res = await fetch(apiUrl("/admin/editorial/settings/languages"), {
    headers: { "x-api-key": "test-api-secret-key" },
  });
  assert.equal(res.status, 401);
});

test("permissions: FULL website.posts does NOT confer website.settings", async () => {
  // The whole point of the separate family: an admin who can write and
  // publish every post still cannot touch the language registry or the
  // app-store links. This admin also holds website.backgrounds, so the
  // test doubles as proof the Background CMS grant was not reused.
  for (const path of ["/admin/editorial/settings/languages", "/admin/editorial/settings/links"]) {
    const res = await asContentOnly(path);
    assert.equal(res.status, 403, path);
    assert.deepEqual((await json(res)).requiredPermission, { module: "website.settings", action: "view" });
  }
});

test("permissions: website.settings:view can read but cannot edit", async () => {
  assert.equal((await asSettingsViewer("/admin/editorial/settings/languages")).status, 200);
  assert.equal((await asSettingsViewer("/admin/editorial/settings/links")).status, 200);

  const create = await asSettingsViewer("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({ code: "qz", name: "Nope", nativeName: "Nope", direction: "ltr" }),
  });
  assert.equal(create.status, 403);
  assert.deepEqual((await json(create)).requiredPermission, { module: "website.settings", action: "edit" });

  const links = await asSettingsViewer("/admin/editorial/settings/links", {
    method: "PATCH",
    body: JSON.stringify({ googlePlayUrl: "https://play.google.com/store/apps/details?id=x" }),
  });
  assert.equal(links.status, 403);
});

test("permissions: website.settings:edit can create a language and update links", async () => {
  const code = freshCode();
  const res = await asSettings("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({ code, name: "Editable", nativeName: "Editable", direction: "ltr" }),
  });
  assert.equal(res.status, 201);
  assert.equal(
    (await asSettings("/admin/editorial/settings/links", {
      method: "PATCH",
      body: JSON.stringify({ googlePlayUrl: "https://play.google.com/store/apps/details?id=settings.edit" }),
    })).status,
    200,
  );
});

// ─── Languages: creation and validation ─────────────────────────────────────

test("languages: migration 0126 seeds exactly one active default, 'en'", async () => {
  const en = await languageRow("en");
  assert.ok(en, "'en' exists");
  assert.equal(en.is_default, true);
  assert.equal(en.is_active, true);
  assert.deepEqual(await defaultCodes(), ["en"]);
});

test("languages: a simple two-letter code, a region tag, and a script+region tag are all accepted", async () => {
  for (const code of ["qa", "en-GB", "zh-Hant-TW"]) {
    const res = await asSuper("/admin/editorial/settings/languages", {
      method: "POST",
      body: JSON.stringify({ code, name: `N ${code}`, nativeName: `NN ${code}`, direction: "ltr" }),
    });
    assert.equal(res.status, 201, `${code}: ${JSON.stringify(await json(res.clone()))}`);
    assert.equal((await json(res)).code, code);
  }
});

test("languages: a code is canonicalized, so 'EN-gb' style input resolves to one stored spelling", async () => {
  const res = await asSuper("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({ code: "PT-br", name: "Portuguese (BR)", nativeName: "Português", direction: "ltr" }),
  });
  assert.equal(res.status, 201);
  assert.equal((await json(res)).code, "pt-BR", "lowercase language, uppercase region");
});

test("languages: a non-locale code is rejected with a helpful message", async () => {
  for (const code of ["English", "e", "en_GB", "en-GB-extra-long-variant"]) {
    const res = await asSuper("/admin/editorial/settings/languages", {
      method: "POST",
      body: JSON.stringify({ code, name: "X", nativeName: "X", direction: "ltr" }),
    });
    assert.equal(res.status, 400, `"${code}" must be rejected`);
    assert.match((await json(res)).error, /locale tag|at least|at most|characters/i);
  }
});

test("languages: a duplicate code is a 409, including a differently-cased spelling of it", async () => {
  const { code } = await createLanguageViaApi();
  const dupe = await asSuper("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({ code, name: "Dupe", nativeName: "Dupe", direction: "ltr" }),
  });
  assert.equal(dupe.status, 409);
  assert.match((await json(dupe)).error, /already registered/i);

  const cased = await asSuper("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({ code: code.toUpperCase(), name: "Cased", nativeName: "Cased", direction: "ltr" }),
  });
  assert.equal(cased.status, 409, "canonicalization means casing cannot smuggle in a second row");
});

test("languages: LTR and RTL are both stored and returned, and direction is editable", async () => {
  const rtl = await createLanguageViaApi({ direction: "rtl", name: "Arabic-like", nativeName: "عربي" });
  assert.equal((await languageRow(rtl.code)).direction, "rtl");

  const ltr = await createLanguageViaApi({ direction: "ltr" });
  assert.equal((await languageRow(ltr.code)).direction, "ltr");

  const res = await asSuper(`/admin/editorial/settings/languages/${ltr.id}`, {
    method: "PATCH",
    body: JSON.stringify({ direction: "rtl", displayOrder: 5 }),
  });
  assert.equal(res.status, 200);
  const updated = await json(res);
  assert.equal(updated.direction, "rtl");
  assert.equal(updated.displayOrder, 5);
  assert.equal(await auditCount("language_edited") >= 1, true);
});

test("languages: an invalid direction is rejected", async () => {
  const res = await asSuper("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({ code: freshCode(), name: "X", nativeName: "X", direction: "sideways" }),
  });
  assert.equal(res.status, 400);
});

test("languages: neither the code nor the active/default flags can be changed through PATCH", async () => {
  const { id, code } = await createLanguageViaApi();
  const res = await asSuper(`/admin/editorial/settings/languages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ code: "xx", isActive: false, isDefault: true, name: "Renamed" }),
  });
  assert.equal(res.status, 200, "unknown fields are simply not applied");
  const row = await languageRow(code);
  assert.equal(row.code, code, "the code — which every translation is keyed to — is unchanged");
  assert.equal(row.is_active, true, "isActive is not editable here");
  assert.equal(row.is_default, false, "isDefault is not editable here");
  const { rows } = await pool.query(`SELECT name FROM editorial_languages WHERE id = $1`, [id]);
  assert.equal(rows[0].name, "Renamed", "the legitimate field did change");
});

test("languages: creation is audited", async () => {
  const before = await auditCount("language_created");
  await createLanguageViaApi();
  assert.equal(await auditCount("language_created"), before + 1);
});

// ─── Single default: atomicity ──────────────────────────────────────────────

test("default: promotion demotes the incumbent atomically, leaving exactly one default", async () => {
  const { id, code } = await createLanguageViaApi();
  assert.deepEqual(await defaultCodes(), ["en"], "'en' starts as the default");

  const res = await asSuper(`/admin/editorial/settings/languages/${id}/default`, { method: "POST" });
  assert.equal(res.status, 200, JSON.stringify(await json(res.clone())));
  assert.equal((await json(res)).isDefault, true);

  assert.deepEqual(await defaultCodes(), [code], "exactly one default, and it is the new one");
  assert.equal((await languageRow("en")).is_default, false, "the incumbent was demoted in the same transaction");
  assert.ok(await auditCount("language_default_changed") >= 1, "the change is audited");

  // Put 'en' back so later tests start from the seeded state.
  const en = await languageRow("en");
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/default`, { method: "POST" })).status, 200);
  assert.deepEqual(await defaultCodes(), ["en"]);
});

test("default: the DATABASE rejects a second default even against direct SQL", async () => {
  // The invariant is not merely application ordering: the partial unique
  // index `editorial_languages_single_default` (UNIQUE (is_default) WHERE
  // is_default) is what makes two concurrent promotions impossible.
  const { id } = await createLanguageViaApi();
  await assert.rejects(
    () => pool.query(`UPDATE editorial_languages SET is_default = true WHERE id = $1`, [id]),
    /editorial_languages_single_default/,
  );
  assert.deepEqual(await defaultCodes(), ["en"], "still exactly one default");
});

test("default: promoting the language that is already default is a 409 no-op", async () => {
  const en = await languageRow("en");
  const res = await asSuper(`/admin/editorial/settings/languages/${en.id}/default`, { method: "POST" });
  assert.equal(res.status, 409);
  assert.match((await json(res)).error, /already the default/i);
});

test("default: an INACTIVE language cannot be promoted to default", async () => {
  const { id } = await createLanguageViaApi();
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${id}/deactivate`, { method: "POST" })).status, 200);
  const res = await asSuper(`/admin/editorial/settings/languages/${id}/default`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /inactive/i);
  assert.deepEqual(await defaultCodes(), ["en"]);
});

test("default: a language can be created AS the default, atomically demoting the incumbent", async () => {
  const code = freshCode();
  const res = await asSuper("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({ code, name: "Born default", nativeName: "Born default", direction: "ltr", isDefault: true }),
  });
  assert.equal(res.status, 201, JSON.stringify(await json(res.clone())));
  assert.deepEqual(await defaultCodes(), [code]);

  const en = await languageRow("en");
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/default`, { method: "POST" })).status, 200);
});

test("default: creating a language as an INACTIVE default is rejected", async () => {
  const res = await asSuper("/admin/editorial/settings/languages", {
    method: "POST",
    body: JSON.stringify({
      code: freshCode(), name: "X", nativeName: "X", direction: "ltr",
      isDefault: true, isActive: false,
    }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /must be active/i);
});

// ─── Deactivation rules ─────────────────────────────────────────────────────

test("deactivate: the CURRENT DEFAULT cannot be deactivated, and the message says what to do first", async () => {
  const en = await languageRow("en");
  const res = await asSuper(`/admin/editorial/settings/languages/${en.id}/deactivate`, { method: "POST" });
  assert.equal(res.status, 409);
  assert.match((await json(res)).error, /default website language.*another active language the default first/i);
  assert.equal((await languageRow("en")).is_active, true, "nothing changed");
});

test("deactivate: the DATABASE CHECK also makes a deactivated default unrepresentable", async () => {
  await assert.rejects(
    () => pool.query(`UPDATE editorial_languages SET is_active = false WHERE code = 'en'`),
    /editorial_languages_default_is_active/,
  );
});

test("deactivate: promoting another active language to default FIRST makes the old default deactivatable", async () => {
  const { id: successorId, code: successorCode } = await createLanguageViaApi();
  const en = await languageRow("en");

  assert.equal((await asSuper(`/admin/editorial/settings/languages/${successorId}/default`, { method: "POST" })).status, 200);
  const res = await asSuper(`/admin/editorial/settings/languages/${en.id}/deactivate`, { method: "POST" });
  assert.equal(res.status, 200, JSON.stringify(await json(res.clone())));
  assert.equal((await languageRow("en")).is_active, false);
  assert.deepEqual(await defaultCodes(), [successorCode]);

  // Restore the seeded state for later tests.
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/activate`, { method: "POST" })).status, 200);
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/default`, { method: "POST" })).status, 200);
});

test("deactivate: the ONLY active language cannot be deactivated", async () => {
  // Park every other language inactive, leaving exactly one active.
  const { rows } = await pool.query(`SELECT id, code, is_default FROM editorial_languages WHERE is_active = true`);
  const others = rows.filter((r: { is_default: boolean }) => !r.is_default);
  for (const other of others) {
    assert.equal(
      (await asSuper(`/admin/editorial/settings/languages/${other.id}/deactivate`, { method: "POST" })).status,
      200,
      `park ${other.code}`,
    );
  }
  const { rows: active } = await pool.query(`SELECT count(*)::int AS n FROM editorial_languages WHERE is_active = true`);
  assert.equal(active[0].n, 1, "exactly one active language remains");

  // That one is also the default, so BOTH rules would refuse it — assert
  // the refusal, then add a second active language and retry so the
  // "only active" rule is exercised on its own.
  const en = await languageRow("en");
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/deactivate`, { method: "POST" })).status, 409);

  const spare = await createLanguageViaApi();
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${spare.id}/default`, { method: "POST" })).status, 200);
  // Now 'en' is active-but-not-default and `spare` is the active default.
  // Deactivating 'en' leaves one active language, which is allowed;
  // deactivating `spare` after that must be refused as the last one.
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/deactivate`, { method: "POST" })).status, 200);
  const last = await asSuper(`/admin/editorial/settings/languages/${spare.id}/deactivate`, { method: "POST" });
  assert.equal(last.status, 409);
  assert.match((await json(last)).error, /only active website language|default website language/i);

  // Restore.
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/activate`, { method: "POST" })).status, 200);
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${en.id}/default`, { method: "POST" })).status, 200);
});

test("deactivate: a double deactivate (or double activate) is a 409, not a silent no-op", async () => {
  const { id } = await createLanguageViaApi();
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${id}/deactivate`, { method: "POST" })).status, 200);
  const again = await asSuper(`/admin/editorial/settings/languages/${id}/deactivate`, { method: "POST" });
  assert.equal(again.status, 409);
  assert.match((await json(again)).error, /already inactive/i);

  assert.equal((await asSuper(`/admin/editorial/settings/languages/${id}/activate`, { method: "POST" })).status, 200);
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${id}/activate`, { method: "POST" })).status, 409);
});

test("deactivate: the language is RETAINED, still listed, and NO translation's stored status changes", async () => {
  const { id, code } = await createLanguageViaApi();

  // Real content in that language: one published, one draft.
  const { rows: a } = await pool.query(
    `INSERT INTO editorial_authors (channel, public_name, role, biography) VALUES ('news','A','Staff','bio') RETURNING id`,
  );
  const { rows: p } = await pool.query(
    `INSERT INTO editorial_posts (channel, author_id) VALUES ('news', $1) RETURNING id`,
    [a[0].id],
  );
  const postId = p[0].id;
  const { rows: t1 } = await pool.query(
    `INSERT INTO editorial_post_translations (post_id, language_id, channel, title, slug, status, body, published_at)
     VALUES ($1, $2, 'news', 'Live', $3, 'published', '{"blocks":[]}'::jsonb, now()) RETURNING id`,
    [postId, id, `live-${code}-${RUN}`],
  );
  const { rows: p2 } = await pool.query(
    `INSERT INTO editorial_posts (channel, author_id) VALUES ('news', $1) RETURNING id`,
    [a[0].id],
  );
  const { rows: t2 } = await pool.query(
    `INSERT INTO editorial_post_translations (post_id, language_id, channel, title, slug, status, body)
     VALUES ($1, $2, 'news', 'Draft', $3, 'draft', '{"blocks":[]}'::jsonb) RETURNING id`,
    [p2[0].id, id, `draft-${code}-${RUN}`],
  );

  assert.equal((await asSuper(`/admin/editorial/settings/languages/${id}/deactivate`, { method: "POST" })).status, 200);

  const { rows: after } = await pool.query(
    `SELECT id, status FROM editorial_post_translations WHERE id = ANY($1::int[]) ORDER BY id`,
    [[t1[0].id, t2[0].id]],
  );
  assert.deepEqual(
    after.map((r: { status: string }) => r.status).sort(),
    ["draft", "published"],
    "deactivating a language rewrites no content",
  );

  // Still listed by default (retained, not hidden), with usage counts.
  const all = await json(await asSuper("/admin/editorial/settings/languages"));
  const mine = all.find((l: { code: string }) => l.code === code);
  assert.ok(mine, "an inactive language is still returned");
  assert.equal(mine.isActive, false);
  assert.equal(mine.translationCounts.published, 1, "usage is reported so an editor sees the impact");
  assert.equal(mine.translationCounts.draft, 1);

  // ...but excluded when the caller asks for active only.
  const activeOnly = await json(await asSuper("/admin/editorial/settings/languages?activeOnly=true"));
  assert.ok(!activeOnly.some((l: { code: string }) => l.code === code), "activeOnly excludes it");

  // Reactivating likewise mutates no content.
  assert.equal((await asSuper(`/admin/editorial/settings/languages/${id}/activate`, { method: "POST" })).status, 200);
  const { rows: after2 } = await pool.query(
    `SELECT status FROM editorial_post_translations WHERE id = ANY($1::int[]) ORDER BY status`,
    [[t1[0].id, t2[0].id]],
  );
  assert.deepEqual(after2.map((r: { status: string }) => r.status), ["draft", "published"]);

  assert.ok(await auditCount("language_deactivated") >= 1);
  assert.ok(await auditCount("language_activated") >= 1);
});

test("languages: a language in use cannot be DELETED — the FK is ON DELETE RESTRICT", async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT language_id FROM editorial_post_translations LIMIT 1`,
  );
  assert.ok(rows[0], "the previous test left content behind to reference a language");
  await assert.rejects(
    () => pool.query(`DELETE FROM editorial_languages WHERE id = $1`, [rows[0].language_id]),
    /violates RESTRICT|foreign key constraint/i,
  );
});

test("languages: unknown id is a 404 on read, edit, and every transition", async () => {
  assert.equal((await asSuper("/admin/editorial/settings/languages/99999999")).status, 404);
  assert.equal(
    (await asSuper("/admin/editorial/settings/languages/99999999", {
      method: "PATCH", body: JSON.stringify({ name: "X" }),
    })).status,
    404,
  );
  for (const action of ["activate", "deactivate", "default"]) {
    assert.equal(
      (await asSuper(`/admin/editorial/settings/languages/99999999/${action}`, { method: "POST" })).status,
      404,
      action,
    );
  }
});

// ─── Links ──────────────────────────────────────────────────────────────────

test("links: the singleton row is id = 1, and BOTH URLs unset is a legitimate readable state", async () => {
  // Migration 0126 seeds this row with both URLs NULL. An earlier test in
  // this file legitimately writes a URL, so "unset" is re-established here
  // rather than assumed from test order — what is asserted is that the row
  // is the singleton id = 1 and that NULL round-trips as null on the wire.
  // The fresh-migration seed itself is verified in the migration pass.
  await pool.query(`UPDATE editorial_website_links SET google_play_url = NULL, app_store_url = NULL WHERE id = 1`);
  const res = await asSuper("/admin/editorial/settings/links");
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.id, 1);
  assert.equal(body.googlePlayUrl, null);
  assert.equal(body.appStoreUrl, null);

  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM editorial_website_links`);
  assert.equal(rows[0].n, 1, "exactly one settings row exists");
});

test("links: valid https URLs are stored, and each changed field is audited separately", async () => {
  const play = "https://play.google.com/store/apps/details?id=app.centralstudio";
  const store = "https://apps.apple.com/app/id123456789";
  const res = await asSuper("/admin/editorial/settings/links", {
    method: "PATCH",
    body: JSON.stringify({ googlePlayUrl: play, appStoreUrl: store }),
  });
  assert.equal(res.status, 200, JSON.stringify(await json(res.clone())));
  const body = await json(res);
  assert.equal(body.googlePlayUrl, play);
  assert.equal(body.appStoreUrl, store);
  assert.ok(await auditCount("links_google_play_changed") >= 1);
  assert.ok(await auditCount("links_app_store_changed") >= 1);
});

test("links: an http URL is rejected — https is required", async () => {
  const res = await asSuper("/admin/editorial/settings/links", {
    method: "PATCH",
    body: JSON.stringify({ googlePlayUrl: "http://play.google.com/store/apps/details?id=x" }),
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /must use https/i);
});

test("links: a malformed URL, a non-http scheme, and markup characters are all rejected", async () => {
  const cases: Array<[string, RegExp]> = [
    ["not-a-url", /not a valid URL|must use https/i],
    ["javascript:alert(1)", /must use https/i],
    ["https://apps.apple.com/\"><script>", /not allowed in a URL/i],
    ["https://apps apple.com/x", /not allowed in a URL/i],
    ["https://", /not a valid URL|must include a host/i],
  ];
  for (const [value, pattern] of cases) {
    const res = await asSuper("/admin/editorial/settings/links", {
      method: "PATCH",
      body: JSON.stringify({ appStoreUrl: value }),
    });
    assert.equal(res.status, 400, `"${value}" must be rejected`);
    assert.match((await json(res)).error, pattern, `"${value}"`);
  }
});

test("links: a rejected value leaves the stored value untouched", async () => {
  const good = "https://apps.apple.com/app/id999";
  assert.equal(
    (await asSuper("/admin/editorial/settings/links", { method: "PATCH", body: JSON.stringify({ appStoreUrl: good }) })).status,
    200,
  );
  assert.equal(
    (await asSuper("/admin/editorial/settings/links", { method: "PATCH", body: JSON.stringify({ appStoreUrl: "http://x.com" }) })).status,
    400,
  );
  const { rows } = await pool.query(`SELECT app_store_url FROM editorial_website_links WHERE id = 1`);
  assert.equal(rows[0].app_store_url, good, "the bad payload never reached the row");
});

test("links: an empty string and an explicit null both clear the field (normalized to NULL)", async () => {
  await asSuper("/admin/editorial/settings/links", {
    method: "PATCH",
    body: JSON.stringify({
      googlePlayUrl: "https://play.google.com/store/apps/details?id=clear.me",
      appStoreUrl: "https://apps.apple.com/app/id555",
    }),
  });

  const cleared = await asSuper("/admin/editorial/settings/links", {
    method: "PATCH",
    body: JSON.stringify({ googlePlayUrl: "", appStoreUrl: null }),
  });
  assert.equal(cleared.status, 200);
  const body = await json(cleared);
  assert.equal(body.googlePlayUrl, null, '"" is normalized to NULL, so unset has one spelling');
  assert.equal(body.appStoreUrl, null);
});

test("links: a PATCH omitting a field leaves that field alone", async () => {
  const play = "https://play.google.com/store/apps/details?id=partial";
  await asSuper("/admin/editorial/settings/links", {
    method: "PATCH",
    body: JSON.stringify({ googlePlayUrl: play, appStoreUrl: "https://apps.apple.com/app/id777" }),
  });
  const res = await asSuper("/admin/editorial/settings/links", {
    method: "PATCH",
    body: JSON.stringify({ appStoreUrl: "https://apps.apple.com/app/id888" }),
  });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.googlePlayUrl, play, "the omitted field is untouched");
  assert.equal(body.appStoreUrl, "https://apps.apple.com/app/id888");
});

test("links: a PATCH that changes nothing writes no audit row", async () => {
  const url = "https://play.google.com/store/apps/details?id=noop";
  await asSuper("/admin/editorial/settings/links", { method: "PATCH", body: JSON.stringify({ googlePlayUrl: url }) });
  const before = await auditCount("links_google_play_changed");
  assert.equal(
    (await asSuper("/admin/editorial/settings/links", { method: "PATCH", body: JSON.stringify({ googlePlayUrl: url }) })).status,
    200,
  );
  assert.equal(await auditCount("links_google_play_changed"), before, "an unchanged value is not an event");
});

test("links: the DATABASE also refuses a non-https value and a second row", async () => {
  await assert.rejects(
    () => pool.query(`UPDATE editorial_website_links SET google_play_url = 'http://x.com/a' WHERE id = 1`),
    /google_play_url_https/,
  );
  await assert.rejects(
    () => pool.query(`INSERT INTO editorial_website_links (id) VALUES (2)`),
    /singleton/,
  );
});
