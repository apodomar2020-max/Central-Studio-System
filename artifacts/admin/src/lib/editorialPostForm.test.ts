/**
 * Wave 2.1D — payload separation, dirty comparison, publish readiness.
 *
 * The forbidden-key assertions here are the structural proof that shared and
 * translation scopes cannot leak into each other.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { toEditableBlocks } from "./editorial-post-body.ts";
import { describeSlugProblem } from "./editorial-posts.ts";
import {
  EMPTY_CREATE_FORM,
  EMPTY_TRANSLATION_FORM,
  READINESS_LABELS,
  areTopicsDirty,
  blockingReadiness,
  isPublishReady,
  isSharedDirty,
  isTranslationDirty,
  publishReadiness,
  readingTimeError,
  readingTimeOrNull,
  toCreatePostPayload,
  toSharedUpdatePayload,
  toTopicsPayload,
  toTranslationFormValues,
  toTranslationUpdatePayload,
  validateCreateForm,
  type SharedFormValues,
  type TranslationFormValues,
} from "./editorial-post-form.ts";

const serverService = readFileSync(
  new URL("../../../api-server/src/lib/editorialPostsService.ts", import.meta.url),
  "utf8",
);
const serverRoutes = readFileSync(
  new URL("../../../api-server/src/routes/adminEditorial.ts", import.meta.url),
  "utf8",
);

const ORIGINAL: TranslationFormValues = {
  ...EMPTY_TRANSLATION_FORM,
  title: "Opening night",
  slug: "opening-night",
  deck: "A deck",
  blocks: toEditableBlocks({ blocks: [{ type: "paragraph", text: "hello" }] }),
};

const UNLOCKED = { slugLocked: false };
const LOCKED = { slugLocked: true };

// ─── Translation payload ─────────────────────────────────────────────────────

test("an untouched form produces an EMPTY payload — nothing is sent", () => {
  assert.deepEqual(toTranslationUpdatePayload(ORIGINAL, ORIGINAL, UNLOCKED), {});
  assert.equal(isTranslationDirty(ORIGINAL, ORIGINAL, UNLOCKED), false);
});

test("only changed fields are sent (undefined = leave alone)", () => {
  const payload = toTranslationUpdatePayload({ ...ORIGINAL, title: "New title" }, ORIGINAL, UNLOCKED);
  assert.deepEqual(payload, { title: "New title" });
  assert.equal("deck" in payload, false, "an untouched optional field must be OMITTED, not cleared");
});

test("an emptied optional field sends null, never an empty string", () => {
  const payload = toTranslationUpdatePayload({ ...ORIGINAL, deck: "   " }, ORIGINAL, UNLOCKED);
  assert.deepEqual(payload, { deck: null });
  // The route copies a key only when it is !== undefined.
  assert.match(serverRoutes, /body\.featureImageUrl !== undefined/);
});

test("THE TRANSLATION PAYLOAD CAN NEVER CARRY A SHARED OR LIFECYCLE KEY", () => {
  const payload = toTranslationUpdatePayload(
    { ...ORIGINAL, title: "x", deck: "y", seoTitle: "z", ogImageUrl: "https://a.test/b.jpg" },
    ORIGINAL,
    UNLOCKED,
  );
  for (const forbidden of ["channel", "authorId", "featureImageUrl", "topicIds", "status", "publishedAt", "authorSnapshot", "bodyVersion"]) {
    assert.equal(forbidden in payload, false, `translation payload leaked ${forbidden}`);
  }
});

test("lifecycle status can never ride an ordinary translation PATCH", () => {
  // Structural: even if a caller forced `status` into the values object, the
  // mapper reads named fields only.
  const contaminated = { ...ORIGINAL, status: "published" } as unknown as TranslationFormValues;
  const payload = toTranslationUpdatePayload({ ...contaminated, title: "x" }, ORIGINAL, UNLOCKED);
  assert.equal("status" in payload, false);
  // And the service's own update loop never copies it.
  const loop = serverService.slice(serverService.indexOf("export async function updateTranslation"));
  const keys = loop.slice(loop.indexOf("for (const key of ["), loop.indexOf("] as const"));
  assert.doesNotMatch(keys, /"status"|"publishedAt"|"slug"/);
});

test("a LOCKED slug is never submitted, even if the value differs", () => {
  const payload = toTranslationUpdatePayload({ ...ORIGINAL, slug: "something-else" }, ORIGINAL, LOCKED);
  assert.equal("slug" in payload, false, "a published translation's slug must never be sent");
  const unlocked = toTranslationUpdatePayload({ ...ORIGINAL, slug: "something-else" }, ORIGINAL, UNLOCKED);
  assert.equal(unlocked.slug, "something-else");
});

test("a blank slug field on an existing translation means unchanged, not regenerate", () => {
  const payload = toTranslationUpdatePayload({ ...ORIGINAL, slug: "" }, ORIGINAL, UNLOCKED);
  assert.equal("slug" in payload, false);
});

test("body is sent only when the STRUCTURE changed — a re-keyed identical body is clean", () => {
  const rekeyed = { ...ORIGINAL, blocks: toEditableBlocks({ blocks: [{ type: "paragraph", text: "hello" }] }) };
  assert.deepEqual(toTranslationUpdatePayload(rekeyed, ORIGINAL, UNLOCKED), {});
  const edited = { ...ORIGINAL, blocks: toEditableBlocks({ blocks: [{ type: "paragraph", text: "changed" }] }) };
  const payload = toTranslationUpdatePayload(edited, ORIGINAL, UNLOCKED);
  assert.deepEqual(payload.body, { blocks: [{ type: "paragraph", text: "changed" }] });
});

test("trailing whitespace typed then removed does not leave the editor permanently dirty", () => {
  assert.equal(isTranslationDirty({ ...ORIGINAL, title: "Opening night  " }, ORIGINAL, UNLOCKED), false);
});

test("read time is a REAL writable override; blank clears it", () => {
  assert.match(serverService, /"readingTimeOverrideMinutes"/);
  assert.equal(readingTimeOrNull(""), null);
  assert.equal(readingTimeOrNull("7"), 7);
  assert.equal(readingTimeError(""), undefined);
  assert.equal(readingTimeError("7"), undefined);
  assert.match(readingTimeError("abc")!, /whole number of minutes/);
  assert.match(readingTimeError("0")!, /whole number of minutes/);
  const payload = toTranslationUpdatePayload({ ...ORIGINAL, readingTimeOverrideMinutes: "7" }, ORIGINAL, UNLOCKED);
  assert.equal(payload.readingTimeOverrideMinutes, 7);
});

test("toTranslationFormValues maps every nullable column to a controlled string", () => {
  const values = toTranslationFormValues(
    {
      title: "T", slug: "t", deck: null, contextLabel: null, featureImageAlt: null,
      readingTimeOverrideMinutes: null, seoTitle: null, seoDescription: null, ogImageUrl: null,
      status: "draft", publishedAt: null,
    },
    [],
  );
  for (const key of ["deck", "contextLabel", "featureImageAlt", "readingTimeOverrideMinutes", "seoTitle", "seoDescription", "ogImageUrl"] as const) {
    assert.equal(values[key], "", `${key} must be "" not null for a controlled input`);
  }
});

// ─── Shared payload ──────────────────────────────────────────────────────────

const SHARED: SharedFormValues = { authorId: 3, featureImageUrl: "https://a.test/b.jpg" };

test("THE SHARED PAYLOAD CAN NEVER CARRY A TRANSLATION KEY", () => {
  const payload = toSharedUpdatePayload({ authorId: 4, featureImageUrl: "https://c.test/d.jpg" }, SHARED);
  assert.deepEqual(Object.keys(payload).sort(), ["authorId", "featureImageUrl"]);
  for (const forbidden of ["channel", "title", "body", "slug", "deck", "featureImageAlt", "seoTitle", "status", "topicIds"]) {
    assert.equal(forbidden in payload, false, `shared payload leaked ${forbidden}`);
  }
});

test("clearing the author sends null; an unchanged author is omitted", () => {
  assert.deepEqual(toSharedUpdatePayload({ ...SHARED, authorId: null }, SHARED), { authorId: null });
  assert.deepEqual(toSharedUpdatePayload(SHARED, SHARED), {});
  assert.equal(isSharedDirty(SHARED, SHARED), false);
  assert.equal(isSharedDirty({ ...SHARED, authorId: 9 }, SHARED), true);
});

// ─── Topics ──────────────────────────────────────────────────────────────────

test("topics are FULL REPLACE — the complete desired set is sent, sorted and deduped", () => {
  assert.deepEqual(toTopicsPayload([3, 1, 3, 2]), { topicIds: [1, 2, 3] });
  // The route replaces rather than merges: it calls replacePostTopics, whose
  // first statement DELETEs every existing row for the post.
  const handler = serverRoutes.slice(serverRoutes.indexOf('router.put(\n  "/admin/editorial/posts/:id/topics"'));
  assert.match(handler.slice(0, 3000), /replacePostTopics\(tx, post\.id, topicIds\)/);
  assert.match(
    serverService.slice(serverService.indexOf("export async function replacePostTopics")),
    /^[\s\S]{0,400}delete\(editorialPostTopicsTable\)/,
  );
});

test("topic dirtiness ignores order and duplicates", () => {
  assert.equal(areTopicsDirty([2, 1], [1, 2]), false);
  assert.equal(areTopicsDirty([1, 2, 3], [1, 2]), true);
  assert.equal(areTopicsDirty([], []), false);
});

// ─── Create ──────────────────────────────────────────────────────────────────

test("create is ONE request carrying the spine and the first draft translation", () => {
  const payload = toCreatePostPayload({
    ...EMPTY_CREATE_FORM, channel: "experience", languageCode: "en", title: " Opening night ",
  });
  assert.equal(payload.channel, "experience");
  assert.equal(payload.translation.title, "Opening night");
  assert.deepEqual(payload.translation.body, { blocks: [] });
  assert.match(serverRoutes, /router\.post\(\n\s+"\/admin\/editorial\/posts",/);
});

test("SLUG GENERATION STAYS SERVER-OWNED: a blank slug is submitted as null (D6)", () => {
  const payload = toCreatePostPayload({ ...EMPTY_CREATE_FORM, languageCode: "en", title: "Opening night" });
  assert.equal(payload.translation.slug, null, "the client's preview must never be submitted");
  // Which is exactly what hands the server deterministic collision suffixing.
  assert.match(serverService, /disambiguateEditorialSlug/);
});

test("a MANUALLY typed slug is submitted verbatim", () => {
  const payload = toCreatePostPayload({ ...EMPTY_CREATE_FORM, languageCode: "en", title: "X", slug: " my-slug " });
  assert.equal(payload.translation.slug, "my-slug");
});

test("optional author and feature image are omitted when not chosen", () => {
  const payload = toCreatePostPayload({ ...EMPTY_CREATE_FORM, languageCode: "en", title: "X" });
  assert.equal("authorId" in payload, false);
  assert.equal("featureImageUrl" in payload, false);
});

test("create validation requires a channel, a language and a title, and checks a manual slug", () => {
  const errors = validateCreateForm({ ...EMPTY_CREATE_FORM }, describeSlugProblem);
  assert.equal(errors.languageCode, "A language is required.");
  assert.equal(errors.title, "A title is required.");
  const bad = validateCreateForm(
    { ...EMPTY_CREATE_FORM, languageCode: "en", title: "X", slug: "Bad Slug" },
    describeSlugProblem,
  );
  assert.equal(bad.slug, "A slug must be lowercase.");
  assert.deepEqual(
    validateCreateForm({ ...EMPTY_CREATE_FORM, languageCode: "en", title: "X" }, describeSlugProblem),
    {},
  );
});

// ─── Publish readiness ───────────────────────────────────────────────────────

const READY = {
  languageIsActive: true,
  title: "Opening night",
  blocks: [{ type: "paragraph" }],
  featureImageUrl: "https://a.test/b.jpg",
  featureImageAlt: "A dancer",
  author: { publicName: "Nour", status: "active" as const, biography: "Bio" },
};

test("a fully ready translation passes every mirrored rule", () => {
  const items = publishReadiness(READY);
  assert.equal(isPublishReady(items), true);
  assert.deepEqual(blockingReadiness(items), []);
});

test("EVERY readiness message is one assertTranslationPublishReady actually raises", () => {
  const cases: Array<[Partial<typeof READY>, string]> = [
    [{ title: "" }, "A translation needs a title before it can be published."],
    [{ blocks: [] }, "A translation needs at least one body block before it can be published."],
    [{ featureImageUrl: null }, "A post needs a feature image before any translation can be published."],
    [{ featureImageAlt: "" }, "This translation needs alt text for the feature image, in its own language, before it can be published."],
    [{ author: null }, "A post needs an author before any translation can be published."],
  ];
  for (const [patch, message] of cases) {
    const blocking = blockingReadiness(publishReadiness({ ...READY, ...patch }));
    assert.ok(blocking.some((item) => item.message === message), `missing: ${message}`);
    assert.ok(serverService.includes(message), `the server never raises: ${message}`);
  }
});

test("an archived author and a biography-less author each block, with the server's wording", () => {
  const archived = blockingReadiness(
    publishReadiness({ ...READY, author: { publicName: "Nour", status: "archived", biography: "Bio" } }),
  );
  assert.ok(archived.some((item) => item.message === 'Author "Nour" is archived — pick an active author before publishing.'));
  assert.ok(serverService.includes('is archived — pick an active author before publishing.'));

  const noBio = blockingReadiness(
    publishReadiness({ ...READY, author: { publicName: "Nour", status: "active", biography: "  " } }),
  );
  assert.ok(noBio.some((item) => item.message.includes("has no biography — add one before publishing")));
  assert.ok(serverService.includes("has no biography — add one before publishing a post under this byline."));
});

test("a missing image alt names the 1-based block numbers, like the server does", () => {
  const blocking = blockingReadiness(
    publishReadiness({
      ...READY,
      blocks: [{ type: "paragraph" }, { type: "image", alt: "" }, { type: "image", alt: "" }],
    }),
  );
  assert.ok(blocking.some((item) => item.message === "Every image needs alt text before publishing (missing on block 2, 3)."));
  assert.ok(serverService.includes("Every image needs alt text before publishing (missing on block"));
});

test("an inactive language blocks PUBLISHING (and only publishing)", () => {
  const items = publishReadiness({ ...READY, languageIsActive: false });
  assert.equal(isPublishReady(items), false);
  assert.equal(blockingReadiness(items)[0]!.key, "language-active");
  // The server skips exactly this one rule on the EDIT path.
  assert.match(serverService, /options\.context \?\? "publish"\) === "publish"[\s\S]{0,120}assertLanguagePublishable/);
});

test("NO requirement is invented — deck, SEO and topics are not readiness rules", () => {
  const keys = publishReadiness(READY).map((item) => item.key);
  for (const invented of ["deck", "seo", "topics", "context-label", "read-time"]) {
    assert.equal(keys.includes(invented as never), false, `invented readiness rule: ${invented}`);
  }
  assert.equal(Object.keys(READINESS_LABELS).length, keys.length);
});

test("the media trust boundary is deliberately NOT mirrored client-side", () => {
  const source = readFileSync(new URL("./editorial-post-form.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /picsum\.photos|images\.unsplash\.com/);
  assert.match(source, /NOT mirrored/);
});
