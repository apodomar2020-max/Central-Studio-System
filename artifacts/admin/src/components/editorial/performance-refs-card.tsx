/**
 * Related Performance card — a News article's ordered pointers to
 * Performances (GET/PUT /admin/editorial/posts/:id/performance-refs).
 *
 * Two exports, one presentation:
 *  - `PerformanceRefsCard` — controlled. In pending mode (Add News, no post
 *    yet) it is pure local state that the create orchestration applies with
 *    the new id; it renders no Save button.
 *  - `PerformanceRefsEditCard` — the Edit page's persisted card. It owns its
 *    own read, dirty scope, error slot and Save button: one PUT per explicit
 *    save, never one per click, exactly like Topics / Recommended reading.
 *
 * The Performance list is gated by website.performance:view on the server.
 * A News editor without it must not trigger a 403, so the list query is only
 * enabled when `can()` allows it; otherwise (or on any load error) the
 * picker shows an unobtrusive "not available for your role" line. Saved refs
 * still render from the refs response itself, which carries title/slug.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminWebsitePerformances,
  getListAdminWebsitePerformancesQueryKey,
  useListEditorialPostPerformanceRefs,
  useReplaceEditorialPostPerformanceRefs,
  getListEditorialPostPerformanceRefsQueryKey,
  type EditorialPerformanceRef,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import { SHARED_ACROSS_LANGUAGES_LABEL } from "@/lib/editorial-posts";
import {
  PERFORMANCE_REFS_CAP_MESSAGE,
  PERFORMANCE_REFS_CARD_TITLE,
  PERFORMANCE_REFS_EMPTY_STATE,
  PERFORMANCE_REFS_EXPLANATION,
  PERFORMANCE_REFS_SAVE_LABEL,
  PERFORMANCE_REFS_UNAVAILABLE,
  addPerformanceRef,
  arePerformanceRefsDirty,
  canAddPerformanceRef,
  performanceCandidates,
  removePerformanceRef,
  toPerformanceRefsPayload,
} from "@/lib/editorial-performance-refs";
import { Plus, X } from "lucide-react";

export function PerformanceRefsCard({
  selected,
  saved = [],
  dirty = false,
  saving = false,
  disabled,
  error = null,
  onChange,
  onSave,
}: {
  selected: number[];
  /** Server rows (Edit page) — used only to label already-saved refs. */
  saved?: ReadonlyArray<EditorialPerformanceRef>;
  dirty?: boolean;
  saving?: boolean;
  disabled?: boolean;
  error?: string | null;
  onChange: (next: number[]) => void;
  /** Omitted in pending mode: nothing to save to yet. */
  onSave?: () => void;
}) {
  const { can } = useAdminAuth();
  const canList = can("website.performance", "view");
  const [search, setSearch] = useState("");
  const performances = useListAdminWebsitePerformances({
    query: {
      queryKey: getListAdminWebsitePerformancesQueryKey(),
      enabled: canList && !disabled,
      staleTime: 60_000,
      retry: false,
    },
  });

  const labels = useMemo(() => {
    const map = new Map<number, { title: string; inactive: boolean }>();
    for (const ref of saved) map.set(ref.performanceId, { title: ref.performanceTitle, inactive: !ref.performanceIsActive });
    for (const performance of performances.data ?? []) {
      map.set(performance.id, { title: performance.title, inactive: !performance.isActive });
    }
    return map;
  }, [saved, performances.data]);

  const options = performanceCandidates(performances.data ?? [], selected, search);
  const atCap = !canAddPerformanceRef(selected);
  const unavailable = !canList || performances.isError;

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3" data-testid="performance-refs-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{PERFORMANCE_REFS_CARD_TITLE}</h3>
        {dirty && (
          <Badge variant="outline" className="text-[10px]" data-testid="performance-refs-dirty">Unsaved</Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{SHARED_ACROSS_LANGUAGES_LABEL}</p>
      <p className="text-[11px] text-muted-foreground">{PERFORMANCE_REFS_EXPLANATION}</p>

      {selected.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="performance-refs-empty-state">
          {PERFORMANCE_REFS_EMPTY_STATE}
        </p>
      ) : (
        <ul className="space-y-1" data-testid="performance-ref-rows">
          {selected.map((id, index) => {
            const info = labels.get(id);
            const title = info?.title ?? `Performance #${id}`;
            return (
              <li
                key={id}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1"
                data-testid={`performance-ref-row-${id}`}
              >
                <span className="text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-xs" dir="auto" title={title}>
                  {title}
                  {info?.inactive && <span className="ml-1 text-[10px] text-muted-foreground">(inactive)</span>}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    className="rounded p-0.5"
                    aria-label={`Remove related Performance ${title}`}
                    data-testid={`button-remove-performance-ref-${id}`}
                    onClick={() => onChange(removePerformanceRef(selected, id))}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && (
        unavailable ? (
          <p className="text-[11px] text-muted-foreground" data-testid="performance-refs-unavailable">
            {PERFORMANCE_REFS_UNAVAILABLE}
          </p>
        ) : (
          <>
            <Input
              value={search}
              placeholder="Search Performances…"
              aria-label="Search Performances to relate"
              data-testid="input-performance-ref-search"
              onChange={(event) => setSearch(event.target.value)}
            />
            {atCap && (
              <p className="text-[11px] text-muted-foreground" data-testid="performance-refs-cap-message">
                {PERFORMANCE_REFS_CAP_MESSAGE}
              </p>
            )}
            <div className="max-h-40 space-y-1 overflow-y-auto" data-testid="performance-ref-candidates">
              {performances.isLoading ? (
                <p className="text-[11px] text-muted-foreground">Loading…</p>
              ) : options.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No more matching Performances.</p>
              ) : (
                options.map((performance) => (
                  <Button
                    key={performance.id}
                    type="button"
                    size="compact"
                    variant="outline"
                    className="w-full justify-start gap-1"
                    disabled={atCap}
                    data-testid={`button-add-performance-ref-${performance.id}`}
                    onClick={() => onChange(addPerformanceRef(selected, performance.id))}
                  >
                    <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate" dir="auto">{performance.title}</span>
                  </Button>
                ))
              )}
            </div>
          </>
        )
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          data-testid="performance-refs-error-alert"
        >
          {error}
        </div>
      )}

      {onSave && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={disabled || !dirty || saving}
          data-testid="button-save-performance-refs"
          onClick={onSave}
        >
          {saving ? "Saving…" : PERFORMANCE_REFS_SAVE_LABEL}
        </Button>
      )}
    </section>
  );
}

/** Edit page: persisted, self-contained scoped save. */
export function PerformanceRefsEditCard({ postId, disabled }: { postId: number; disabled?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refs = useListEditorialPostPerformanceRefs(postId, {
    query: { queryKey: getListEditorialPostPerformanceRefsQueryKey(postId), enabled: postId > 0 },
  });
  const replace = useReplaceEditorialPostPerformanceRefs();
  const [baseline, setBaseline] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!refs.data) return;
    const ids = refs.data.map((ref) => ref.performanceId);
    setBaseline(ids);
    setSelected(ids);
  }, [refs.data]);

  const dirty = arePerformanceRefsDirty(selected, baseline);

  const save = () => {
    setError(null);
    replace.mutate(
      { id: postId, data: toPerformanceRefsPayload(selected) },
      {
        onSuccess: (rows) => {
          queryClient.setQueryData(getListEditorialPostPerformanceRefsQueryKey(postId), rows);
          toast({ title: "Related Performance saved" });
        },
        onError: (err: unknown) => setError(editorialErrorMessage(err)),
      },
    );
  };

  if (refs.isError) {
    return (
      <section className="rounded-md border border-border bg-card p-3 space-y-1" data-testid="performance-refs-card">
        <h3 className="text-sm font-semibold text-foreground">{PERFORMANCE_REFS_CARD_TITLE}</h3>
        <p className="text-[11px] text-destructive" role="alert">Related Performance could not be loaded.</p>
      </section>
    );
  }

  return (
    <PerformanceRefsCard
      selected={selected}
      saved={refs.data ?? []}
      dirty={dirty}
      saving={replace.isPending}
      disabled={disabled || refs.isLoading}
      error={error}
      onChange={setSelected}
      onSave={save}
    />
  );
}
