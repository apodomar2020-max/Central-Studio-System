/**
 * Website → Editorial → Post editor
 * (/editorial/posts/:id/:languageCode) — Wave 2.1D.
 *
 * The WordPress-like IA, in the Admin 2.0 visual system: a writing canvas on
 * the left (Title, Address, Deck, Context label, Body blocks, SEO) and a
 * sticky sidebar on the right whose FIRST card is Publish, followed by
 * Channel, Author, Topics and the Feature image. At narrow widths the two
 * columns stack and the sidebar comes FIRST, so the Publish card and the
 * status of what you are editing stay above the fold.
 *
 * ─── THREE INDEPENDENT SAVES, NEVER ONE BUTTON ───────────────────────────
 *
 * translation → PATCH /posts/:id/translations/:code   ("Save draft" /
 *                                                      "Update" / "Save changes")
 * shared      → PATCH /posts/:id                      ("Save shared settings")
 * topics      → PUT   /posts/:id/topics               ("Save topics")
 *
 * Each owns its own pending state, its own error alert, its own dirty
 * baseline and its own targeted invalidation. No toast ever says "Post
 * saved": three endpoints give three answers, and claiming all of them
 * succeeded when one did is exactly the failure this model prevents.
 *
 * ─── DOMAIN SEPARATION ───────────────────────────────────────────────────
 *
 * `channel` is read-only with no write path anywhere. `status` moves only
 * through the publish / archive / restore transitions, each behind
 * website.posts:publish and each with its own button — there is no status
 * dropdown and no "Unpublish", because `published -> draft` is not a legal
 * transition. `publishedAt` is read-only and set once. `authorSnapshot` is
 * frozen at publish and is displayed separately from the live Author select.
 *
 * ─── PUBLISHED EDITING ───────────────────────────────────────────────────
 *
 * Re-verified in editorialPostsService.updateTranslation: a published
 * translation stays editable, and the readiness gate is re-run against the
 * RESULT of the mutation inside its own transaction — so a save that would
 * leave it non-publish-ready is rejected atomically, with no partial save
 * and no automatic demotion to draft. That rejection is surfaced as a
 * persistent inline alert above the save button, not only as a toast.
 *
 * The one rule skipped on the edit path is "the language must be active":
 * deactivating a language deliberately leaves already-published translations
 * live AND editable. Publishing in that language is still blocked.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useArchiveEditorialPostTranslation,
  useCreateEditorialPostTranslation,
  useGetEditorialPost,
  useGetEditorialPostTranslation,
  usePublishEditorialPostTranslation,
  useReplaceEditorialPostTopics,
  useRestoreEditorialPostTranslation,
  useUpdateEditorialPostShared,
  useUpdateEditorialPostTranslation,
  getGetEditorialPostQueryKey,
  getGetEditorialPostTranslationQueryKey,
  getListEditorialPostTopicsQueryKey,
  getListEditorialPostTranslationsQueryKey,
  getListEditorialPostsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAdminConfirm } from "@/components/admin/admin-confirm";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useEditorialReferenceData } from "@/hooks/use-editorial-reference-data";
import { useDirtyState, useSaveShortcut } from "@/hooks/use-dirty-state";
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import { PostBodyEditor } from "@/components/editorial/post-body-editor";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import { bylineStatusLabel } from "@/lib/editorial-authors";
import {
  toEditableBlocks,
  validateBody,
  type EditableBlock,
} from "@/lib/editorial-post-body";
import {
  FROZEN_BYLINE_EXPLANATION,
  INACTIVE_LANGUAGE_ADD_BLOCKED,
  INACTIVE_LANGUAGE_EDIT_NOTICE,
  LANGUAGES_REFERENCE_UNAVAILABLE,
  LIVE_CONTENT_WARNING,
  NO_PUBLISH_PERMISSION_NOTICE,
  POST_CHANNEL_IMMUTABLE_EXPLANATION,
  RESTORE_EXPLANATION,
  SHARED_ACROSS_LANGUAGES_LABEL,
  SLUG_LOCKED_EXPLANATION,
  TRANSITION_FAILURE_TITLES,
  TRANSITION_SUCCESS_TITLES,
  TRANSLATION_SPECIFIC_LABEL,
  archivePublishedConfirmation,
  authorReassignmentConfirmation,
  buildLanguageSlots,
  canAddTranslation,
  channelLabel,
  describeSlugProblem,
  formatDateTime,
  isEditorialPostTranslationKey,
  isSlugLocked,
  postCapabilities,
  publishConfirmation,
  publishedTranslationLanguageLabels,
  slotStateLabel,
  slugPreview,
  statusBadgeLabel,
  translationSaveLabel,
} from "@/lib/editorial-posts";
import {
  READINESS_LABELS,
  READINESS_ADVISORY_NOTE,
  areTopicsDirty,
  blockingReadiness,
  isPublishReady,
  isSharedDirty,
  isTranslationDirty,
  publishReadiness,
  readingTimeError,
  toSharedUpdatePayload,
  toTopicsPayload,
  toTranslationFormValues,
  toTranslationUpdatePayload,
  type SharedFormValues,
  type TranslationFormValues,
} from "@/lib/editorial-post-form";
import {
  UNSAVED_INDICATOR_LABEL,
  UNSAVED_LANGUAGE_SWITCH_CONFIRMATION,
  UNSAVED_LEAVE_CONFIRMATION,
  saveFailureTitle,
  saveSuccessMessage,
} from "@/lib/editorial-post-dirty";
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, CircleDashed, Plus, X,
} from "lucide-react";
import "../admin2-final.css";

export default function EditorialPostTranslationPage() {
  const [match, params] = useRoute("/editorial/posts/:id/:languageCode");
  const postId = Number(params?.id ?? 0);
  const languageCode = params?.languageCode ?? "";

  const { can } = useAdminAuth();
  const capabilities = postCapabilities(can);
  const { toast } = useToast();
  const confirmAction = useAdminConfirm();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const reference = useEditorialReferenceData();
  // The generated options object spreads the caller's `query` last, so the
  // key must be supplied whenever any query option is passed — the same
  // convention hooks/use-editorial-reference-data.ts follows.
  const post = useGetEditorialPost(postId, {
    query: { queryKey: getGetEditorialPostQueryKey(postId), enabled: postId > 0 },
  });
  const translation = useGetEditorialPostTranslation(postId, languageCode, {
    query: {
      queryKey: getGetEditorialPostTranslationQueryKey(postId, languageCode),
      enabled: postId > 0 && languageCode.length > 0,
      // A missing translation is an expected 404 (the Add-translation
      // surface), not a transient failure worth retrying.
      retry: false,
    },
  });

  const updateTranslation = useUpdateEditorialPostTranslation();
  const updateShared = useUpdateEditorialPostShared();
  const replaceTopics = useReplaceEditorialPostTopics();
  const publish = usePublishEditorialPostTranslation();
  const archive = useArchiveEditorialPostTranslation();
  const restore = useRestoreEditorialPostTranslation();

  const dirty = useDirtyState();

  // ─── Form state, baselined from the server response ───────────────────────

  const [form, setForm] = useState<TranslationFormValues | null>(null);
  const [baseline, setBaseline] = useState<TranslationFormValues | null>(null);
  /**
   * Which translation row `form`/`baseline` were baselined from.
   *
   * The page no longer remounts when the `:languageCode` route parameter
   * changes (see lib/route-entrance.ts — that remount was destroying the
   * post-level shared and topics state). The re-baseline below is an effect,
   * so it runs AFTER the render in which the new row first arrives; without
   * this guard that one render would paint the previous language's title and
   * body under the new language's heading. Rendering is held on the loading
   * state until the two agree.
   */
  const [formRowId, setFormRowId] = useState<number | null>(null);
  const [shared, setShared] = useState<SharedFormValues | null>(null);
  const [sharedBaseline, setSharedBaseline] = useState<SharedFormValues | null>(null);
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const [topicBaseline, setTopicBaseline] = useState<number[]>([]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);

  /** Persistent inline errors, one per save scope. */
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);

  const translationRow = translation.data;
  const postRow = post.data?.post;

  // Adopt the server's answer as the new baseline whenever a fresh row
  // arrives for a DIFFERENT translation (or the first one). A re-fetch of the
  // same row after a save re-baselines through the mutation's onSuccess
  // instead, so an in-flight edit is never clobbered.
  useEffect(() => {
    if (!translationRow) return;
    const next = toTranslationFormValues(translationRow, toEditableBlocks(translationRow.body));
    setForm(next);
    setBaseline(next);
    setFormRowId(translationRow.id);
    setSlugTouched(false);
    setTranslationError(null);
    dirty.clearScope("translation");
    // Keyed on the translation row's identity, not on its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationRow?.id]);

  useEffect(() => {
    if (!postRow) return;
    const next: SharedFormValues = {
      authorId: postRow.authorId,
      featureImageUrl: postRow.featureImageUrl ?? "",
    };
    setShared(next);
    setSharedBaseline(next);
    const ids = (post.data?.topics ?? []).map((topic) => topic.id);
    setTopicIds(ids);
    setTopicBaseline(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postRow?.id]);

  // ─── Derived ──────────────────────────────────────────────────────────────

  const slugLocked = translationRow ? isSlugLocked(translationRow) : false;

  useEffect(() => {
    if (!form || !baseline) return;
    dirty.setDirty("translation", isTranslationDirty(form, baseline, { slugLocked }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, baseline, slugLocked]);

  useEffect(() => {
    if (!shared || !sharedBaseline) return;
    dirty.setDirty("shared", isSharedDirty(shared, sharedBaseline));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, sharedBaseline]);

  useEffect(() => {
    dirty.setDirty("topics", areTopicsDirty(topicIds, topicBaseline));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicIds, topicBaseline]);

  const slots = useMemo(
    () =>
      buildLanguageSlots(
        reference.languages.data ?? [],
        (post.data?.translations ?? []).map((row) => ({
          languageCode: row.languageCode,
          title: row.title,
          status: row.status,
        })),
      ),
    [reference.languages.data, post.data?.translations],
  );

  /**
   * SAFETY-CRITICAL, and deliberately NOT derived from `slots`.
   *
   * `slots` is built by iterating the Languages REFERENCE list, so a failed
   * Languages query collapses it to `[]` — which used to report "no live
   * languages" for a post that has them, silently skipping the
   * author-reassignment confirmation while the backend still rewrote every
   * published byline. Existence and status come from the post's OWN
   * translations here (an independent query); the Languages list only
   * supplies display names, falling back to the raw code.
   */
  const publishedLanguageLabels = useMemo(
    () =>
      publishedTranslationLanguageLabels(
        post.data?.translations ?? [],
        reference.languages.data ?? [],
      ),
    [post.data?.translations, reference.languages.data],
  );

  const currentLanguage = slots.find((slot) => slot.code === languageCode);
  const languageIsActive = translationRow?.languageIsActive ?? currentLanguage?.isActive ?? true;
  const languageName = currentLanguage?.name ?? languageCode;

  const author = useMemo(
    () => (reference.authors.data ?? []).find((row) => row.id === shared?.authorId) ?? null,
    [reference.authors.data, shared?.authorId],
  );

  const blockProblems = useMemo(() => validateBody(form?.blocks ?? []), [form?.blocks]);

  const readiness = useMemo(
    () =>
      publishReadiness({
        languageIsActive,
        title: form?.title ?? "",
        blocks: (form?.blocks ?? []).map((block) => ({
          type: block.type,
          alt: (block as { alt?: string }).alt,
        })),
        featureImageUrl: shared?.featureImageUrl ?? null,
        featureImageAlt: form?.featureImageAlt ?? null,
        author: author
          ? { publicName: author.publicName, status: author.status, biography: author.biography }
          : null,
      }),
    [languageIsActive, form?.title, form?.blocks, form?.featureImageAlt, shared?.featureImageUrl, author],
  );

  // ─── Cache invalidation, narrow and per-mutation ─────────────────────────

  const invalidateTranslation = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetEditorialPostTranslationQueryKey(postId, languageCode) });
    queryClient.invalidateQueries({ queryKey: getListEditorialPostTranslationsQueryKey(postId) });
    // The post detail carries the translation summaries the switcher reads.
    queryClient.invalidateQueries({ queryKey: getGetEditorialPostQueryKey(postId) });
    // The list row shows the title and the per-language state.
    queryClient.invalidateQueries({ queryKey: getListEditorialPostsQueryKey() });
  }, [queryClient, postId, languageCode]);

  const invalidateShared = useCallback((authorChanged: boolean) => {
    queryClient.invalidateQueries({ queryKey: getGetEditorialPostQueryKey(postId) });
    queryClient.invalidateQueries({ queryKey: getListEditorialPostsQueryKey() });
    // Reference data is NOT invalidated: changing a post's author changes no
    // author row, and re-fetching the shared 5-minute cache would undo the
    // whole point of useEditorialReferenceData().

    // An author reassignment is the one shared field with a translation-level
    // blast radius: updatePostSharedFields rewrites `authorSnapshot` on EVERY
    // currently-published translation of this post, in the same transaction.
    // So every cached language of THIS post has to go, not just the open one —
    // otherwise switching to another published language shows the old byline.
    //
    // The generated key is a single string holding the whole path, so an array
    // prefix cannot match across languages; a predicate on that string prefix
    // is the narrow, supported equivalent. It is deliberately NOT a bare
    // invalidateQueries(): other posts, the authors list and every unrelated
    // query stay cached.
    if (authorChanged) {
      queryClient.invalidateQueries({
        predicate: (query) => isEditorialPostTranslationKey(postId, query.queryKey),
      });
    }
  }, [queryClient, postId]);

  const invalidateTopics = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListEditorialPostTopicsQueryKey(postId) });
    queryClient.invalidateQueries({ queryKey: getGetEditorialPostQueryKey(postId) });
  }, [queryClient, postId]);

  // ─── Saves ────────────────────────────────────────────────────────────────

  const saveTranslation = useCallback(() => {
    if (!form || !baseline || !translationRow) return;
    if (blockProblems.length > 0) {
      setTranslationError("Some blocks are not valid yet — fix the highlighted fields and save again.");
      return;
    }
    // The reading-time override was validated for DISPLAY only — the inline
    // message was rendered but never consulted here, so `0` reached the
    // request, passed the generated schema (which has no min), and died on
    // the DB's `> 0` CHECK as an opaque 500. Nothing is sent while the field
    // is invalid; the field's own inline message is the explanation, and
    // this alert says which field to look at.
    const readTimeProblem = readingTimeError(form.readingTimeOverrideMinutes);
    if (readTimeProblem) {
      setTranslationError(`Reading time override: ${readTimeProblem}`);
      return;
    }
    const payload = toTranslationUpdatePayload(form, baseline, { slugLocked });
    if (Object.keys(payload).length === 0) return;
    setTranslationError(null);
    updateTranslation.mutate(
      { id: postId, languageCode, data: payload },
      {
        onSuccess: (saved) => {
          const next = toTranslationFormValues(saved, toEditableBlocks(saved.body));
          setForm(next);
          setBaseline(next);
          setSlugTouched(false);
          // ONLY this scope clears.
          dirty.clearScope("translation");
          invalidateTranslation();
          toast({ title: "Saved", description: saveSuccessMessage("translation") });
        },
        onError: (err) => {
          // The scope stays dirty — nothing was written.
          setTranslationError(editorialErrorMessage(err));
          toast({
            title: saveFailureTitle("translation"),
            description: editorialErrorMessage(err),
            variant: "destructive",
          });
        },
      },
    );
  }, [form, baseline, translationRow, blockProblems, slugLocked, postId, languageCode, updateTranslation, dirty, invalidateTranslation, toast]);

  // Cmd/Ctrl+S saves the translation scope only, and only while it is dirty.
  // It can never publish.
  useSaveShortcut(dirty.flags.translation && capabilities.canEdit, saveTranslation);

  const saveShared = async () => {
    if (!shared || !sharedBaseline) return;
    const payload = toSharedUpdatePayload(shared, sharedBaseline);
    if (Object.keys(payload).length === 0) return;

    // The author actually moved relative to the last server answer, and at
    // least one language of this post is live: the save rewrites those live
    // bylines the moment it succeeds, including languages not on screen.
    const authorChanged = shared.authorId !== sharedBaseline.authorId;
    const liveLanguages = publishedLanguageLabels;
    if (authorChanged && liveLanguages.length > 0) {
      if (!(await confirmAction(authorReassignmentConfirmation({ languageNames: liveLanguages })))) return;
    }

    setSharedError(null);
    updateShared.mutate(
      { id: postId, data: payload },
      {
        onSuccess: (saved) => {
          const next: SharedFormValues = {
            authorId: saved.authorId,
            featureImageUrl: saved.featureImageUrl ?? "",
          };
          setShared(next);
          setSharedBaseline(next);
          // ONLY this scope clears — translation and topics keep their own
          // dirty state, and the refetch below cannot reset the translation
          // form because that re-baseline effect is keyed on the translation
          // row's id, not on its contents.
          dirty.clearScope("shared");
          invalidateShared(authorChanged);
          toast({ title: "Saved", description: saveSuccessMessage("shared") });
        },
        onError: (err) => {
          setSharedError(editorialErrorMessage(err));
          toast({
            title: saveFailureTitle("shared"),
            description: editorialErrorMessage(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  const saveTopics = () => {
    setTopicsError(null);
    replaceTopics.mutate(
      // FULL REPLACE: the complete desired set, never a delta.
      { id: postId, data: toTopicsPayload(topicIds) },
      {
        onSuccess: (saved) => {
          const ids = saved.map((topic) => topic.id);
          setTopicIds(ids);
          setTopicBaseline(ids);
          dirty.clearScope("topics");
          invalidateTopics();
          toast({ title: "Saved", description: saveSuccessMessage("topics") });
        },
        onError: (err) => {
          setTopicsError(editorialErrorMessage(err));
          toast({
            title: saveFailureTitle("topics"),
            description: editorialErrorMessage(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * The failure title is passed in, never derived from the success title.
   *
   * It used to be `successTitle.replace(/ed$/, " failed")`. That happens to
   * read correctly for "Published" -> "Publish failed" and for nothing else:
   * "Archived" became "Archiv failed", and "Restored to draft" does not end
   * in "ed" at all, so a FAILED restore was announced with the untouched
   * success sentence "Restored to draft" — a success-sounding title on a
   * destructive-variant toast, for an operation that did not happen.
   *
   * Nothing here mutates local state on the failure path: the transition
   * result is only ever adopted by re-fetching (invalidateTranslation on
   * success), so a rejected transition leaves `status`, the form, the
   * baseline and every dirty flag exactly as they were, and surfaces the
   * server's reason as the persistent inline alert as well as the toast.
   */
  const runTransition = (
    mutation: { mutate: (vars: { id: number; languageCode: string }, opts: object) => void },
    successTitle: string,
    failureTitle: string,
    description: string,
  ) => {
    mutation.mutate(
      { id: postId, languageCode },
      {
        onSuccess: () => {
          invalidateTranslation();
          toast({ title: successTitle, description });
        },
        onError: (err: unknown) => {
          setTranslationError(editorialErrorMessage(err));
          toast({ title: failureTitle, description: editorialErrorMessage(err), variant: "destructive" });
        },
      },
    );
  };

  const handlePublish = async () => {
    if (!translationRow) return;
    if (!(await confirmAction(publishConfirmation({ title: form?.title ?? translationRow.title, languageName })))) return;
    runTransition(
      publish,
      TRANSITION_SUCCESS_TITLES.publish,
      TRANSITION_FAILURE_TITLES.publish,
      `The ${languageName} translation is now on the website.`,
    );
  };

  const handleArchive = async () => {
    if (!translationRow) return;
    // Confirmed only when it is actually LIVE — archiving a draft removes
    // nothing from the website.
    if (translationRow.status === "published") {
      if (!(await confirmAction(archivePublishedConfirmation({ title: form?.title ?? translationRow.title, languageName })))) return;
    }
    runTransition(
      archive,
      TRANSITION_SUCCESS_TITLES.archive,
      TRANSITION_FAILURE_TITLES.archive,
      `The ${languageName} translation is no longer on the website.`,
    );
  };

  // Restore is non-destructive and immediately reversible — no confirmation.
  const handleRestore = () =>
    runTransition(
      restore,
      TRANSITION_SUCCESS_TITLES.restore,
      TRANSITION_FAILURE_TITLES.restore,
      RESTORE_EXPLANATION,
    );

  // ─── Guarded navigation (wouter has no blocker — we route our own leaves) ──

  const leaveGuard = async (confirmation: typeof UNSAVED_LEAVE_CONFIRMATION): Promise<boolean> => {
    if (!dirty.anyDirty) return true;
    return confirmAction({ ...confirmation });
  };

  const goToList = async () => {
    if (await leaveGuard(UNSAVED_LEAVE_CONFIRMATION)) navigate("/editorial/posts");
  };

  const switchLanguage = async (code: string) => {
    if (code === languageCode) return;
    // Only the TRANSLATION scope is at risk: shared settings and topics
    // survive a language switch because they belong to the post.
    if (dirty.flags.translation && !(await confirmAction({ ...UNSAVED_LANGUAGE_SWITCH_CONFIRMATION }))) return;
    navigate(`/editorial/posts/${postId}/${code}`);
  };

  // ─── Render guards ────────────────────────────────────────────────────────

  if (!match || postId <= 0) return null;

  // A language with no translation row yet. The switcher routes here on
  // purpose, so this URL is the "Add translation" surface rather than a dead
  // end — `POST /posts/:id/translations` is a separate endpoint from the post
  // create, and needs website.posts:create.
  if (translation.isError && postRow && currentLanguage && currentLanguage.state === "missing") {
    return (
      <AddTranslationScreen
        postId={postId}
        languageCode={languageCode}
        languageName={languageName}
        channel={postRow.channel}
        canCreate={capabilities.canCreate}
      />
    );
  }

  if (
    post.isLoading ||
    translation.isLoading ||
    !form ||
    !shared ||
    !translationRow ||
    !postRow ||
    // The form still belongs to the language we just left — see formRowId.
    formRowId !== translationRow.id
  ) {
    return (
      <EditorialPageShell heading="Post">
        <div className="rounded-md border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
          {post.isError || translation.isError
            ? "This post or translation could not be loaded."
            : "Loading…"}
        </div>
      </EditorialPageShell>
    );
  }

  const readOnly = !capabilities.canEdit;
  const status = translationRow.status;
  const publishBlockers = blockingReadiness(readiness);
  const ready = isPublishReady(readiness);

  return (
    <EditorialPageShell
      heading={form.title.trim().length > 0 ? form.title : "Untitled post"}
      description={`${channelLabel(postRow.channel)} · ${languageName} · post #${postRow.id}`}
      actions={
        <div className="flex items-center gap-2">
          {dirty.anyDirty && (
            <Badge variant="outline" className="gap-1.5" data-testid="unsaved-indicator">
              <CircleDashed className="h-3 w-3" aria-hidden="true" />
              {UNSAVED_INDICATOR_LABEL}
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="compact"
            className="gap-1.5 shrink-0"
            data-testid="button-back-to-posts"
            onClick={goToList}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to posts
          </Button>
        </div>
      }
    >
      {dirty.summary && (
        <p role="status" className="text-xs text-muted-foreground" data-testid="unsaved-summary">
          {dirty.summary} Nothing is saved automatically.
        </p>
      )}

      {/* ─── Language switcher: prominent, never a buried field ───────────── */}
      <nav aria-label="Translations" className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Languages</span>
          {slots.map((slot) => {
            const isCurrent = slot.code === languageCode;
            const exists = slot.state === "draft" || slot.state === "published" || slot.state === "archived";
            return (
              <Button
                key={slot.code}
                type="button"
                size="compact"
                variant={isCurrent ? "default" : "outline"}
                aria-current={isCurrent ? "page" : undefined}
                // A missing translation in a RETIRED language cannot be created.
                disabled={slot.state === "missing-inactive" || (canAddTranslation(slot) && !capabilities.canCreate)}
                title={slot.state === "missing-inactive" ? INACTIVE_LANGUAGE_ADD_BLOCKED : undefined}
                data-testid={`button-language-${slot.code}`}
                onClick={() => (exists ? switchLanguage(slot.code) : navigate(`/editorial/posts/${postId}/${slot.code}`))}
              >
                {!exists && <Plus className="h-3 w-3" aria-hidden="true" />}
                {slot.name}
                <span className="ml-1 opacity-70">· {slotStateLabel(slot.state)}</span>
                {slot.inLanguageThatIsInactive && <span className="ml-1 opacity-70">(retired)</span>}
              </Button>
            );
          })}
        </div>
        {/* The Languages reference list failing used to render an empty box
            and nothing else. It is now stated, with the repo's own
            "X could not be loaded." error-state wording. No language data is
            invented to fill the gap. */}
        {reference.languages.isError && (
          <p role="alert" className="mt-2 text-xs text-destructive" data-testid="languages-reference-error">
            {LANGUAGES_REFERENCE_UNAVAILABLE}
          </p>
        )}
        {slots.some((slot) => slot.state === "missing-inactive") && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="inactive-language-add-note">
            {INACTIVE_LANGUAGE_ADD_BLOCKED}
          </p>
        )}
      </nav>

      {!languageIsActive && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="inactive-language-edit-notice"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">{INACTIVE_LANGUAGE_EDIT_NOTICE}</p>
        </div>
      )}

      {status === "published" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="live-content-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-xs text-foreground">{LIVE_CONTENT_WARNING}</p>
        </div>
      )}

      {/* ─── Two columns: canvas + sticky sidebar. Stacks sidebar-FIRST. ──── */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* Sidebar is first in DOM order so it leads when stacked; on lg it is
            placed in column 2 so the canvas reads left-to-right. */}
        <aside className="space-y-4 lg:order-2 lg:sticky lg:top-4" aria-label="Post settings">
          {/* ─── Publish card, pinned top ─────────────────────────────────── */}
          <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="publish-card">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Publishing</h3>
              <Badge variant={status === "published" ? "default" : "outline"} data-testid="publish-status-badge">
                {statusBadgeLabel(status)}
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">First published</dt>
              <dd className="tabular-nums" data-testid="published-at">{formatDateTime(translationRow.publishedAt)}</dd>
              <dt className="text-muted-foreground">Last saved</dt>
              <dd className="tabular-nums" data-testid="last-saved">{formatDateTime(translationRow.updatedAt)}</dd>
            </dl>

            {translationRow.publishedAt && (
              <p className="text-[11px] text-muted-foreground">
                The publication date is set once, on this language's first publish, and never changes.
              </p>
            )}

            {translationRow.authorSnapshot && (
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5" data-testid="frozen-byline">
                <p className="text-[11px] font-medium text-foreground">
                  Published byline: {translationRow.authorSnapshot.name}
                </p>
                <p className="text-[11px] text-muted-foreground" data-testid="frozen-byline-explanation">
                  {FROZEN_BYLINE_EXPLANATION}
                </p>
              </div>
            )}

            {/* Advisory checklist, built only from what the server enforces. */}
            <div className="space-y-1" data-testid="readiness-checklist">
              <p className="text-xs font-medium text-muted-foreground">Before publishing</p>
              <ul className="space-y-0.5">
                {readiness.map((item) => (
                  <li key={item.key} className="flex items-start gap-1.5 text-[11px]" data-testid={`readiness-${item.key}`}>
                    {item.ok ? (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
                    )}
                    <span className={item.ok ? "text-muted-foreground" : "text-foreground"}>
                      {READINESS_LABELS[item.key]}
                      {!item.ok && <span className="block text-muted-foreground">{item.message}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">{READINESS_ADVISORY_NOTE}</p>
            </div>

            {translationError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                data-testid="translation-error-alert"
              >
                {translationError}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {/* D7: the label always says what the save will do. */}
              <Button
                type="button"
                disabled={readOnly || !dirty.flags.translation || updateTranslation.isPending}
                data-testid="button-save-translation"
                onClick={saveTranslation}
              >
                {updateTranslation.isPending ? "Saving…" : translationSaveLabel(status)}
              </Button>

              {capabilities.canPublish ? (
                <>
                  {status === "draft" && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!ready || publish.isPending || dirty.flags.translation}
                      data-testid="button-publish"
                      onClick={handlePublish}
                    >
                      {publish.isPending ? "Publishing…" : "Publish"}
                    </Button>
                  )}
                  {(status === "draft" || status === "published") && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={archive.isPending}
                      data-testid="button-archive"
                      onClick={handleArchive}
                    >
                      {archive.isPending ? "Archiving…" : "Archive"}
                    </Button>
                  )}
                  {status === "archived" && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={restore.isPending}
                      data-testid="button-restore"
                      onClick={handleRestore}
                    >
                      {restore.isPending ? "Restoring…" : "Restore to draft"}
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground" data-testid="no-publish-permission">
                  {NO_PUBLISH_PERMISSION_NOTICE}
                </p>
              )}

              {capabilities.canPublish && status === "draft" && dirty.flags.translation && (
                <p className="text-[11px] text-muted-foreground" data-testid="publish-needs-save">
                  Save this language's changes first — publishing puts the SAVED version live.
                </p>
              )}
              {capabilities.canPublish && status === "draft" && !ready && !dirty.flags.translation && (
                <p className="text-[11px] text-muted-foreground" data-testid="publish-blocked">
                  {publishBlockers.length} thing{publishBlockers.length === 1 ? "" : "s"} still to fix before
                  this language can be published.
                </p>
              )}
              {status === "archived" && (
                <p className="text-[11px] text-muted-foreground">{RESTORE_EXPLANATION}</p>
              )}
            </div>
          </section>

          {/* ─── Channel (read-only, no write path) ───────────────────────── */}
          <section className="rounded-md border border-border bg-card p-3 space-y-1" data-testid="channel-card">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Channel</h3>
              <Badge variant="outline" data-testid="channel-badge">{channelLabel(postRow.channel)}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>
            <p className="text-[11px] text-muted-foreground">{POST_CHANNEL_IMMUTABLE_EXPLANATION}</p>
          </section>

          {/* ─── Author + feature image share ONE endpoint, so ONE save ───── */}
          <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="shared-card">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Author &amp; feature image</h3>
              {dirty.flags.shared && (
                <Badge variant="outline" className="text-[10px]" data-testid="shared-dirty">Unsaved</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>

            <AuthorPicker
              value={shared.authorId}
              channel={postRow.channel}
              authors={reference.authors.data ?? []}
              disabled={readOnly}
              onChange={(authorId) => setShared((current) => (current ? { ...current, authorId } : current))}
            />

            <div className="grid gap-1.5">
              <Label htmlFor="feature-image-url">Feature image link</Label>
              <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>
              <Input
                id="feature-image-url"
                value={shared.featureImageUrl}
                disabled={readOnly}
                autoComplete="off"
                placeholder="https://images.unsplash.com/…"
                data-testid="input-feature-image-url"
                onChange={(e) =>
                  setShared((current) => (current ? { ...current, featureImageUrl: e.target.value } : current))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Must be an https link on an approved image host: picsum.photos, images.unsplash.com,
                res.cloudinary.com, static.wixstatic.com, lh3.googleusercontent.com. The link is checked
                when you save.
              </p>
              {shared.featureImageUrl.trim().length > 0 && (
                <img
                  src={shared.featureImageUrl.trim()}
                  alt=""
                  className="max-h-28 w-auto rounded-md border border-border object-cover"
                  data-testid="feature-image-preview"
                />
              )}
              {/* Accurate, not invented: the server deliberately does NOT clear
                  any translation's localized alt when the shared URL changes. */}
              {dirty.flags.shared && sharedBaseline &&
                shared.featureImageUrl.trim() !== sharedBaseline.featureImageUrl.trim() && (
                <p className="text-[11px] text-muted-foreground" data-testid="feature-image-alt-notice">
                  Changing this link does not change any language's alt text. Check that every language's
                  alt text still describes the new image.
                </p>
              )}
            </div>

            {sharedError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                data-testid="shared-error-alert"
              >
                {sharedError}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={readOnly || !dirty.flags.shared || updateShared.isPending}
              data-testid="button-save-shared"
              onClick={saveShared}
            >
              {updateShared.isPending ? "Saving…" : "Save shared settings"}
            </Button>
          </section>

          {/* ─── Topics: its own endpoint, its own button ─────────────────── */}
          <TopicsCard
            channel={postRow.channel}
            topics={reference.topics.data ?? []}
            selected={topicIds}
            dirty={dirty.flags.topics}
            saving={replaceTopics.isPending}
            disabled={readOnly}
            error={topicsError}
            onChange={setTopicIds}
            onSave={saveTopics}
          />
        </aside>

        {/* ─── Writing canvas ───────────────────────────────────────────── */}
        <div className="space-y-4 lg:order-1 min-w-0">
          <section className="rounded-md border border-border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{languageName}</h3>
              <Badge variant="outline" className="text-[10px]">{TRANSLATION_SPECIFIC_LABEL}</Badge>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="translation-title">Title</Label>
              <Input
                id="translation-title"
                value={form.title}
                disabled={readOnly}
                dir="auto"
                className="text-base"
                data-testid="input-translation-title"
                onChange={(e) => setForm((current) => (current ? { ...current, title: e.target.value } : current))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="translation-slug">Address</Label>
              {slugLocked ? (
                <>
                  <Input
                    id="translation-slug"
                    value={form.slug}
                    readOnly
                    disabled
                    dir="auto"
                    className="font-mono"
                    aria-describedby="translation-slug-help"
                    data-testid="input-translation-slug"
                  />
                  <p id="translation-slug-help" className="text-xs text-muted-foreground" data-testid="slug-locked-explanation">
                    {SLUG_LOCKED_EXPLANATION}
                  </p>
                </>
              ) : (
                <>
                  <Input
                    id="translation-slug"
                    value={form.slug}
                    disabled={readOnly}
                    dir="auto"
                    className="font-mono"
                    autoComplete="off"
                    aria-describedby="translation-slug-help"
                    data-testid="input-translation-slug"
                    onChange={(e) => {
                      setSlugTouched(true);
                      setForm((current) => (current ? { ...current, slug: e.target.value } : current));
                    }}
                  />
                  <p id="translation-slug-help" className="text-xs text-muted-foreground">
                    Editable until this language is published for the first time, after which the public
                    address is fixed.
                    {!slugTouched && slugPreview(form.title).length > 0 && form.slug !== slugPreview(form.title) && (
                      <> Suggested from the title: <span className="font-mono" dir="auto">{slugPreview(form.title)}</span></>
                    )}
                  </p>
                </>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="translation-deck">Deck</Label>
              <Textarea
                id="translation-deck"
                rows={2}
                dir="auto"
                value={form.deck}
                disabled={readOnly}
                placeholder="A sentence or two under the headline."
                data-testid="input-translation-deck"
                onChange={(e) => setForm((current) => (current ? { ...current, deck: e.target.value } : current))}
              />
            </div>

            {/* contextLabel IS a real column on editorial_post_translations and
                IS accepted by the PATCH body — verified, not assumed. */}
            <div className="grid gap-1.5">
              <Label htmlFor="translation-context-label">Context label</Label>
              <Input
                id="translation-context-label"
                value={form.contextLabel}
                disabled={readOnly}
                dir="auto"
                placeholder="Festival diary"
                data-testid="input-translation-context-label"
                onChange={(e) =>
                  setForm((current) => (current ? { ...current, contextLabel: e.target.value } : current))
                }
              />
              <p className="text-xs text-muted-foreground">
                An optional kicker shown above the headline, in this language.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="translation-feature-alt">Feature image alt text</Label>
              <Badge variant="outline" className="w-fit text-[10px]">{TRANSLATION_SPECIFIC_LABEL}</Badge>
              <Input
                id="translation-feature-alt"
                value={form.featureImageAlt}
                disabled={readOnly}
                dir="auto"
                placeholder="What the feature image shows, in this language"
                data-testid="input-translation-feature-alt"
                onChange={(e) =>
                  setForm((current) => (current ? { ...current, featureImageAlt: e.target.value } : current))
                }
              />
              <p className="text-xs text-muted-foreground">
                The image itself is shared with every language; its description is prose, so each language
                writes its own. Required before this language can be published.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="translation-read-time">Reading time override (minutes)</Label>
              <Input
                id="translation-read-time"
                value={form.readingTimeOverrideMinutes}
                disabled={readOnly}
                inputMode="numeric"
                className="max-w-[10rem]"
                data-testid="input-translation-read-time"
                onChange={(e) =>
                  setForm((current) =>
                    current ? { ...current, readingTimeOverrideMinutes: e.target.value } : current,
                  )
                }
              />
              <p
                className={
                  readingTimeError(form.readingTimeOverrideMinutes) ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
                data-testid="read-time-message"
              >
                {readingTimeError(form.readingTimeOverrideMinutes) ??
                  "Leave blank to use the estimate derived from the body."}
              </p>
            </div>
          </section>

          <section className="rounded-md border border-border bg-card p-3">
            <PostBodyEditor
              blocks={form.blocks}
              problems={blockProblems}
              disabled={readOnly}
              onChange={(next: EditableBlock[]) =>
                setForm((current) => (current ? { ...current, blocks: next } : current))
              }
            />
          </section>

          {/* ─── SEO, collapsed by default ────────────────────────────────── */}
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
                All three are per-language and all three are optional. Left blank, the public site falls
                back to its own defaults — the Admin invents no fallback of its own.
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="translation-seo-title">Search title</Label>
                <Input
                  id="translation-seo-title"
                  value={form.seoTitle}
                  disabled={readOnly}
                  dir="auto"
                  data-testid="input-translation-seo-title"
                  onChange={(e) => setForm((current) => (current ? { ...current, seoTitle: e.target.value } : current))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="translation-seo-description">Search description</Label>
                <Textarea
                  id="translation-seo-description"
                  rows={3}
                  dir="auto"
                  value={form.seoDescription}
                  disabled={readOnly}
                  data-testid="input-translation-seo-description"
                  onChange={(e) =>
                    setForm((current) => (current ? { ...current, seoDescription: e.target.value } : current))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="translation-og-image">Sharing image link</Label>
                <Input
                  id="translation-og-image"
                  value={form.ogImageUrl}
                  disabled={readOnly}
                  autoComplete="off"
                  placeholder="https://images.unsplash.com/…"
                  data-testid="input-translation-og-image"
                  onChange={(e) => setForm((current) => (current ? { ...current, ogImageUrl: e.target.value } : current))}
                />
                <p className="text-xs text-muted-foreground">
                  Checked against the approved image hosts when you save, and again when you publish.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {readOnly && (
            <p className="text-xs text-muted-foreground" data-testid="read-only-notice">
              You have view access to this post but cannot change it. Editing needs the Edit permission on
              Website Editorial Posts.
            </p>
          )}
        </div>
      </div>
    </EditorialPageShell>
  );
}

// ─── Author picker ───────────────────────────────────────────────────────────

/**
 * Single-select, filtered to the post's channel. An author who is ARCHIVED
 * but currently assigned stays visible and selected (the backend keeps the
 * assignment; only a NEW assignment is refused) and is rendered disabled with
 * an Archived badge. `systemUserId` is never exposed.
 */
function AuthorPicker({
  value,
  channel,
  authors,
  disabled,
  onChange,
}: {
  value: number | null;
  channel: string;
  authors: ReadonlyArray<{ id: number; publicName: string; channel: string; status: "active" | "archived"; biography: string | null }>;
  disabled?: boolean;
  onChange: (authorId: number | null) => void;
}) {
  const inChannel = authors.filter((author) => author.channel === channel);
  const selectable = inChannel.filter((author) => author.status === "active");
  const assigned = inChannel.find((author) => author.id === value) ?? null;
  // The currently-assigned author is unioned in even when archived, so the
  // select never silently drops the real value.
  const options = assigned && assigned.status !== "active" ? [assigned, ...selectable] : selectable;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="post-author">Author</Label>
      {selectable.length === 0 && !assigned ? (
        <p className="text-[11px] text-muted-foreground" data-testid="no-authors-empty-state">
          No active {channel} authors exist yet. Add one in{" "}
          <Link href="/editorial/authors" className="underline">Authors</Link>, then assign it here.
        </p>
      ) : (
        <Select
          value={value == null ? "none" : String(value)}
          disabled={disabled}
          onValueChange={(next) => onChange(next === "none" ? null : Number(next))}
        >
          <SelectTrigger id="post-author" data-testid="select-post-author">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No author</SelectItem>
            {options.map((author) => (
              <SelectItem
                key={author.id}
                value={String(author.id)}
                // Visible so the real value renders, but never newly selectable.
                disabled={author.status !== "active"}
              >
                {author.publicName} — {bylineStatusLabel(author)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {assigned && (
        <p className="text-[11px] text-muted-foreground" data-testid="author-byline-state">
          Byline: {bylineStatusLabel(assigned)}.
          {assigned.status !== "active" && " An archived author blocks publishing — choose an active one."}
        </p>
      )}
    </div>
  );
}

// ─── Topics ──────────────────────────────────────────────────────────────────

/**
 * Searchable multi-select with removable chips. Options are ACTIVE topics in
 * the post's channel, unioned with any currently-assigned topic id so an
 * archived-but-assigned topic still renders (with a badge, not selectable for
 * a NEW assignment). Saving sends the complete desired set: the route
 * replaces rather than merges.
 */
function TopicsCard({
  channel,
  topics,
  selected,
  dirty,
  saving,
  disabled,
  error,
  onChange,
  onSave,
}: {
  channel: string;
  topics: ReadonlyArray<{ id: number; name: string; channel: string; status: "active" | "archived" }>;
  selected: number[];
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  error: string | null;
  onChange: (next: number[]) => void;
  onSave: () => void;
}) {
  const [search, setSearch] = useState("");
  const inChannel = topics.filter((topic) => topic.channel === channel);
  const byId = new Map(inChannel.map((topic) => [topic.id, topic]));
  const needle = search.trim().toLowerCase();

  const options = inChannel.filter(
    (topic) =>
      topic.status === "active" &&
      !selected.includes(topic.id) &&
      (needle.length === 0 || topic.name.toLowerCase().includes(needle)),
  );

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="topics-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Topics</h3>
        {dirty && <Badge variant="outline" className="text-[10px]" data-testid="topics-dirty">Unsaved</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>

      <div className="flex flex-wrap gap-1.5" data-testid="topic-chips">
        {selected.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">No topics assigned.</span>
        ) : (
          selected.map((id) => {
            const topic = byId.get(id);
            return (
              <Badge key={id} variant="outline" className="gap-1" data-testid={`topic-chip-${id}`}>
                {topic?.name ?? `Topic #${id}`}
                {topic && topic.status !== "active" && <span className="opacity-70">(archived)</span>}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Remove topic ${topic?.name ?? id}`}
                    data-testid={`button-remove-topic-${id}`}
                    onClick={() => onChange(selected.filter((current) => current !== id))}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            );
          })
        )}
      </div>

      {inChannel.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="no-topics-empty-state">
          No {channel} topics exist yet. Create one in{" "}
          <Link href="/editorial/topics" className="underline">Topics</Link>.
        </p>
      ) : (
        <>
          <Input
            value={search}
            disabled={disabled}
            placeholder="Search topics…"
            aria-label="Search topics to add"
            data-testid="input-topic-search"
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {options.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No more matching topics.</span>
            ) : (
              options.map((topic) => (
                <Button
                  key={topic.id}
                  type="button"
                  size="compact"
                  variant="outline"
                  className="gap-1"
                  disabled={disabled}
                  data-testid={`button-add-topic-${topic.id}`}
                  onClick={() => onChange([...selected, topic.id])}
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  {topic.name}
                </Button>
              ))
            )}
          </div>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          data-testid="topics-error-alert"
        >
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled || !dirty || saving}
        data-testid="button-save-topics"
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save topics"}
      </Button>
    </section>
  );
}

// ─── Add translation ─────────────────────────────────────────────────────────

/**
 * The editor URL for a language that has no translation row yet.
 *
 * A separate endpoint (`POST /posts/:id/translations`, website.posts:create)
 * with the same slug semantics as the post create: blank slug -> `null`, so
 * the SERVER generates it and owns collision suffixing.
 */
function AddTranslationScreen({
  postId,
  languageCode,
  languageName,
  channel,
  canCreate,
}: {
  postId: number;
  languageCode: string;
  languageName: string;
  channel: string;
  canCreate: boolean;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTranslation = useCreateEditorialPostTranslation();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0) {
      setError("A title is required.");
      return;
    }
    const manual = slug.trim();
    const problem = manual.length > 0 ? describeSlugProblem(manual) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    createTranslation.mutate(
      {
        id: postId,
        data: {
          languageCode,
          title: title.trim(),
          slug: manual.length > 0 ? manual : null,
          body: { blocks: [] },
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEditorialPostQueryKey(postId) });
          queryClient.invalidateQueries({ queryKey: getListEditorialPostTranslationsQueryKey(postId) });
          queryClient.invalidateQueries({ queryKey: getListEditorialPostsQueryKey() });
          toast({
            title: `${languageName} translation added`,
            description: "It is a draft and is not on the website yet.",
          });
          navigate(`/editorial/posts/${postId}/${languageCode}`);
        },
        onError: (err) => setError(editorialErrorMessage(err)),
      },
    );
  };

  return (
    <EditorialPageShell
      heading={`Add the ${languageName} translation`}
      description={`This ${channel} post has no ${languageName} version yet. Every language has its own title, address, body and lifecycle.`}
      actions={
        <Button asChild variant="outline" size="compact" className="gap-1.5 shrink-0">
          <Link href={`/editorial/posts/${postId}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to the post
          </Link>
        </Button>
      }
    >
      {!canCreate ? (
        <div
          className="rounded-md border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
          data-testid="add-translation-forbidden"
        >
          Adding a translation needs the Create permission on Website Editorial Posts.
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="add-translation-error"
            >
              {error}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="add-translation-title">Title in {languageName}</Label>
            <Input
              id="add-translation-title"
              value={title}
              dir="auto"
              autoComplete="off"
              data-testid="input-add-translation-title"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-translation-slug">Address (optional)</Label>
            <Input
              id="add-translation-slug"
              value={slug}
              dir="auto"
              className="font-mono"
              autoComplete="off"
              placeholder={slugPreview(title) || "opening-night"}
              data-testid="input-add-translation-slug"
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank and the address is generated from the title when you save — including a numbered
              suffix if that address is already taken in {languageName}.
              {!slugTouched && slugPreview(title).length > 0 && (
                <> Preview: <span className="font-mono" dir="auto">/{slugPreview(title)}</span></>
              )}
            </p>
          </div>
          <Button type="submit" disabled={createTranslation.isPending} data-testid="button-add-translation">
            {createTranslation.isPending ? "Adding…" : `Add ${languageName} draft`}
          </Button>
        </form>
      )}
    </EditorialPageShell>
  );
}
