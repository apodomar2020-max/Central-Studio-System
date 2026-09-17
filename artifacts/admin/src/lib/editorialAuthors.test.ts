/**
 * Wave 2.1C — Authors presentation logic.
 *
 * Real behaviour tests: lib/editorial-authors.ts is a pure module with no
 * React and no `import.meta.env`, so every rule and every piece of
 * operator-facing copy is exercised directly rather than by regex. The screen
 * itself is covered by source inspection in
 * pages/editorial/editorialAuthorsPage.test.ts, matching the established Admin
 * convention for `.tsx`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTHOR_AVATAR_ALLOWED_HOSTS_HINT,
  AUTHOR_BIOGRAPHY_HELP,
  AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION,
  AUTHOR_FROZEN_BYLINE_NOTICE,
  AUTHOR_PUBLIC_NAME_MAX,
  AUTHOR_ROLE_MAX,
  BYLINE_COLUMN_EXPLANATION,
  CHANNEL_OPTIONS,
  DEFAULT_AUTHOR_FILTERS,
  EMPTY_AUTHOR_FORM,
  activeAuthorFilterCount,
  archiveAuthorConfirmation,
  avatarUrlShapeError,
  bylineState,
  bylineStatusLabel,
  channelLabel,
  filterAuthors,
  hasAuthorFormErrors,
  isBylineReady,
  reactivateAuthorMessage,
  toAuthorCreatePayload,
  toAuthorUpdatePayload,
  validateAuthorForm,
  type AuthorFormValues,
  type AuthorRowLike,
} from "./editorial-authors.ts";

const form = (over: Partial<AuthorFormValues> = {}): AuthorFormValues => ({
  ...EMPTY_AUTHOR_FORM,
  publicName: "Nour Hassan",
  role: "Resident choreographer",
  ...over,
});

const row = (over: Partial<AuthorRowLike> = {}): AuthorRowLike => ({
  publicName: "Nour Hassan",
  role: "Resident choreographer",
  channel: "news",
  status: "active",
  ...over,
});

// ─── Byline readiness (D3) — all four cases ─────────────────────────────────

test("active + biography → Ready", () => {
  const author = { status: "active" as const, biography: "Twenty years on stage." };
  assert.equal(isBylineReady(author), true);
  assert.equal(bylineState(author), "ready");
  assert.equal(bylineStatusLabel(author), "Ready");
});

test("active + null biography → Needs biography", () => {
  const author = { status: "active" as const, biography: null };
  assert.equal(isBylineReady(author), false);
  assert.equal(bylineState(author), "needs-biography");
  assert.equal(bylineStatusLabel(author), "Needs biography");
});

test("active + whitespace-only biography → Needs biography", () => {
  for (const biography of ["   ", "\n\t ", ""]) {
    const author = { status: "active" as const, biography };
    assert.equal(isBylineReady(author), false, `whitespace bio ${JSON.stringify(biography)}`);
    assert.equal(bylineStatusLabel(author), "Needs biography");
  }
});

test("archived takes precedence over the biography check, even with a full biography", () => {
  const author = { status: "archived" as const, biography: "Twenty years on stage." };
  assert.equal(isBylineReady(author), false);
  assert.equal(bylineState(author), "archived");
  assert.equal(bylineStatusLabel(author), "Archived");
  // And archived with no biography is still "Archived", not "Needs biography".
  assert.equal(bylineStatusLabel({ status: "archived", biography: null }), "Archived");
});

test("the byline derivation mirrors the real publish gate's two author-side rules", () => {
  const service = readFileSync(
    new URL("../../../api-server/src/lib/editorialPostsService.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    service.includes('author.status !== "active"'),
    "the publish gate no longer checks author.status — the byline column may be wrong",
  );
  assert.ok(
    service.includes("author.biography.trim().length === 0"),
    "the publish gate no longer trims the biography — the byline column may be wrong",
  );
});

test("the byline explanation is byline-scoped, never claiming a post is publish-ready", () => {
  assert.match(BYLINE_COLUMN_EXPLANATION, /byline/i);
  assert.doesNotMatch(BYLINE_COLUMN_EXPLANATION, /publish-ready/i);
  assert.match(AUTHOR_BIOGRAPHY_HELP, /Required before posts using this byline can be published\./);
});

// ─── Validation ──────────────────────────────────────────────────────────────

test("validateAuthorForm accepts a well-formed create, biography and avatar empty", () => {
  assert.deepEqual(validateAuthorForm(form(), { requireChannel: true }), {});
  assert.equal(hasAuthorFormErrors({}), false);
});

test("publicName is required and capped at 200", () => {
  assert.equal(
    validateAuthorForm(form({ publicName: "  " }), { requireChannel: true }).publicName,
    "A public name is required.",
  );
  assert.equal(
    validateAuthorForm(form({ publicName: "x".repeat(AUTHOR_PUBLIC_NAME_MAX + 1) }), { requireChannel: true }).publicName,
    `A public name can be at most ${AUTHOR_PUBLIC_NAME_MAX} characters.`,
  );
  assert.equal(
    validateAuthorForm(form({ publicName: "x".repeat(AUTHOR_PUBLIC_NAME_MAX) }), { requireChannel: true }).publicName,
    undefined,
  );
});

test("role is required and capped at 200", () => {
  assert.equal(validateAuthorForm(form({ role: "" }), { requireChannel: true }).role, "A role is required.");
  assert.equal(
    validateAuthorForm(form({ role: "x".repeat(AUTHOR_ROLE_MAX + 1) }), { requireChannel: true }).role,
    `A role can be at most ${AUTHOR_ROLE_MAX} characters.`,
  );
});

test("biography stays optional with no maximum (D3) — it is never a validation error", () => {
  assert.equal(validateAuthorForm(form({ biography: "" }), { requireChannel: true }).biography, undefined);
  assert.equal(validateAuthorForm(form({ biography: "   " }), { requireChannel: true }).biography, undefined);
  assert.equal(
    validateAuthorForm(form({ biography: "x".repeat(10_000) }), { requireChannel: true }).biography,
    undefined,
  );
});

test("channel is required on create and not validated on edit", () => {
  const bad = form({ channel: "podcast" as never });
  assert.equal(validateAuthorForm(bad, { requireChannel: true }).channel, "A channel is required.");
  assert.equal(validateAuthorForm(bad, { requireChannel: false }).channel, undefined);
});

// ─── Avatar shape check — advisory, never a host allowlist ──────────────────

test("the avatar shape check accepts https and an empty value, rejects http and garbage", () => {
  assert.equal(avatarUrlShapeError(""), undefined);
  assert.equal(avatarUrlShapeError("   "), undefined);
  assert.equal(avatarUrlShapeError("https://images.unsplash.com/photo-1.jpg"), undefined);
  assert.equal(avatarUrlShapeError("http://images.unsplash.com/photo-1.jpg"), "The link must start with https://");
  assert.equal(avatarUrlShapeError("images.unsplash.com/photo-1.jpg"), "Enter a full link, starting with https://");
  assert.equal(avatarUrlShapeError("not a url at all"), "Enter a full link, starting with https://");
});

test("the client NEVER blocks on the host allowlist — the server is the trust boundary", () => {
  // A perfectly-formed https link on a host the SERVER will reject must still
  // pass the client check, so the operator sees the server's real 400.
  assert.equal(avatarUrlShapeError("https://example.com/not-allowed.png"), undefined);
  assert.equal(
    validateAuthorForm(form({ avatarUrl: "https://example.com/not-allowed.png" }), { requireChannel: true }).avatarUrl,
    undefined,
  );
});

test("the allowed-hosts hint restates the server constant it must be hand-synced with", () => {
  const server = readFileSync(
    new URL("../../../api-server/src/lib/editorialMediaUrl.ts", import.meta.url),
    "utf8",
  );
  const block = server.slice(
    server.indexOf("EDITORIAL_ALLOWED_MEDIA_HOSTS = ["),
    server.indexOf("] as const;", server.indexOf("EDITORIAL_ALLOWED_MEDIA_HOSTS = [")),
  );
  const hosts = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hosts.length > 0, "could not read the server allowlist");
  for (const host of hosts) {
    assert.ok(
      AUTHOR_AVATAR_ALLOWED_HOSTS_HINT.includes(host),
      `the Admin hint has drifted — it does not mention ${host}`,
    );
  }
});

// ─── Payload mapping: null vs undefined ─────────────────────────────────────

test("create maps an empty biography and avatar to null, never to an empty string", () => {
  const payload = toAuthorCreatePayload(form({ biography: "", avatarUrl: "" }));
  assert.equal(payload.biography, null);
  assert.equal(payload.avatarUrl, null);
  assert.notEqual(payload.biography as unknown, "");
  // Whitespace-only counts as empty too.
  assert.equal(toAuthorCreatePayload(form({ biography: "   " })).biography, null);
});

test("create trims and never sends systemUserId or status", () => {
  const payload = toAuthorCreatePayload(form({ publicName: "  Nour  ", role: " Critic ", biography: " Bio " }));
  assert.equal(payload.publicName, "Nour");
  assert.equal(payload.role, "Critic");
  assert.equal(payload.biography, "Bio");
  assert.deepEqual(Object.keys(payload).sort(), ["avatarUrl", "biography", "channel", "publicName", "role"]);
});

const original = {
  publicName: "Nour Hassan",
  role: "Resident choreographer",
  biography: "Twenty years on stage.",
  avatarUrl: "https://images.unsplash.com/a.jpg",
};

test("update omits untouched fields entirely — undefined, not null", () => {
  const payload = toAuthorUpdatePayload(
    form({ biography: original.biography, avatarUrl: original.avatarUrl }),
    original,
  );
  assert.deepEqual(payload, {}, "an unchanged form must send nothing at all");
  assert.equal("biography" in payload, false);
  assert.equal("avatarUrl" in payload, false);
});

test("update sends null only when the operator actually clears a field", () => {
  const cleared = toAuthorUpdatePayload(
    form({ biography: "", avatarUrl: "", publicName: original.publicName, role: original.role }),
    original,
  );
  assert.deepEqual(cleared, { biography: null, avatarUrl: null });
});

test("update sends only the changed fields, and never channel, status or systemUserId", () => {
  const payload = toAuthorUpdatePayload(
    form({ publicName: "Nour H.", role: original.role, biography: original.biography, avatarUrl: original.avatarUrl }),
    original,
  );
  assert.deepEqual(payload, { publicName: "Nour H." });
  for (const key of ["channel", "status", "systemUserId"]) {
    assert.equal(key in payload, false, `${key} must never be sent from the edit dialog`);
  }
});

test("update treats a null original biography and an empty textarea as the same value", () => {
  const payload = toAuthorUpdatePayload(form({ biography: "" }), { ...original, biography: null });
  assert.equal("biography" in payload, false);
});

// ─── Filtering ───────────────────────────────────────────────────────────────

const rows: AuthorRowLike[] = [
  row({ publicName: "Nour Hassan", role: "Resident choreographer", channel: "news", status: "active" }),
  row({ publicName: "Sara Adel", role: "Guest critic", channel: "news", status: "archived" }),
  row({ publicName: "Omar Fathy", role: "Stage manager", channel: "experience", status: "active" }),
  row({ publicName: "Layla Samir", role: "Photographer", channel: "experience", status: "archived" }),
];

test("the default filters show every row, archived included (D2)", () => {
  assert.equal(DEFAULT_AUTHOR_FILTERS.status, "all");
  assert.equal(DEFAULT_AUTHOR_FILTERS.channel, "all");
  assert.equal(filterAuthors(rows, DEFAULT_AUTHOR_FILTERS).length, 4);
  assert.ok(filterAuthors(rows, DEFAULT_AUTHOR_FILTERS).some((r) => r.status === "archived"));
});

test("search matches publicName and role, case-insensitively", () => {
  assert.deepEqual(
    filterAuthors(rows, { ...DEFAULT_AUTHOR_FILTERS, search: "OMAR" }).map((r) => r.publicName),
    ["Omar Fathy"],
  );
  assert.deepEqual(
    filterAuthors(rows, { ...DEFAULT_AUTHOR_FILTERS, search: "critic" }).map((r) => r.publicName),
    ["Sara Adel"],
  );
  assert.equal(filterAuthors(rows, { ...DEFAULT_AUTHOR_FILTERS, search: "  " }).length, 4);
  assert.equal(filterAuthors(rows, { ...DEFAULT_AUTHOR_FILTERS, search: "nobody" }).length, 0);
});

test("channel and status filters narrow independently and together", () => {
  assert.equal(filterAuthors(rows, { ...DEFAULT_AUTHOR_FILTERS, channel: "news" }).length, 2);
  assert.equal(filterAuthors(rows, { ...DEFAULT_AUTHOR_FILTERS, status: "active" }).length, 2);
  assert.deepEqual(
    filterAuthors(rows, { ...DEFAULT_AUTHOR_FILTERS, channel: "news", status: "archived" }).map((r) => r.publicName),
    ["Sara Adel"],
  );
});

test("activeAuthorFilterCount counts only the non-default filters", () => {
  assert.equal(activeAuthorFilterCount(DEFAULT_AUTHOR_FILTERS), 0);
  assert.equal(activeAuthorFilterCount({ ...DEFAULT_AUTHOR_FILTERS, search: "x" }), 0);
  assert.equal(activeAuthorFilterCount({ ...DEFAULT_AUTHOR_FILTERS, status: "archived" }), 1);
  assert.equal(activeAuthorFilterCount({ ...DEFAULT_AUTHOR_FILTERS, channel: "news", status: "archived" }), 2);
});

// ─── Copy ────────────────────────────────────────────────────────────────────

test("archive copy names the author, states every real consequence, and is NOT destructive-styled", () => {
  const copy = archiveAuthorConfirmation({ publicName: "Nour Hassan" });
  assert.match(copy.title, /Nour Hassan/);
  assert.match(copy.description, /Nothing is deleted\./);
  assert.match(copy.description, /can no longer be assigned to new posts/);
  assert.match(copy.description, /cannot be published until an active author is chosen/);
  assert.match(copy.description, /Posts already published are unaffected\./);
  assert.match(copy.description, /reactivate them at any time/);
  assert.equal(copy.confirmLabel, "Archive author");
  // The shared confirm defaults to destructive: true; archiving is retention.
  assert.equal(copy.destructive, false);
});

test("reactivate copy states nothing about a post's byline changes", () => {
  const message = reactivateAuthorMessage({ publicName: "Nour Hassan" });
  assert.match(message, /Nour Hassan/);
  assert.match(message, /No post's byline is changed\./);
});

test("the frozen-byline notice matches the real snapshot behaviour", () => {
  assert.match(AUTHOR_FROZEN_BYLINE_NOTICE, /every draft that uses it/);
  assert.match(AUTHOR_FROZEN_BYLINE_NOTICE, /Posts already published keep the byline they were published with/);
  assert.match(AUTHOR_FROZEN_BYLINE_NOTICE, /reassign the author on the post itself/);
  const route = readFileSync(
    new URL("../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    route.includes("frozen bylines on published translations are unchanged"),
    "the author PATCH route no longer claims frozen bylines are untouched — the notice may be wrong",
  );
});

test("the channel immutability explanation is a non-empty exported constant", () => {
  assert.ok(AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION.length > 0);
  assert.match(AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION, /cannot be changed/);
  assert.match(AUTHOR_CHANNEL_IMMUTABLE_EXPLANATION, /separate author profile/);
});

test("channel labels and options are real words", () => {
  assert.equal(channelLabel("news"), "News");
  assert.equal(channelLabel("experience"), "Experience");
  assert.deepEqual(CHANNEL_OPTIONS.map((o) => o.value), ["news", "experience"]);
});

test("systemUserId appears nowhere in the Authors logic module except as a documented omission (D1)", () => {
  const source = readFileSync(new URL("./editorial-authors.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /systemUserId/);
});
