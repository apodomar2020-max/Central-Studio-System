/**
 * Website → News → Add News (/editorial/posts/new) — Unified Website CMS
 * slice 3 (was the Wave 2.1D two-field "New post" form).
 *
 * ─── ONE SCREEN, ZERO WRITES UNTIL THE OPERATOR CHOOSES ──────────────────
 *
 * The complete authoring surface of the existing editor is offered here
 * BEFORE the post exists: language, title, address, category, author,
 * feature image, deck, context label, alt text, listing image, body,
 * gallery, Topics, recommended News, related Performance, SEO and reading
 * time. Opening the page performs no request that writes anything — there
 * is no draft shell. Everything is local state until Save Draft or Publish.
 *
 * The request sequence lives in `lib/news-create-orchestration.ts` (pure,
 * tested): ONE create carrying the spine + the full first translation, then
 * only the follow-ups the operator actually chose, then (Publish only) the
 * existing publish transition. A follow-up failure keeps the created draft,
 * names the failed step and offers a retry that re-applies only what failed —
 * a retry can never create a second post.
 *
 * Slug (D6): optional. Left blank, the payload sends `slug: null` and the
 * SERVER generates it. The preview below the field is display only.
 */
import { useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateEditorialPost,
  useReplaceEditorialPostTopics,
  useReplaceEditorialPostRecommendations,
  useReplaceEditorialPostPerformanceRefs,
  usePublishEditorialPostTranslation,
  getListEditorialPostsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { CmsEditorLayout } from "@/components/admin/cms-editor-layout";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useEditorialReferenceData } from "@/hooks/use-editorial-reference-data";
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import { PostBodyEditor } from "@/components/editorial/post-body-editor";
import { PostGalleryEditor } from "@/components/editorial/post-gallery-editor";
import { TopicsCard } from "@/components/editorial/topics-card";
import { RecommendationsCard } from "@/components/editorial/recommendations-card";
import { PerformanceRefsCard } from "@/components/editorial/performance-refs-card";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import { bylineState, bylineStatusLabel } from "@/lib/editorial-authors";
import { validateBody, type EditableBlock } from "@/lib/editorial-post-body";
import { validateGallery, type EditableGalleryItem } from "@/lib/editorial-post-gallery";
import {
  SHARED_ACROSS_LANGUAGES_LABEL,
  SLUG_AUTO_HINT,
  TRANSLATION_SPECIFIC_LABEL,
  describeSlugProblem,
  postCapabilities,
  publishConfirmation,
  slugPreview,
} from "@/lib/editorial-posts";
import {
  READINESS_ADVISORY_NOTE,
  READINESS_LABELS,
  isPublishReady,
  publishReadiness,
  readingTimeError,
} from "@/lib/editorial-post-form";
import {
  EMPTY_NEWS_CREATE_FORM,
  NEWS_CATEGORY_OPTIONS,
  NEWS_CREATE_STEP_LABELS,
  runNewsCreate,
  validateNewsCreateForm,
  type NewsCreateApi,
  type NewsCreateErrors,
  type NewsCreateForm,
  type NewsCreateMode,
  type NewsCreateProgress,
  type NewsCreateStep,
} from "@/lib/news-create-orchestration";
import { ArrowLeft, Check, ChevronDown, X } from "lucide-react";
import "../admin2-final.css";

interface FollowUpFailure {
  mode: NewsCreateMode;
  progress: NewsCreateProgress;
  step: NewsCreateStep;
  message: string;
}

