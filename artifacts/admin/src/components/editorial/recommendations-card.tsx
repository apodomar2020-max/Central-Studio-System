/**
 * Recommended reading card — Wave 2.1E.
 *
 * Structurally identical to TopicsCard, because the endpoint is: a post-level
 * PUT-replace with its own permission, its own dirty scope, its own error slot
 * and its own Save button. It is the FOURTH independent save in this editor.
 *
 * ─── ONE PUT PER EXPLICIT SAVE, NEVER ONE PER CLICK ──────────────────────
 *
 * Every PUT takes a post row lock, rewrites every relation row, may write a
 * `shared_field_change` revision and always writes an audit row. Mutating on
 * each add / remove / move would therefore turn a four-click reorder into four
 * spurious revisions and four audit rows. Add, remove and move are LOCAL array
 * edits; Save sends the whole list once.
 *
 * ─── ORDER IS THE PAYLOAD ────────────────────────────────────────────────
 *
 * The server writes `position: item.position ?? index`, so the array's order
 * is authoritative and the payload deliberately omits `position`.
 *
 * ─── DIRECTIONAL ─────────────────────────────────────────────────────────
 *
 * Editing this list changes only "posts recommended FROM this post". Nothing
 * writes the reverse pointer and no endpoint answers "who recommends this
 * one", so the card never implies either.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useListEditorialPosts,
  getListEditorialPostsQueryKey,
  type EditorialRecommendation,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SHARED_ACROSS_LANGUAGES_LABEL, translationSummaryLabel } from "@/lib/editorial-posts";
import {
  type CandidateChannel,
  RECOMMENDATIONS_CAP_MESSAGE,
  RECOMMENDATIONS_CARD_TITLE,
  RECOMMENDATIONS_CHANNEL_NOTE,
  RECOMMENDATIONS_DIRECTION_EXPLANATION,
  RECOMMENDATIONS_EMPTY_STATE,
  RECOMMENDATIONS_PUBLISHED_FILTER_NOTE,
  RECOMMENDATIONS_SAVE_LABEL,
  addRecommendation,
  canAddRecommendation,
  candidateCountLabel,
  filterCandidates,
  moveAnnouncement,
  moveRecommendationDown,
  moveRecommendationUp,
  pickTargetLabel,
  recommendationLabel,
  recommendationLanguageTag,
  removeRecommendation,
  targetStateAnnotation,
  toCandidateQuery,
} from "@/lib/editorial-recommendations";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

interface TargetDisplay {
  label: string;
  languageTag: string | null;
  annotation: string | null;
}

export function RecommendationsCard({
  postId,
  channel,
  openLanguageCode,
  saved,
  selected,
  languages,
  dirty,
  saving,
  disabled,
  error,
  onChange,
  onSave,
}: {
  postId: number;
  channel: CandidateChannel;
  openLanguageCode: string;
  /** The server's own answer, from the post detail the editor already holds. */
  saved: ReadonlyArray<EditorialRecommendation>;
  selected: number[];
  languages: ReadonlyArray<{ code: string; isDefault: boolean; displayOrder: number }>;
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  error: string | null;
  onChange: (next: number[]) => void;
  onSave: () => void;
}) {
  const [search, setSearch] = useState("");
  const [publishedOnly, setPublishedOnly] = useState(true);
  /**
   * The picker is opt-in, so the editor's initial load costs NOTHING extra.
   * Verified in the browser: without this the candidate search fired on every
   * editor page load, whether or not anyone intended to add a recommendation.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const listRef = useRef<HTMLUListElement | null>(null);

  const params = toCandidateQuery({ channel, search: debounced, publishedOnly });
  const candidates = useListEditorialPosts(params, {
    query: {
      queryKey: getListEditorialPostsQueryKey(params),
      // Its params differ from the Posts List page's, so the key differs and
      // this can never evict that page's cache.
      enabled: postId > 0 && (pickerOpen || debounced.trim().length > 0),
      staleTime: 30_000,
      // Keeps the previous page on screen between keystrokes instead of
      // flashing an empty list.
      placeholderData: (previous) => previous,
    },
  });

  /**
   * Labels for ids the operator has added in this session.
   *
   * The saved entries arrive pre-joined from the server; a NEWLY added target
   * has no entry yet, so its label is remembered from the picker row that
   * produced it. This is why there is never a per-target request: everything
   * needed is already in a payload the editor has.
   */
  const [sessionLabels, setSessionLabels] = useState<Record<number, TargetDisplay>>({});

  const savedById = useMemo(
    () => new Map(saved.map((entry) => [entry.targetPostId, entry])),
    [saved],
  );

  // Learn labels from whatever the picker happens to have loaded, so a chip
  // for a post that is on screen anyway reads correctly.
  const candidateItems = candidates.data?.items ?? [];
  useEffect(() => {
    if (candidateItems.length === 0) return;
    setSessionLabels((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of candidateItems) {
        if (next[item.post.id]) continue;
        next[item.post.id] = {
          label: pickTargetLabel(item.post.id, item.translations, languages),
          languageTag: null,
          annotation: targetStateAnnotation(item.translations),
        };
        changed = true;
      }
      return changed ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateItems, languages]);

  const display = (targetPostId: number): TargetDisplay => {
    const entry = savedById.get(targetPostId);
    if (entry) {
      return {
        label: recommendationLabel(entry),
        languageTag: recommendationLanguageTag(entry, openLanguageCode),
        /**
         * DELIBERATELY NULL — truthfulness fix, 2.1E pre-PR pass.
         *
         * `GET|PUT /posts/:id/recommendations` returns targetPostId, position,
         * targetTitle, targetSlug and targetLanguageCode. It carries NO status
         * for the target, and there is no backend field to add here.
         *
         * This used to read `sessionLabels[...].annotation`, which is learned
         * from whatever the candidate PICKER happened to have cached. That made
         * a saved row's displayed state a function of unrelated search activity
         * in the same session: search something else and the annotation stayed
         * absent; search the target itself and "(not published)" appeared;
         * toggle Published/Any and it could change again. A status that appears
         * and disappears depending on what you typed elsewhere is worse than no
         * status, so a SAVED row shows only what the recommendations response
         * itself vouches for. Candidate rows inside the picker still show real
         * state, because their own search response genuinely supplies it.
         */
        annotation: null,
      };
    }
    return sessionLabels[targetPostId] ?? { label: `Post #${targetPostId}`, languageTag: null, annotation: null };
  };

  const options = filterCandidates(candidateItems, { sourcePostId: postId, selected });
  const atCap = !canAddRecommendation(selected);

  const move = (index: number, direction: "up" | "down") => {
    const next = direction === "up"
      ? moveRecommendationUp(selected, index)
      : moveRecommendationDown(selected, index);
    if (next === selected) return;
    onChange(next);
    const moved = selected[index]!;
    setAnnouncement(moveAnnouncement(display(moved).label, next.indexOf(moved), next.length));
  };

  const remove = (targetPostId: number) => {
    const index = selected.indexOf(targetPostId);
    const next = removeRecommendation(selected, targetPostId);
    onChange(next);
    setAnnouncement(`${display(targetPostId).label} removed. ${next.length} recommended posts.`);
    // Focus moves to the next row's remove button, or to the search input when
    // the list empties — never to nothing, which is where TopicsCard leaves it.
    // setTimeout(0) rather than requestAnimationFrame: the callback has to run
    // AFTER React has committed the removal, otherwise it queries the
    // pre-removal list and focuses a node that is about to be detached.
    window.setTimeout(() => {
      const fallbackIndex = Math.min(index, next.length - 1);
      const target = next.length > 0
        ? listRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove-recommendation]")[fallbackIndex]
        : null;
      if (target) target.focus();
      else document.querySelector<HTMLInputElement>("[data-testid='input-recommendation-search']")?.focus();
    });
  };

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="recommendations-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{RECOMMENDATIONS_CARD_TITLE}</h3>
        {dirty && (
          <Badge variant="outline" className="text-[10px]" data-testid="recommendations-dirty">Unsaved</Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>
      <p className="text-[11px] text-muted-foreground" data-testid="recommendations-direction">
        {RECOMMENDATIONS_DIRECTION_EXPLANATION}
      </p>

      <p className="sr-only" role="status" aria-live="polite" data-testid="recommendations-announcer">
        {announcement}
      </p>

      {selected.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="recommendations-empty-state">
          {RECOMMENDATIONS_EMPTY_STATE}
        </p>
      ) : (
        <ul ref={listRef} className="space-y-1" data-testid="recommendation-rows">
          {selected.map((targetPostId, index) => {
            const info = display(targetPostId);
            return (
              <li
                key={targetPostId}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1"
                data-testid={`recommendation-row-${targetPostId}`}
              >
                <span className="text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-xs" dir="auto" title={info.label}>
                  {info.label}
                  {info.languageTag && (
                    <span className="ml-1 text-[10px] uppercase text-muted-foreground">[{info.languageTag}]</span>
                  )}
                  {info.annotation && (
                    <span className="ml-1 text-[10px] text-muted-foreground">({info.annotation})</span>
                  )}
                </span>
                {!disabled && (
                  <>
                    <button
                      type="button"
                      className="rounded p-0.5 disabled:opacity-40"
                      disabled={index === 0}
                      aria-label={`Move ${info.label} up`}
                      data-testid={`button-recommendation-up-${targetPostId}`}
                      onClick={() => move(index, "up")}
                    >
                      <ArrowUp className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 disabled:opacity-40"
                      disabled={index === selected.length - 1}
                      aria-label={`Move ${info.label} down`}
                      data-testid={`button-recommendation-down-${targetPostId}`}
                      onClick={() => move(index, "down")}
                    >
                      <ArrowDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5"
                      data-remove-recommendation=""
                      aria-label={`Remove recommended post ${info.label}`}
                      data-testid={`button-remove-recommendation-${targetPostId}`}
                      onClick={() => remove(targetPostId)}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="compact"
              variant={publishedOnly ? "default" : "outline"}
              aria-pressed={publishedOnly}
              data-testid="button-recommendation-filter-published"
              onClick={() => setPublishedOnly(true)}
            >
              Published
            </Button>
            <Button
              type="button"
              size="compact"
              variant={publishedOnly ? "outline" : "default"}
              aria-pressed={!publishedOnly}
              data-testid="button-recommendation-filter-any"
              onClick={() => setPublishedOnly(false)}
            >
              Any
            </Button>
          </div>
          {publishedOnly && (
            <p className="text-[11px] text-muted-foreground" data-testid="recommendations-published-note">
              {RECOMMENDATIONS_PUBLISHED_FILTER_NOTE}
            </p>
          )}

          <Input
            value={search}
            placeholder="Search posts…"
            aria-label="Search posts to recommend"
            data-testid="input-recommendation-search"
            onFocus={() => setPickerOpen(true)}
            onChange={(event) => setSearch(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground" data-testid="recommendations-channel-note">
            {RECOMMENDATIONS_CHANNEL_NOTE}
          </p>

          {atCap && (
            <p className="text-[11px] text-muted-foreground" data-testid="recommendations-cap-message">
              {RECOMMENDATIONS_CAP_MESSAGE}
            </p>
          )}

          <p className="sr-only" role="status" aria-live="polite" data-testid="recommendation-results-count">
            {candidates.isSuccess ? candidateCountLabel(options.length, candidates.data.total) : ""}
          </p>

          <div className="max-h-40 space-y-1 overflow-y-auto" data-testid="recommendation-candidates">
            {!pickerOpen && debounced.trim().length === 0 ? (
              <p className="text-[11px] text-muted-foreground" data-testid="recommendation-picker-closed">
                Search above to find a post to recommend.
              </p>
            ) : candidates.isError ? (
              <p className="text-[11px] text-destructive" role="alert">
                Posts could not be loaded.
              </p>
            ) : candidates.isLoading ? (
              <p className="text-[11px] text-muted-foreground">Searching…</p>
            ) : options.length === 0 ? (
              <p className="text-[11px] text-muted-foreground" data-testid="recommendation-no-matches">
                No more matching posts.
              </p>
            ) : (
              options.map((item) => {
                const label = pickTargetLabel(item.post.id, item.translations, languages);
                return (
                  <Button
                    key={item.post.id}
                    type="button"
                    size="compact"
                    variant="outline"
                    className="w-full justify-start gap-1"
                    disabled={atCap}
                    title={atCap ? RECOMMENDATIONS_CAP_MESSAGE : undefined}
                    data-testid={`button-add-recommendation-${item.post.id}`}
                    onClick={() => onChange(addRecommendation(selected, item.post.id))}
                  >
                    <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate" dir="auto">{label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {translationSummaryLabel(item.translations)}
                    </span>
                  </Button>
                );
              })
            )}
          </div>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          data-testid="recommendations-error-alert"
        >
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled || !dirty || saving}
        data-testid="button-save-recommendations"
        onClick={onSave}
      >
        {saving ? "Saving…" : RECOMMENDATIONS_SAVE_LABEL}
      </Button>
    </section>
  );
}
