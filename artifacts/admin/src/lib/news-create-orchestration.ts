/**
 * news-create-orchestration — the one-screen Add News flow, as a pure,
 * injectable state machine (Unified Website CMS, slice 3).
 *
 * Pure. No React. The page passes the generated API functions in; tests pass
 * fakes, so the exact request sequence is provable without a browser.
 *
 * ─── ZERO WRITES UNTIL THE OPERATOR CHOOSES ──────────────────────────────
 *
 * Opening Add News creates nothing — no draft shell, no placeholder row. The
 * whole article (spine + first translation with body, gallery, SEO …) is
 * held locally and sent only when the operator presses Save Draft or
 * Publish.
 *
 * ─── THE SEQUENCE (existing endpoints only) ──────────────────────────────
 *
 *   1. POST /admin/editorial/posts            spine + the FULL first
 *                                             translation, ONE request
 *   2. PUT  /posts/:id/topics                 only if topics were chosen
 *   3. PUT  /posts/:id/recommendations        only if News was chosen
 *   4. PUT  /posts/:id/performance-refs       only if Performances were chosen
 *   5. POST /posts/:id/translations/:lang/publish   Publish mode only, and
 *                                             only after 1–4 all succeeded
 *
 * ─── FAILURE AND RETRY ───────────────────────────────────────────────────
 *
 * Progress (the created post id + completed steps) is returned on every
 * outcome. A failure after step 1 keeps the draft — it is never hidden or
 * rolled back — and reports which step failed. Retrying with that progress
 * skips every completed step, so a retry can NEVER create a second post;
 * steps 2–4 are full-replace PUTs, so re-applying one is idempotent.
 */
import {
  EMPTY_TRANSLATION_FORM,
  readingTimeError,
  readingTimeOrNull,
  toTopicsPayload,
  type TranslationFormValues,
} from "./editorial-post-form.ts";
import { toBodyPayload, validateBody, type StoredBody } from "./editorial-post-body.ts";
import { toGalleryPayload, validateGallery, type StoredGallery } from "./editorial-post-gallery.ts";
import { toPerformanceRefsPayload } from "./editorial-performance-refs.ts";

// ─── Category ────────────────────────────────────────────────────────────────

/** Mirrors the generated EditorialNewsCategory enum (awards|auditions|events|press). */
export type NewsCategoryValue = "awards" | "auditions" | "events" | "press";

export const NEWS_CATEGORY_OPTIONS: ReadonlyArray<{ value: NewsCategoryValue; label: string }> = [
  { value: "awards", label: "Competition & Awards" },
  { value: "auditions", label: "Auditions & Masterclasses" },
  { value: "events", label: "Studio Events" },
  { value: "press", label: "Press & Media" },
];

