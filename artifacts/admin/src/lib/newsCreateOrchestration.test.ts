/**
 * Unified Website CMS slice 3 — the one-screen Add News orchestration.
 *
 * Real behaviour tests: `runNewsCreate` takes injected API functions, so the
 * exact request sequence (and what happens on failure and retry) is asserted
 * against recording fakes — no browser, no network.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { describeSlugProblem } from "./editorial-posts.ts";
import { createBlock } from "./editorial-post-body.ts";
import {
  EMPTY_NEWS_CREATE_FORM,
  NEWS_CATEGORY_OPTIONS,
  plannedNewsCreateSteps,
  runNewsCreate,
  toNewsCreatePayload,
  validateNewsCreateForm,
  type NewsCreateApi,
  type NewsCreateForm,
} from "./news-create-orchestration.ts";

function paragraph(text: string) {
  const block = createBlock("paragraph");
  return { ...block, text } as typeof block;
}

const FULL: NewsCreateForm = {
  ...EMPTY_NEWS_CREATE_FORM,
  languageCode: "en",
  newsCategory: "awards",
  authorId: 7,
  featureImageUrl: " https://images.unsplash.com/photo-1 ",
  title: "  Gold at YAGP  ",
  slug: "",
  deck: "Our students won.",
  contextLabel: "Competition diary",
  featureImageAlt: "Dancers on stage",
  listingImageUrl: "https://images.unsplash.com/photo-2",
  readingTimeOverrideMinutes: "4",
  seoTitle: "Gold at YAGP 2027",
  seoDescription: "",
  ogImageUrl: "https://images.unsplash.com/photo-3",
  blocks: [paragraph("First paragraph.")],
  galleryItems: [{ key: "g1", url: "https://images.unsplash.com/photo-4", alt: "Bow" }],
  topicIds: [5, 3, 5],
  recommendationIds: [42, 41],
  performanceIds: [9, 8],
};

type Call = [string, ...unknown[]];

function fakeApi(options: { failOn?: Partial<Record<string, number>>; postId?: number } = {}) {
  const calls: Call[] = [];
  const failures = { ...(options.failOn ?? {}) } as Record<string, number>;
  const maybeFail = (name: string) => {
    if ((failures[name] ?? 0) > 0) {
      failures[name] -= 1;
      throw new Error(`${name} refused`);
    }
  };
  const api: NewsCreateApi = {
    async createPost(body) {
      calls.push(["createPost", body]);
      maybeFail("createPost");
      return { post: { id: options.postId ?? 501 }, translation: { languageCode: body.translation.languageCode } };
    },
    async replaceTopics(id, body) {
      calls.push(["replaceTopics", id, body]);
      maybeFail("replaceTopics");
    },
    async replaceRecommendations(id, body) {
      calls.push(["replaceRecommendations", id, body]);
      maybeFail("replaceRecommendations");
    },
    async replacePerformanceRefs(id, body) {
      calls.push(["replacePerformanceRefs", id, body]);
      maybeFail("replacePerformanceRefs");
    },
    async publish(id, languageCode) {
      calls.push(["publish", id, languageCode]);
      maybeFail("publish");
    },
  };
  return { api, calls, names: () => calls.map((call) => call[0]) };
}

// ─── Category + validation ───────────────────────────────────────────────────

test("the category options are exactly the generated enum, with friendly labels", () => {
  assert.deepEqual(
    NEWS_CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
    [
      ["awards", "Competition & Awards"],
      ["auditions", "Auditions & Masterclasses"],
      ["events", "Studio Events"],
      ["press", "Press & Media"],
    ],
  );
});

test("category is required", () => {
  const errors = validateNewsCreateForm({ ...FULL, newsCategory: "" }, describeSlugProblem);
  assert.equal(errors.newsCategory, "Choose a category.");
  assert.deepEqual(Object.keys(validateNewsCreateForm(FULL, describeSlugProblem)), []);
});

test("title, language, slug shape, reading time and invalid blocks are validated client-side", () => {
  const errors = validateNewsCreateForm(
    {
      ...FULL,
      languageCode: "",
      title: "   ",
      slug: "Not A Slug!",
      readingTimeOverrideMinutes: "0",
      blocks: [paragraph("")],
      galleryItems: [{ key: "g", url: "", alt: "" }],
    },
    describeSlugProblem,
  );
  assert.deepEqual(Object.keys(errors).sort(), ["body", "gallery", "languageCode", "readingTimeOverrideMinutes", "slug", "title"]);
});

test("a client validation error blocks the flow BEFORE any request", async () => {
  // The page calls validate first and returns early; mirrored here as the
  // contract: an invalid form never reaches runNewsCreate. And runNewsCreate
  // itself refuses to build a payload with no category.
  const { api, calls } = fakeApi();
  assert.ok(Object.keys(validateNewsCreateForm({ ...FULL, newsCategory: "" }, describeSlugProblem)).length > 0);
  const result = await runNewsCreate({ form: { ...FULL, newsCategory: "" }, mode: "draft", api });
  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" && result.failedStep, "create");
  assert.deepEqual(calls, [], "no request was sent");
});

// ─── Payload ─────────────────────────────────────────────────────────────────

test("ONE create carries the spine and the FULL first translation", () => {
  const payload = toNewsCreatePayload(FULL);
  assert.deepEqual(payload, {
    channel: "news",
    newsCategory: "awards",
    authorId: 7,
    featureImageUrl: "https://images.unsplash.com/photo-1",
    translation: {
      languageCode: "en",
      title: "Gold at YAGP",
      slug: null,
      deck: "Our students won.",
      contextLabel: "Competition diary",
      featureImageAlt: "Dancers on stage",
      listingImageUrl: "https://images.unsplash.com/photo-2",
      body: { blocks: [{ type: "paragraph", text: "First paragraph." }] },
      gallery: { items: [{ url: "https://images.unsplash.com/photo-4", alt: "Bow" }] },
      readingTimeOverrideMinutes: 4,
      seoTitle: "Gold at YAGP 2027",
      seoDescription: null,
      ogImageUrl: "https://images.unsplash.com/photo-3",
    },
  });
  assert.equal("status" in payload.translation, false);
});

test("optional spine fields are omitted when blank", () => {
  const payload = toNewsCreatePayload({ ...FULL, authorId: null, featureImageUrl: "  " });
  assert.equal("authorId" in payload, false);
  assert.equal("featureImageUrl" in payload, false);
});

// ─── Orchestration ───────────────────────────────────────────────────────────

test("Save Draft: one create, then follow-ups with the NEW id, in order, then done", async () => {
  const { api, calls, names } = fakeApi({ postId: 77 });
  const result = await runNewsCreate({ form: FULL, mode: "draft", api });
  assert.equal(result.status, "saved");
  assert.deepEqual(names(), ["createPost", "replaceTopics", "replaceRecommendations", "replacePerformanceRefs"]);
  assert.deepEqual(calls[1], ["replaceTopics", 77, { topicIds: [3, 5] }]);
  assert.deepEqual(calls[2], ["replaceRecommendations", 77, { items: [{ targetPostId: 42 }, { targetPostId: 41 }] }]);
  assert.deepEqual(calls[3], ["replacePerformanceRefs", 77, { items: [{ performanceId: 9 }, { performanceId: 8 }] }]);
  assert.deepEqual(result.progress, {
    postId: 77,
    languageCode: "en",
    done: ["create", "topics", "recommendations", "performanceRefs"],
  });
});

test("follow-ups run only for what the operator actually chose", async () => {
  const { api, names } = fakeApi();
  const form = { ...FULL, topicIds: [], recommendationIds: [], performanceIds: [] };
  assert.deepEqual(plannedNewsCreateSteps(form, "draft"), ["create"]);
  const result = await runNewsCreate({ form, mode: "draft", api });
  assert.equal(result.status, "saved");
  assert.deepEqual(names(), ["createPost"]);
});

test("a follow-up failure KEEPS the draft, names the failed step, and stops", async () => {
  const { api, names } = fakeApi({ failOn: { replaceRecommendations: 1 } });
  const result = await runNewsCreate({ form: FULL, mode: "draft", api });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.failedStep, "recommendations");
  assert.equal(result.progress.postId, 501, "the created draft is reported, not hidden");
  assert.deepEqual(result.progress.done, ["create", "topics"]);
  assert.deepEqual(names(), ["createPost", "replaceTopics", "replaceRecommendations"]);
});

test("retry re-applies ONLY the missing steps and never calls create again", async () => {
  const fake = fakeApi({ failOn: { replaceRecommendations: 1 } });
  const first = await runNewsCreate({ form: FULL, mode: "draft", api: fake.api });
  assert.equal(first.status, "failed");
  const retry = await runNewsCreate({ form: FULL, mode: "draft", api: fake.api, progress: first.progress });
  assert.equal(retry.status, "saved");
  assert.deepEqual(fake.names(), [
    "createPost", "replaceTopics", "replaceRecommendations",
    // retry:
    "replaceRecommendations", "replacePerformanceRefs",
  ]);
  assert.equal(fake.names().filter((name) => name === "createPost").length, 1);
});

test("even a progress with only a post id can never create a second post", async () => {
  const { api, names } = fakeApi();
  const result = await runNewsCreate({
    form: FULL,
    mode: "draft",
    api,
    progress: { postId: 900, languageCode: "en", done: [] },
  });
  assert.equal(result.status, "saved");
  assert.equal(names().includes("createPost"), false);
  assert.deepEqual(result.progress.done[0], "create");
});

test("a failed create leaves nothing behind and can simply be retried", async () => {
  const fake = fakeApi({ failOn: { createPost: 1 } });
  const first = await runNewsCreate({ form: FULL, mode: "draft", api: fake.api });
  assert.equal(first.status, "failed");
  assert.equal(first.status === "failed" && first.failedStep, "create");
  assert.equal(first.progress.postId, null);
  assert.deepEqual(fake.names(), ["createPost"]);
});

test("Publish: publish is called LAST, only after create + every follow-up succeeded", async () => {
  const { api, calls, names } = fakeApi({ postId: 12 });
  const result = await runNewsCreate({ form: FULL, mode: "publish", api });
  assert.equal(result.status, "published");
  assert.deepEqual(names(), ["createPost", "replaceTopics", "replaceRecommendations", "replacePerformanceRefs", "publish"]);
  assert.deepEqual(calls.at(-1), ["publish", 12, "en"]);
});

test("Publish is NOT attempted when a follow-up fails", async () => {
  const { api, names } = fakeApi({ failOn: { replacePerformanceRefs: 1 } });
  const result = await runNewsCreate({ form: FULL, mode: "publish", api });
  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" && result.failedStep, "performanceRefs");
  assert.equal(names().includes("publish"), false);
});

test("a publish failure is surfaced without losing the saved draft", async () => {
  const { api } = fakeApi({ failOn: { publish: 1 }, postId: 31 });
  const result = await runNewsCreate({ form: FULL, mode: "publish", api });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.failedStep, "publish");
  assert.match(String((result.error as Error).message), /publish refused/);
  assert.equal(result.progress.postId, 31);
  assert.deepEqual(result.progress.done, ["create", "topics", "recommendations", "performanceRefs"]);
});