export default function EditorialPostCreatePage() {
  const { can } = useAdminAuth();
  const capabilities = postCapabilities(can);
  const { toast } = useToast();
  const confirmAction = useAdminConfirm();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const reference = useEditorialReferenceData();
  // Mutation hooks only: nothing is invoked until submit() runs.
  const createPost = useCreateEditorialPost();
  const replaceTopics = useReplaceEditorialPostTopics();
  const replaceRecommendations = useReplaceEditorialPostRecommendations();
  const replacePerformanceRefs = useReplaceEditorialPostPerformanceRefs();
  const publish = usePublishEditorialPostTranslation();

  const [rawForm, setForm] = useState<NewsCreateForm>(EMPTY_NEWS_CREATE_FORM);
  const [errors, setErrors] = useState<NewsCreateErrors>({});
  /** True once the operator types in the slug field — the preview stops then. */
  const [slugTouched, setSlugTouched] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Synchronous re-entry guard: a double click can never start two flows. */
  const inFlight = useRef(false);
  /** Set once a post exists but a follow-up failed. The form is then locked. */
  const [failure, setFailure] = useState<FollowUpFailure | null>(null);

  /** Only ACTIVE languages: a new translation in a retired language is refused. */
  const languages = useMemo(
    () => (reference.languages.data ?? []).filter((language) => language.isActive),
    [reference.languages.data],
  );
  const defaultLanguageCode = (languages.find((language) => language.isDefault) ?? languages[0])?.code ?? "";
  // The default language is pre-selected without any write or effect.
  const form: NewsCreateForm = rawForm.languageCode ? rawForm : { ...rawForm, languageCode: defaultLanguageCode };
  const languageName = languages.find((language) => language.code === form.languageCode)?.name ?? form.languageCode;

  /** Authors are channel-scoped, and only an ACTIVE author can be assigned. */
  const authors = useMemo(
    () =>
      (reference.authors.data ?? []).filter(
        (author) => author.channel === "news" && author.status === "active",
      ),
    [reference.authors.data],
  );
  const chosenAuthor = authors.find((author) => author.id === form.authorId) ?? null;

  const preview = slugTouched ? form.slug.trim() : slugPreview(form.title);
  const blockProblems = useMemo(() => validateBody(form.blocks), [form.blocks]);
  const galleryProblems = useMemo(() => validateGallery(form.galleryItems), [form.galleryItems]);

  const readiness = publishReadiness({
    languageIsActive: true,
    title: form.title,
    blocks: form.blocks.map((block) => ({ type: block.type, alt: (block as { alt?: string }).alt })),
    galleryItems: form.galleryItems.map((item) => ({ alt: item.alt })),
    featureImageUrl: form.featureImageUrl,
    featureImageAlt: form.featureImageAlt,
    author: chosenAuthor
      ? { publicName: chosenAuthor.publicName, status: chosenAuthor.status, biography: chosenAuthor.biography }
      : null,
  });
  const ready = isPublishReady(readiness);

  const locked = pending || failure != null;
  const patch = (next: Partial<NewsCreateForm>) => setForm((current) => ({ ...current, ...next }));

  const api: NewsCreateApi = {
    createPost: (data) => createPost.mutateAsync({ data }),
    replaceTopics: (id, data) => replaceTopics.mutateAsync({ id, data }),
    replaceRecommendations: (id, data) => replaceRecommendations.mutateAsync({ id, data }),
    replacePerformanceRefs: (id, data) => replacePerformanceRefs.mutateAsync({ id, data }),
    publish: (id, languageCode) => publish.mutateAsync({ id, languageCode }),
  };

  /** Runs (or retries) the flow. The ONLY place any write is issued. */
  const submit = async (mode: NewsCreateMode, retry?: FollowUpFailure) => {
    if (inFlight.current) return;
    setServerError(null);
    if (!retry) {
      const nextErrors = validateNewsCreateForm(form, describeSlugProblem);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        setServerError("Fix the highlighted fields — nothing has been saved.");
        return;
      }
      if (mode === "publish" && !(await confirmAction(publishConfirmation({ title: form.title.trim(), languageName })))) {
        return;
      }
    }

    inFlight.current = true;
    setPending(true);
    try {
      const result = await runNewsCreate({ form, mode, api, progress: retry?.progress });
      if (result.progress.postId != null) {
        queryClient.invalidateQueries({ queryKey: getListEditorialPostsQueryKey() });
      }
      const editHref = (progress: NewsCreateProgress) =>
        `/editorial/posts/${progress.postId}/${progress.languageCode ?? form.languageCode}`;

      if (result.status === "failed") {
        const message = editorialErrorMessage(result.error);
        if (result.failedStep === "create") {
          // Nothing exists yet: the form stays editable and nothing is lost.
          setServerError(message);
        } else if (result.failedStep === "publish") {
          // The draft (and every follow-up) is saved; only publish failed.
          toast({ title: "Draft saved, but not published", description: message, variant: "destructive" });
          navigate(editHref(result.progress));
        } else {
          setFailure({ mode, progress: result.progress, step: result.failedStep, message });
        }
        return;
      }

      setFailure(null);
      toast({
        title: result.status === "published" ? "News published" : "Draft saved",
        description:
          result.status === "published"
            ? `The ${languageName} version is now Published.`
            : "Nothing is published until you choose Publish.",
      });
      navigate(editHref(result.progress));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  if (!capabilities.canCreate) {
    return (
      <EditorialPageShell heading="Add News" description="Write a News article.">
        <div
          className="rounded-md border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
          data-testid="post-create-forbidden"
        >
          You do not have permission to add News. Adding News needs the Create permission on
          Website Editorial Posts.
        </div>
      </EditorialPageShell>
    );
  }

  const fieldError = (message?: string) =>
    message ? <p className="text-xs text-destructive">{message}</p> : null;

  return (
    <EditorialPageShell
      heading="Add News"
      description="Write the article, then save it as a draft or publish it. Nothing is saved until you choose."
      actions={
        <Button asChild variant="outline" size="compact" className="gap-1.5 shrink-0">
          <Link href="/editorial/posts" data-testid="link-back-to-posts">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to News
          </Link>
        </Button>
      }
    >
      {failure && failure.progress.postId != null && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          data-testid="news-create-followup-error"
        >
          <p className="text-destructive">
            Your draft was saved (article #{failure.progress.postId}), but{" "}
            <strong>{NEWS_CREATE_STEP_LABELS[failure.step]}</strong> could not be saved: {failure.message}
          </p>
          <p className="text-xs text-muted-foreground">
            {failure.mode === "publish" ? "The article has not been published. " : ""}
            Retry applies only what is still missing — it never creates a second article.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="compact"
              disabled={pending}
              data-testid="button-retry-news-create"
              onClick={() => submit(failure.mode, failure)}
            >
              {pending ? "Retrying…" : "Retry"}
            </Button>
            <Button asChild type="button" size="compact" variant="outline">
              <Link
                href={`/editorial/posts/${failure.progress.postId}/${failure.progress.languageCode ?? form.languageCode}`}
                data-testid="link-open-created-draft"
              >
                Open the saved draft
              </Link>
            </Button>
          </div>
        </div>
      )}

      <CmsEditorLayout
        sidebarLabel="Article settings"
        sidebar={
          <>
            {/* ─── Save / Publish, pinned first ─────────────────────────── */}
            <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="publish-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Publishing</h3>
                <Badge variant="outline" data-testid="publish-status-badge">
                  {failure ? "Draft saved" : "Not saved yet"}
                </Badge>
              </div>

              <div className="space-y-1" data-testid="readiness-checklist">
                <p className="text-xs font-medium text-muted-foreground">Before publishing</p>
                <ul className="space-y-0.5">
                  {readiness
                    .filter((item) => item.key !== "language-active")
                    .map((item) => (
                      <li key={item.key} className="flex items-start gap-1.5 text-[11px]" data-testid={`readiness-${item.key}`}>
                        {item.ok ? (
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
                        )}
                        <span className={item.ok ? "text-muted-foreground" : "text-foreground"}>
                          {READINESS_LABELS[item.key]}
                        </span>
                      </li>
                    ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">{READINESS_ADVISORY_NOTE}</p>
              </div>

              {serverError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                  data-testid="post-create-server-error"
                >
                  {serverError}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  disabled={locked}
                  data-testid="button-create-post"
                  onClick={() => submit("draft")}
                >
                  {pending ? "Saving…" : "Save Draft"}
                </Button>
                {capabilities.canPublish && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked || !ready}
                    data-testid="button-publish-news"
                    onClick={() => submit("publish")}
                  >
                    Publish
                  </Button>
                )}
                {capabilities.canPublish && !ready && (
                  <p className="text-[11px] text-muted-foreground" data-testid="publish-blocked">
                    Complete the checklist above to publish. You can save a draft at any time.
                  </p>
                )}
              </div>
            </section>

            {/* ─── Language + category ─────────────────────────────────── */}
            <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="language-category-card">
              <div className="grid gap-1.5">
                <Label htmlFor="create-post-language">Language</Label>
                <Select
                  value={form.languageCode}
                  disabled={locked}
                  onValueChange={(value) => patch({ languageCode: value })}
                >
                  <SelectTrigger id="create-post-language" data-testid="select-post-language">
                    <SelectValue placeholder="Choose a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map((language) => (
                      <SelectItem key={language.code} value={language.code}>
                        {language.name} ({language.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={errors.languageCode ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>
                  {errors.languageCode ?? "Other languages can be added after saving."}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="create-post-category">Category</Label>
                <Select
                  value={form.newsCategory}
                  disabled={locked}
                  onValueChange={(value) => patch({ newsCategory: value as NewsCreateForm["newsCategory"] })}
                >
                  <SelectTrigger
                    id="create-post-category"
                    data-testid="select-news-category"
                    aria-invalid={Boolean(errors.newsCategory) || undefined}
                  >
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {NEWS_CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={errors.newsCategory ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>
                  {errors.newsCategory ?? "Required. Decides where the article is filed on the website."}
                </p>
              </div>
            </section>

            {/* ─── Author + feature image ──────────────────────────────── */}
            <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="shared-card">
              <h3 className="text-sm font-semibold text-foreground">Author &amp; feature image</h3>
              <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>
              <div className="grid gap-1.5">
                <Label htmlFor="create-post-author">Author</Label>
                <Select
                  value={form.authorId == null ? "none" : String(form.authorId)}
                  disabled={locked}
                  onValueChange={(value) => patch({ authorId: value === "none" ? null : Number(value) })}
                >
                  <SelectTrigger id="create-post-author" data-testid="select-post-author">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No author yet</SelectItem>
                    {authors.map((author) => (
                      <SelectItem key={author.id} value={String(author.id)}>
                        {author.publicName} — {bylineStatusLabel(author)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {authors.length === 0 ? (
                    <>
                      No active News authors exist yet. Add one in{" "}
                      <Link href="/editorial/authors" className="underline">Authors</Link>.
                    </>
                  ) : (
                    "An author must have a biography before an article under their byline can be published."
                  )}
                </p>
                {chosenAuthor && bylineState(chosenAuthor) !== "ready" && (
                  <p className="text-[11px] text-muted-foreground" data-testid="post-author-byline-warning">
                    {bylineStatusLabel(chosenAuthor)} — this does not block saving, only publishing.
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="feature-image-url">Feature image link</Label>
                <Input
                  id="feature-image-url"
                  value={form.featureImageUrl}
                  disabled={locked}
                  autoComplete="off"
                  placeholder="https://images.unsplash.com/…"
                  data-testid="input-feature-image-url"
                  onChange={(e) => patch({ featureImageUrl: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Must be an https link on an approved image host: picsum.photos, images.unsplash.com,
                  res.cloudinary.com, static.wixstatic.com, lh3.googleusercontent.com. The link is checked
                  when you save.
                </p>
                {form.featureImageUrl.trim().length > 0 && (
                  <img
                    src={form.featureImageUrl.trim()}
                    alt=""
                    className="max-h-28 w-auto max-w-full rounded-md border border-border object-cover"
                    data-testid="feature-image-preview"
                  />
                )}
              </div>
            </section>

            <TopicsCard
              channel="news"
              topics={reference.topics.data ?? []}
              selected={form.topicIds}
              disabled={locked}
              onChange={(topicIds) => patch({ topicIds })}
            />

            <RecommendationsCard
              postId={null}
              channel="news"
              openLanguageCode={form.languageCode}
              saved={[]}
              selected={form.recommendationIds}
              languages={reference.languages.data ?? []}
              disabled={locked}
              onChange={(recommendationIds) => patch({ recommendationIds })}
            />

            <PerformanceRefsCard
              selected={form.performanceIds}
              disabled={locked}
              onChange={(performanceIds) => patch({ performanceIds })}
            />
          </>
        }
      >
        {/* ─── Writing canvas ─────────────────────────────────────────── */}
        <section className="rounded-md border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{languageName || "Article"}</h3>
            <Badge variant="outline" className="text-[10px]">{TRANSLATION_SPECIFIC_LABEL}</Badge>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="create-post-title">Title</Label>
            <Input
              id="create-post-title"
              value={form.title}
              disabled={locked}
              dir="auto"
              className="text-base"
              placeholder="Opening night at the studio"
              autoComplete="off"
              aria-invalid={Boolean(errors.title) || undefined}
              data-testid="input-post-title"
              onChange={(e) => patch({ title: e.target.value })}
            />
            {fieldError(errors.title)}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="create-post-slug">Address (optional)</Label>
            <Input
              id="create-post-slug"
              value={form.slug}
              disabled={locked}
              placeholder={slugPreview(form.title) || "opening-night"}
              autoComplete="off"
              dir="auto"
              className="font-mono"
              aria-invalid={Boolean(errors.slug) || undefined}
              data-testid="input-post-slug"
              onChange={(e) => {
                setSlugTouched(true);
                patch({ slug: e.target.value });
              }}
            />
            <p className={errors.slug ? "text-xs text-destructive" : "text-xs text-muted-foreground"} data-testid="post-slug-message">
              {errors.slug ?? SLUG_AUTO_HINT}
            </p>
            {preview.length > 0 && (
              <p className="text-xs text-muted-foreground break-all" data-testid="post-slug-preview">
                Address preview: <span className="font-mono" dir="auto">/{preview}</span>
                {!slugTouched && " — the server confirms the final address when you save."}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="translation-deck">Deck</Label>
            <Textarea
              id="translation-deck"
              rows={2}
              dir="auto"
              value={form.deck}
              disabled={locked}
              placeholder="A sentence or two under the headline."
              data-testid="input-translation-deck"
              onChange={(e) => patch({ deck: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="translation-context-label">Context label</Label>
            <Input
              id="translation-context-label"
              value={form.contextLabel}
              disabled={locked}
              dir="auto"
              placeholder="Festival diary"
              data-testid="input-translation-context-label"
              onChange={(e) => patch({ contextLabel: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">An optional kicker shown above the headline, in this language.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="translation-feature-alt">Feature image alt text</Label>
            <Input
              id="translation-feature-alt"
              value={form.featureImageAlt}
              disabled={locked}
              dir="auto"
              placeholder="What the feature image shows, in this language"
              data-testid="input-translation-feature-alt"
              onChange={(e) => patch({ featureImageAlt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Required before this language can be published.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="translation-listing-image">Listing image link</Label>
            <Input
              id="translation-listing-image"
              value={form.listingImageUrl}
              disabled={locked}
              autoComplete="off"
              placeholder="https://images.unsplash.com/…"
              data-testid="input-translation-listing-image"
              onChange={(e) => patch({ listingImageUrl: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              A separate image shown where this article appears in a list. It does not fall back to the
              feature image.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="translation-read-time">Reading time override (minutes)</Label>
            <Input
              id="translation-read-time"
              value={form.readingTimeOverrideMinutes}
              disabled={locked}
              inputMode="numeric"
              className="max-w-[10rem]"
              data-testid="input-translation-read-time"
              onChange={(e) => patch({ readingTimeOverrideMinutes: e.target.value })}
            />
            <p
              className={readingTimeError(form.readingTimeOverrideMinutes) ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              data-testid="read-time-message"
            >
              {readingTimeError(form.readingTimeOverrideMinutes) ?? "Leave blank to use the estimate derived from the body."}
            </p>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-3 space-y-2">
          <PostBodyEditor
            blocks={form.blocks}
            problems={blockProblems}
            disabled={locked}
            onChange={(next: EditableBlock[]) => patch({ blocks: next })}
          />
          {fieldError(errors.body)}
        </section>

        <section className="rounded-md border border-border bg-card p-3 space-y-2">
          <PostGalleryEditor
            items={form.galleryItems}
            problems={galleryProblems}
            disabled={locked}
            onChange={(next: EditableGalleryItem[]) => patch({ galleryItems: next })}
          />
          {fieldError(errors.gallery)}
        </section>

        <Collapsible open={seoOpen} onOpenChange={setSeoOpen} className="rounded-md border border-border bg-card">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              data-testid="button-toggle-seo"
            >
              <span className="text-sm font-semibold text-foreground">Search &amp; sharing</span>
              <ChevronDown
                className={seoOpen ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 px-3 pb-3">
            <p className="text-xs text-muted-foreground">
              All three are optional. Left blank, the published page falls back to its own defaults.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="translation-seo-title">Search title</Label>
              <Input
                id="translation-seo-title"
                value={form.seoTitle}
                disabled={locked}
                dir="auto"
                data-testid="input-translation-seo-title"
                onChange={(e) => patch({ seoTitle: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="translation-seo-description">Search description</Label>
              <Textarea
                id="translation-seo-description"
                rows={3}
                dir="auto"
                value={form.seoDescription}
                disabled={locked}
                data-testid="input-translation-seo-description"
                onChange={(e) => patch({ seoDescription: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="translation-og-image">Sharing image link</Label>
              <Input
                id="translation-og-image"
                value={form.ogImageUrl}
                disabled={locked}
                autoComplete="off"
                placeholder="https://images.unsplash.com/…"
                data-testid="input-translation-og-image"
                onChange={(e) => patch({ ogImageUrl: e.target.value })}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CmsEditorLayout>
    </EditorialPageShell>
  );
}