export function newsCategoryLabel(value: string | null | undefined): string | null {
  return NEWS_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

// ─── Form ────────────────────────────────────────────────────────────────────

export interface NewsCreateForm extends TranslationFormValues {
  languageCode: string;
  newsCategory: NewsCategoryValue | "";
  authorId: number | null;
  featureImageUrl: string;
  topicIds: number[];
  /** Ordered target post ids (News recommendations). */
  recommendationIds: number[];
  /** Ordered Performance ids. */
  performanceIds: number[];
}

export const EMPTY_NEWS_CREATE_FORM: NewsCreateForm = {
  ...EMPTY_TRANSLATION_FORM,
  languageCode: "",
  newsCategory: "",
  authorId: null,
  featureImageUrl: "",
  topicIds: [],
  recommendationIds: [],
  performanceIds: [],
};

export type NewsCreateField =
  | "languageCode"
  | "title"
  | "slug"
  | "newsCategory"
  | "readingTimeOverrideMinutes"
  | "body"
  | "gallery";

export type NewsCreateErrors = Partial<Record<NewsCreateField, string>>;

/** Client-side gate. Any error here blocks the flow BEFORE any request. */
export function validateNewsCreateForm(
  form: NewsCreateForm,
  slugProblem: (slug: string) => string | null,
): NewsCreateErrors {
  const errors: NewsCreateErrors = {};
  if (form.languageCode.trim().length === 0) errors.languageCode = "A language is required.";
  const title = form.title.trim();
  if (title.length === 0) errors.title = "A title is required.";
  else if (title.length > 300) errors.title = "A title can be at most 300 characters.";
  const slug = form.slug.trim();
  if (slug.length > 0) {
    const problem = slugProblem(slug);
    if (problem) errors.slug = problem;
  }
  if (!NEWS_CATEGORY_OPTIONS.some((option) => option.value === form.newsCategory)) {
    errors.newsCategory = "Choose a category.";
  }
  const readTime = readingTimeError(form.readingTimeOverrideMinutes);
  if (readTime) errors.readingTimeOverrideMinutes = readTime;
  if (validateBody(form.blocks).length > 0) {
    errors.body = "Some blocks are not valid yet — fix the highlighted fields.";
  }
  if (validateGallery(form.galleryItems).length > 0) {
    errors.gallery = "Some gallery images are not valid yet — fix the highlighted fields.";
  }
  return errors;
}

// ─── Payload ─────────────────────────────────────────────────────────────────

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface NewsCreatePayload {
  channel: "news";
  authorId?: number | null;
  featureImageUrl?: string | null;
  newsCategory: NewsCategoryValue;
  translation: {
    languageCode: string;
    title: string;
    slug: string | null;
    deck: string | null;
    contextLabel: string | null;
    featureImageAlt: string | null;
    listingImageUrl: string | null;
    body: StoredBody;
    gallery: StoredGallery;
    readingTimeOverrideMinutes: number | null;
    seoTitle: string | null;
    seoDescription: string | null;
    ogImageUrl: string | null;
  };
}

/**
 * The FULL create body. `slug: null` when blank hands generation and
 * collision suffixing to the server (D6), exactly as before.
 */
export function toNewsCreatePayload(form: NewsCreateForm): NewsCreatePayload {
  if (form.newsCategory === "") throw new Error("toNewsCreatePayload called without a category");
  const payload: NewsCreatePayload = {
    channel: "news",
    newsCategory: form.newsCategory,
    translation: {
      languageCode: form.languageCode,
      title: form.title.trim(),
      slug: textOrNull(form.slug),
      deck: textOrNull(form.deck),
      contextLabel: textOrNull(form.contextLabel),
      featureImageAlt: textOrNull(form.featureImageAlt),
      listingImageUrl: textOrNull(form.listingImageUrl),
      body: toBodyPayload(form.blocks),
      gallery: toGalleryPayload(form.galleryItems),
      readingTimeOverrideMinutes: readingTimeOrNull(form.readingTimeOverrideMinutes),
      seoTitle: textOrNull(form.seoTitle),
      seoDescription: textOrNull(form.seoDescription),
      ogImageUrl: textOrNull(form.ogImageUrl),
    },
  };
  if (form.authorId != null) payload.authorId = form.authorId;
  const featureImageUrl = textOrNull(form.featureImageUrl);
  if (featureImageUrl != null) payload.featureImageUrl = featureImageUrl;
  return payload;
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export type NewsCreateMode = "draft" | "publish";
export type NewsCreateStep = "create" | "topics" | "recommendations" | "performanceRefs" | "publish";

export const NEWS_CREATE_STEP_LABELS: Record<NewsCreateStep, string> = {
  create: "Saving the article",
  topics: "Topics",
  recommendations: "Recommended reading",
  performanceRefs: "Related Performance",
  publish: "Publishing",
};

export interface NewsCreateApi {
  createPost(body: NewsCreatePayload): Promise<{ post: { id: number }; translation?: { languageCode: string } | null }>;
  replaceTopics(postId: number, body: { topicIds: number[] }): Promise<unknown>;
  replaceRecommendations(postId: number, body: { items: Array<{ targetPostId: number }> }): Promise<unknown>;
  replacePerformanceRefs(postId: number, body: { items: Array<{ performanceId: number }> }): Promise<unknown>;
  publish(postId: number, languageCode: string): Promise<unknown>;
}

export interface NewsCreateProgress {
  postId: number | null;
  languageCode: string | null;
  done: NewsCreateStep[];
}

export const INITIAL_NEWS_CREATE_PROGRESS: NewsCreateProgress = { postId: null, languageCode: null, done: [] };

export type NewsCreateResult =
  | { status: "saved" | "published"; progress: NewsCreateProgress }
  | { status: "failed"; progress: NewsCreateProgress; failedStep: NewsCreateStep; error: unknown };

/** The steps this form needs, in order. Follow-ups only for real selections. */
export function plannedNewsCreateSteps(form: NewsCreateForm, mode: NewsCreateMode): NewsCreateStep[] {
  const steps: NewsCreateStep[] = ["create"];
  if (form.topicIds.length > 0) steps.push("topics");
  if (form.recommendationIds.length > 0) steps.push("recommendations");
  if (form.performanceIds.length > 0) steps.push("performanceRefs");
  if (mode === "publish") steps.push("publish");
  return steps;
}

export async function runNewsCreate(input: {
  form: NewsCreateForm;
  mode: NewsCreateMode;
  api: NewsCreateApi;
  /** Pass the previous result's progress to retry; omit for a first attempt. */
  progress?: NewsCreateProgress;
}): Promise<NewsCreateResult> {
  const { form, mode, api } = input;
  const progress: NewsCreateProgress = {
    ...(input.progress ?? INITIAL_NEWS_CREATE_PROGRESS),
    done: [...(input.progress?.done ?? [])],
  };

  for (const step of plannedNewsCreateSteps(form, mode)) {
    if (progress.done.includes(step)) continue;
    // Hard guard: once a post exists, "create" is complete — never re-run.
    if (step === "create" && progress.postId != null) {
      progress.done.push("create");
      continue;
    }
    try {
      if (step === "create") {
        const result = await api.createPost(toNewsCreatePayload(form));
        progress.postId = result.post.id;
        progress.languageCode = result.translation?.languageCode ?? form.languageCode;
      } else {
        const postId = progress.postId!;
        if (step === "topics") await api.replaceTopics(postId, toTopicsPayload(form.topicIds));
        if (step === "recommendations") {
          await api.replaceRecommendations(postId, {
            items: form.recommendationIds.map((targetPostId) => ({ targetPostId })),
          });
        }
        if (step === "performanceRefs") await api.replacePerformanceRefs(postId, toPerformanceRefsPayload(form.performanceIds));
        if (step === "publish") await api.publish(postId, progress.languageCode ?? form.languageCode);
      }
      progress.done.push(step);
    } catch (error) {
      return { status: "failed", progress, failedStep: step, error };
    }
  }

  return { status: mode === "publish" ? "published" : "saved", progress };
}
