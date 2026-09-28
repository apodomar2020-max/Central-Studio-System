/**
 * Website → Editorial → Placements (/editorial/placements) —
 * Final Editorial, Phase A.
 *
 * Replaces the last Editorial placeholder, over the EXISTING backend. NO
 * BACKEND CHANGE WAS MADE for this screen: the routes, the service and the
 * table are exactly as Wave 1 / Wave 2.0 left them.
 *
 * ─── WHAT A SLOT IS ──────────────────────────────────────────────────────
 *
 *   GET /admin/editorial/placements?channel=&key=   website.posts:view
 *   PUT /admin/editorial/placements?key=            website.posts:edit
 *       body { channel, items[] } — REPLACE semantics
 *
 * A slot is (channel, key) TOGETHER, never key alone: `key` is free text and
 * "featured" is the obvious name in both channels, so the whole identity
 * surface is channel-scoped. This screen therefore always picks both before
 * it reads or writes anything, and it never lets a write reach a channel the
 * operator did not choose.
 *
 * `key` IS OPERATOR-DEFINED FREE TEXT — verified, not assumed. There is no
 * slot enum and no slot table; the schema's own comment says a new slot must
 * never need a migration. So the key field is a free-text input with
 * suggestions, not a Select over invented names.
 *
 * ─── SCOPED SAVE, ONE PUT ────────────────────────────────────────────────
 *
 * Add, remove and move are LOCAL array edits. Save sends exactly one PUT.
 * Every PUT deletes and reinserts the slot and writes an audit row, so a
 * mutation per click would write one audit row per click. Same rule as the
 * Recommended reading card, for the same reason.
 *
 * ─── ORDER IS THE PAYLOAD ────────────────────────────────────────────────
 *
 * `position` is a real persisted column and the service writes
 * `position: item.position ?? index`, so array order is authoritative and
 * the payload omits `position` entirely. Reordering is Move up / Move down:
 * no drag-and-drop, consistent with every other ordering UI in this codebase
 * (and the only form that is keyboard- and screen-reader-operable for free).
 *
 * ─── HONESTY ABOUT VISIBILITY ────────────────────────────────────────────
 *
 * There is NO public resolver for placements yet — Editorial is not wired to
 * the public website at all. The screen says so plainly and never implies
 * that placing a post publishes it. Drafts and archived posts ARE currently
 * accepted by the backend (`assertPlacementValid` checks existence and
 * channel, nothing about status); that behaviour is left untouched and the
 * state is instead made VISIBLE, the same way Topics shows an
 * archived-but-assigned tag. A SAVED row shows no invented status, because
 * the placements response genuinely carries none — the candidate rows do,
 * from their own search response, and only those show it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEditorialPlacement,
  useReplaceEditorialPlacement,
  useListEditorialPosts,
  getGetEditorialPlacementQueryKey,
  getListEditorialPostsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EditorialPageShell } from "@/components/editorial/editorial-page-shell";
import { WorkspaceRouteNav } from "@/components/admin/workspace-route-nav";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useToast } from "@/hooks/use-toast";
import { useEditorialReferenceData } from "@/hooks/use-editorial-reference-data";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import { translationSummaryLabel } from "@/lib/editorial-posts";
import {
  PLACEMENTS_CAP_MESSAGE,
  PLACEMENTS_CHANNEL_NOTE,
  PLACEMENTS_EMPTY_STATE,
  PLACEMENTS_LIFECYCLE_NOTE,
  PLACEMENTS_NOT_PUBLIC_YET_NOTE,
  PLACEMENTS_PAGE_DESCRIPTION,
  PLACEMENTS_SAVE_LABEL,
  PLACEMENT_CHANNELS,
  PLACEMENT_KEY_EXPLANATION,
  PLACEMENT_KEY_SUGGESTIONS,
  addPlacement,
  arePlacementsDirty,
  canAddPlacement,
  filterPlacementCandidates,
  movePlacementDown,
  movePlacementUp,
  normalizePlacementKey,
  pickPostLabel,
  placementCandidateCountLabel,
  placementLabel,
  placementMoveAnnouncement,
  postStateAnnotation,
  removePlacement,
  slotLabel,
  toPlacementCandidateQuery,
  toPlacementPayload,
  toPlacementPostIds,
  validatePlacementKey,
  type PlacementChannel,
} from "@/lib/editorial-placements";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import "../admin2-final.css";
import "../admin2-operations.css";

interface PostDisplay {
  label: string;
  annotation: string | null;
}

export default function EditorialPlacementsPage() {
  const { toast } = useToast();
  const { can } = useAdminAuth();
  const queryClient = useQueryClient();

  // The route guard is website.posts:view; editing needs website.posts:edit —
  // exactly what the two routes enforce. No new permission entry was added.
  const canEdit = can("website.posts", "edit");

  // ─── The slot being inspected ──────────────────────────────────────────
  const [channel, setChannel] = useState<PlacementChannel>("news");
  const [keyDraft, setKeyDraft] = useState("featured");
  /** The key actually loaded. Changing the draft does not refetch until Load. */
  const [loadedKey, setLoadedKey] = useState("featured");

  const keyProblem = validatePlacementKey(keyDraft);
  const slot = slotLabel(channel, loadedKey);

  const placement = useGetEditorialPlacement(
    { channel, key: loadedKey },
    {
      query: {
        queryKey: getGetEditorialPlacementQueryKey({ channel, key: loadedKey }),
        enabled: loadedKey.trim().length > 0,
      },
    },
  );
  const replacePlacement = useReplaceEditorialPlacement();

  const saved = useMemo(() => placement.data ?? [], [placement.data]);

  // ─── Local, unsaved list ───────────────────────────────────────────────
  const [selected, setSelected] = useState<number[]>([]);
  const [baseline, setBaseline] = useState<number[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);

  /** Adopt the server's answer for this slot. */
  useEffect(() => {
    if (!placement.isSuccess) return;
    const ids = toPlacementPostIds(saved);
    setSelected(ids);
    setBaseline(ids);
    setSaveError(null);
  }, [placement.isSuccess, saved]);

  const dirty = arePlacementsDirty(selected, baseline);
  const saving = replacePlacement.isPending;
  const atCap = !canAddPlacement(selected);

  // ─── Candidate picker (mirrors RecommendationsCard exactly) ────────────
  const [search, setSearch] = useState("");
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const debounced = useDebouncedValue(search, 250);

  const candidateParams = toPlacementCandidateQuery({ channel, search: debounced, publishedOnly });
  const candidates = useListEditorialPosts(candidateParams, {
    query: {
      queryKey: getListEditorialPostsQueryKey(candidateParams),
      // Opt-in, so simply opening the page costs no candidate search.
      enabled: pickerOpen || debounced.trim().length > 0,
      staleTime: 30_000,
      placeholderData: (previous) => previous,
    },
  });
  const candidateItems = useMemo(() => candidates.data?.items ?? [], [candidates.data]);

  // Only the languages list is needed, for the server's own label preference.
  const reference = useEditorialReferenceData();
  const languages = useMemo(() => reference.languages.data ?? [], [reference.languages.data]);

  /**
   * Labels for ids added in this session. A SAVED entry arrives pre-joined
   * from the placements response; a newly added one is remembered from the
   * picker row that produced it. No per-post request is ever made.
   */
  const [sessionLabels, setSessionLabels] = useState<Record<number, PostDisplay>>({});
  useEffect(() => {
    if (candidateItems.length === 0) return;
    setSessionLabels((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of candidateItems) {
        if (next[item.post.id]) continue;
        next[item.post.id] = {
          label: pickPostLabel(item.post.id, item.translations, languages),
          annotation: postStateAnnotation(item.translations),
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [candidateItems, languages]);

  const savedById = useMemo(() => new Map(saved.map((entry) => [entry.postId, entry])), [saved]);

  const display = (postId: number): PostDisplay => {
    const entry = savedById.get(postId);
    if (entry) {
      return {
        label: placementLabel(entry),
        /**
         * DELIBERATELY NULL for a SAVED row, exactly as RecommendationsCard
         * decided. EditorialPlacementEntry carries id, key, channel, postId,
         * position, startAt, endAt, postTitle and postLanguageCode — and NO
         * status. Reading a state out of whatever the candidate picker
         * happened to cache would make a saved row's displayed state a
         * function of unrelated search activity in the same session, which
         * is worse than no state at all.
         */
        annotation: null,
      };
    }
    return sessionLabels[postId] ?? { label: `Post #${postId}`, annotation: null };
  };

  const options = filterPlacementCandidates(candidateItems, selected);

  const move = (index: number, direction: "up" | "down") => {
    const next = direction === "up" ? movePlacementUp(selected, index) : movePlacementDown(selected, index);
    if (next === selected) return;
    const moved = selected[index]!;
    setSelected(next);
    setAnnouncement(placementMoveAnnouncement(display(moved).label, next.indexOf(moved), next.length));
  };

  const remove = (postId: number) => {
    const index = selected.indexOf(postId);
    const next = removePlacement(selected, postId);
    setSelected(next);
    setAnnouncement(`${display(postId).label} removed. ${next.length} posts in this slot.`);
    // setTimeout(0) rather than rAF: the callback must run AFTER React has
    // committed the removal, or it focuses a node about to be detached.
    window.setTimeout(() => {
      const fallbackIndex = Math.min(index, next.length - 1);
      const target = next.length > 0
        ? listRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove-placement]")[fallbackIndex]
        : null;
      if (target) target.focus();
      else document.querySelector<HTMLInputElement>("[data-testid='input-placement-search']")?.focus();
    });
  };

  const loadSlot = () => {
    if (keyProblem) return;
    setLoadedKey(normalizePlacementKey(keyDraft));
    setSaveError(null);
  };

  const save = () => {
    if (!canEdit || !dirty || saving) return;
    setSaveError(null);
    replacePlacement.mutate(
      {
        params: { key: loadedKey },
        data: toPlacementPayload(channel, selected),
      },
      {
        onSuccess: (rows) => {
          const ids = toPlacementPostIds(rows);
          setSelected(ids);
          setBaseline(ids);
          void queryClient.invalidateQueries({
            queryKey: getGetEditorialPlacementQueryKey({ channel, key: loadedKey }),
          });
          toast({ title: `Placement ${slot} saved` });
        },
        onError: (err) => {
          // Rendered verbatim — cross-channel and duplicate-post rejections
          // are the server's wording, and this screen never predicts them.
          setSaveError(editorialErrorMessage(err));
          toast({
            title: "Placement could not be saved",
            description: editorialErrorMessage(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <EditorialPageShell heading="Placements" description={PLACEMENTS_PAGE_DESCRIPTION}>
      <WorkspaceRouteNav
        ariaLabel="Editorial workspace"
        items={[
          ...(can("website.posts", "view") ? [{ label: "Posts", href: "/editorial/posts" }] : []),
          ...(can("website.posts", "view") ? [{ label: "Authors", href: "/editorial/authors" }] : []),
          ...(can("website.posts", "view") ? [{ label: "Topics", href: "/editorial/topics" }] : []),
          ...(can("website.posts", "view") ? [{ label: "Placements", href: "/editorial/placements" }] : []),
        ]}
      />
      <div className="space-y-6" data-testid="placements-page">
        <p
          role="status"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid="placements-not-public-note"
        >
          {PLACEMENTS_NOT_PUBLIC_YET_NOTE}
        </p>

        {/* ─── Slot selector ─────────────────────────────────────────── */}
        <section
          className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
          aria-label="Choose a slot"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="placement-channel">Channel</Label>
            <Select
              value={channel}
              onValueChange={(value) => setChannel(value as PlacementChannel)}
            >
              <SelectTrigger id="placement-channel" data-testid="select-placement-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLACEMENT_CHANNELS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="placement-key">Slot key</Label>
            <Input
              id="placement-key"
              value={keyDraft}
              list="placement-key-suggestions"
              autoComplete="off"
              aria-invalid={Boolean(keyProblem) || undefined}
              aria-describedby="placement-key-help"
              data-testid="input-placement-key"
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  loadSlot();
                }
              }}
            />
            {/* Suggestions, not a fixed set: `key` is free text server-side. */}
            <datalist id="placement-key-suggestions">
              {PLACEMENT_KEY_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            <p
              id="placement-key-help"
              className={keyProblem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              data-testid="placement-key-message"
            >
              {keyProblem ?? PLACEMENT_KEY_EXPLANATION}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={Boolean(keyProblem)}
            data-testid="button-load-placement"
            onClick={loadSlot}
          >
            Load slot
          </Button>
        </section>

        {/* ─── The slot's contents ───────────────────────────────────── */}
        <section className="space-y-3 rounded-md border border-border bg-card p-3" aria-label={`Slot ${slot}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground" data-testid="placement-slot-label">
              {slot}
            </h3>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="tabular-nums" data-testid="placement-count">
                {selected.length} placed
              </Badge>
              {dirty && (
                <Badge variant="outline" className="text-[10px]" data-testid="placements-dirty">Unsaved</Badge>
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground" data-testid="placements-lifecycle-note">
            {PLACEMENTS_LIFECYCLE_NOTE}
          </p>

          <p className="sr-only" role="status" aria-live="polite" data-testid="placements-announcer">
            {announcement}
          </p>

          {placement.isLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="placements-loading">
              Loading this slot…
            </p>
          ) : placement.isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="placements-load-error"
            >
              This slot could not be loaded.
            </div>
          ) : selected.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="placements-empty-state">
              {PLACEMENTS_EMPTY_STATE}
            </p>
          ) : (
            <ul ref={listRef} className="space-y-1" data-testid="placement-rows">
              {selected.map((postId, index) => {
                const info = display(postId);
                return (
                  <li
                    key={postId}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1"
                    data-testid={`placement-row-${postId}`}
                  >
                    <span className="text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-xs" dir="auto" title={info.label}>
                      {info.label}
                      {info.annotation && (
                        <span className="ml-1 text-[10px] text-muted-foreground">({info.annotation})</span>
                      )}
                    </span>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          className="rounded p-0.5 disabled:opacity-40"
                          disabled={index === 0}
                          aria-label={`Move ${info.label} up`}
                          data-testid={`button-placement-up-${postId}`}
                          onClick={() => move(index, "up")}
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5 disabled:opacity-40"
                          disabled={index === selected.length - 1}
                          aria-label={`Move ${info.label} down`}
                          data-testid={`button-placement-down-${postId}`}
                          onClick={() => move(index, "down")}
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5"
                          data-remove-placement=""
                          aria-label={`Remove ${info.label} from this slot`}
                          data-testid={`button-remove-placement-${postId}`}
                          onClick={() => remove(postId)}
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

          {canEdit && !placement.isError && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="compact"
                  variant={publishedOnly ? "default" : "outline"}
                  aria-pressed={publishedOnly}
                  data-testid="button-placement-filter-published"
                  onClick={() => setPublishedOnly(true)}
                >
                  Published
                </Button>
                <Button
                  type="button"
                  size="compact"
                  variant={publishedOnly ? "outline" : "default"}
                  aria-pressed={!publishedOnly}
                  data-testid="button-placement-filter-any"
                  onClick={() => setPublishedOnly(false)}
                >
                  Any
                </Button>
              </div>

              <Input
                value={search}
                placeholder="Search posts…"
                aria-label="Search posts to place in this slot"
                data-testid="input-placement-search"
                onFocus={() => setPickerOpen(true)}
                onChange={(event) => setSearch(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground" data-testid="placements-channel-note">
                {PLACEMENTS_CHANNEL_NOTE}
              </p>

              {atCap && (
                <p className="text-[11px] text-muted-foreground" data-testid="placements-cap-message">
                  {PLACEMENTS_CAP_MESSAGE}
                </p>
              )}

              <p className="sr-only" role="status" aria-live="polite" data-testid="placement-results-count">
                {candidates.isSuccess ? placementCandidateCountLabel(options.length, candidates.data.total) : ""}
              </p>

              <div className="max-h-48 space-y-1 overflow-y-auto" data-testid="placement-candidates">
                {!pickerOpen && debounced.trim().length === 0 ? (
                  <p className="text-[11px] text-muted-foreground" data-testid="placement-picker-closed">
                    Search above to find a post to place.
                  </p>
                ) : candidates.isError ? (
                  <p className="text-[11px] text-destructive" role="alert">Posts could not be loaded.</p>
                ) : candidates.isLoading ? (
                  <p className="text-[11px] text-muted-foreground">Searching…</p>
                ) : options.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground" data-testid="placement-no-matches">
                    No more matching posts.
                  </p>
                ) : (
                  options.map((item) => {
                    const label = pickPostLabel(item.post.id, item.translations, languages);
                    // Real state, from THIS row's own search response.
                    const state = postStateAnnotation(item.translations);
                    return (
                      <Button
                        key={item.post.id}
                        type="button"
                        size="compact"
                        variant="outline"
                        className="w-full justify-start gap-1"
                        disabled={atCap}
                        title={atCap ? PLACEMENTS_CAP_MESSAGE : undefined}
                        data-testid={`button-add-placement-${item.post.id}`}
                        onClick={() => setSelected(addPlacement(selected, item.post.id))}
                      >
                        <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate" dir="auto">{label}</span>
                        {state && (
                          <span
                            className="shrink-0 text-[10px] text-muted-foreground"
                            data-testid={`placement-candidate-state-${item.post.id}`}
                          >
                            ({state})
                          </span>
                        )}
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

          {saveError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
              data-testid="placements-error-alert"
            >
              {saveError}
            </div>
          )}

          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!dirty || saving || placement.isError}
              data-testid="button-save-placement"
              onClick={save}
            >
              {saving ? "Saving…" : PLACEMENTS_SAVE_LABEL}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="placements-read-only">
              You have view access to Editorial posts but cannot change placements. Editing needs the Edit
              permission on Website Editorial Posts.
            </p>
          )}
        </section>
      </div>
    </EditorialPageShell>
  );
}
