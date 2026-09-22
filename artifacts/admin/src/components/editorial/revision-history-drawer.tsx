/**
 * Revision history drawer — Wave 2.1E.
 *
 * ─── WHY A DRAWER AND NOT A SUB-ROUTE ────────────────────────────────────
 *
 * `/editorial/posts/:id/:languageCode/revisions` would be a three-segment
 * tail, and `routeEntranceKey` only collapses a location when the tail is two
 * segments. The entrance wrapper's key would therefore change, React would
 * unmount and remount EditorialPostTranslationPage, and `form`, `baseline`,
 * `shared`, `topicIds`, `recommendations` and every dirty flag would be
 * destroyed — exactly the data-loss bug lib/route-entrance.ts exists to
 * prevent. A drawer changes no URL, touches no allowlist and never remounts
 * the editor, so opening history with unsaved work is safe by construction.
 *
 * ─── READ-ONLY UNTIL THE OPERATOR SAYS OTHERWISE ─────────────────────────
 *
 * Nothing in this component calls setForm, clears a dirty flag or writes
 * anything. Opening, browsing and comparing are pure reads. The only write is
 * the restore, and it is performed by the PAGE (which owns the form baseline
 * and the invalidation set) through the `onRestore` callback — this drawer
 * only asks for it and renders the outcome.
 *
 * ─── HONEST BASELINE ─────────────────────────────────────────────────────
 *
 * The "now" side of every comparison is the last SAVED server row, not the
 * operator's in-progress form. Diffing against the dirty form would report
 * their own typing as "changes since revision 41". When the translation scope
 * is dirty that choice is stated on screen rather than assumed.
 */
import { useEffect, useMemo, useState } from "react";
import {
  useGetEditorialPostRevision,
  useListEditorialPostRevisions,
  getGetEditorialPostRevisionQueryKey,
  getListEditorialPostRevisionsQueryKey,
  type EditorialPostTranslation,
  type EditorialRevisionSummary,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { NO_PUBLISH_PERMISSION_NOTICE } from "@/lib/editorial-posts";
import { editorialErrorMessage } from "@/lib/editorial-errors";
import {
  COMPARING_AGAINST_SAVED_NOTICE,
  RECORDED_NOT_RESTORED_CAPTION,
  REMOVED_ACTOR_EXPLANATION,
  REMOVED_ACTOR_LABEL,
  RESTORE_MEDIA_CAVEAT,
  REVISIONS_EMPTY_STATE,
  REVISIONS_NOT_AN_AUDIT_NOTE,
  SHARED_REVISION_NOT_RESTORABLE,
  boundRevisions,
  canRestoreRevisionHere,
  compareBodyBlocks,
  compareTranslationSnapshot,
  crossLanguageRestoreExplanation,
  crossLanguageRestoreLabel,
  crossLanguageRevisionExplanation,
  languageDisplayName,
  restoreImpactSummary,
  revisionSnapshotLanguageCode,
  summariseBodyComparison,
  toRevisionRowView,
} from "@/lib/editorial-revisions";
import { blockNoun, type StoredBlock } from "@/lib/editorial-post-body";
import { blockText } from "@/lib/editorial-revisions";
import { History } from "lucide-react";

/** Read-only snapshot value rendering — the same "—" placeholder the table uses. */
function snapshotText(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "—";
}

type ScopeFilter = "language" | "all";

export interface RevisionHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: number;
  channelLabel: string;
  languageCode: string;
  languageName: string;
  translationRow: EditorialPostTranslation;
  currentAdminId: number | null;
  canPublish: boolean;
  translationDirty: boolean;
  /** Reference data the editor already holds — no request of our own. */
  authors: ReadonlyArray<{ id: number; publicName: string }>;
  topics: ReadonlyArray<{ id: number; name: string }>;
  /**
   * The Languages reference list the editor already holds, used ONLY to turn a
   * revision's own `snapshot.languageCode` into a display name. Never a new
   * request, and never a source of truth for WHICH language a revision is.
   */
  languages: ReadonlyArray<{ code: string; name: string }>;
  /**
   * The editor's REAL language-switch function (the same one the Languages
   * switcher calls), so the cross-language CTA inherits the translation
   * dirty-state guard and the no-remount route behaviour for free. This
   * drawer must never call setLocation/navigate itself.
   */
  onSwitchLanguage: (languageCode: string) => void;
  /** Owned by the page: it re-baselines the form and invalidates the caches. */
  onRestore: (revision: {
    id: number;
    revisionNumber: number;
    createdAt: string;
    actorLabel: string;
    revisionByline: string | null;
    /** The REVISION's own language, from its snapshot — never the open editor's. */
    languageCode: string;
    languageName: string;
  }) => void;
  restorePending: boolean;
  /** The server's authoritative message, rendered persistently in here. */
  restoreError: string | null;
  /**
   * Reports the real history length once the query has run, so the trigger can
   * show a count WITHOUT an eager request on every page load (there is no
   * count endpoint and no `total` — the only way to learn N is this same
   * unpaginated GET).
   */
  onCountKnown: (count: number) => void;
}

export function RevisionHistoryDrawer(props: RevisionHistoryDrawerProps) {
  const [scope, setScope] = useState<ScopeFilter>("language");
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Changing the scope changes which rows exist, so a selection made in the
  // other scope is dropped rather than left pointing at a hidden row.
  useEffect(() => { setSelectedId(null); setShowAll(false); }, [scope]);

  const params = scope === "language" ? { languageCode: props.languageCode } : undefined;
  const revisions = useListEditorialPostRevisions(props.postId, params, {
    query: {
      queryKey: getListEditorialPostRevisionsQueryKey(props.postId, params),
      // GATED. Nothing is fetched until the operator asks for history, so the
      // editor's initial load is unchanged by this feature. The endpoint is
      // unpaginated, so this must never fire speculatively.
      enabled: props.open && props.postId > 0,
      staleTime: 0,
    },
  });

  const detail = useGetEditorialPostRevision(props.postId, selectedId ?? 0, {
    query: {
      queryKey: getGetEditorialPostRevisionQueryKey(props.postId, selectedId ?? 0),
      enabled: props.open && selectedId != null,
      // Revision rows are append-only and immutable by construction, so a
      // fetched snapshot can never change.
      staleTime: Infinity,
    },
  });

  const rows: EditorialRevisionSummary[] = revisions.data ?? [];
  const views = useMemo(
    () => rows.map((row) => toRevisionRowView(row, props.currentAdminId)),
    [rows, props.currentAdminId],
  );
  const bounded = boundRevisions(views, showAll);

  const loadedCount = revisions.data?.length ?? null;
  const { onCountKnown } = props;
  useEffect(() => {
    if (loadedCount != null) onCountKnown(loadedCount);
  }, [loadedCount, onCountKnown]);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl overflow-y-auto"
        data-testid="revision-history-drawer"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" aria-hidden="true" />
            Revision history
          </SheetTitle>
          <SheetDescription>
            {props.channelLabel} · post #{props.postId} · {props.languageName}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="revision-scope">Show</Label>
            <div className="flex flex-wrap gap-2" id="revision-scope" role="group" aria-label="Which changes to show">
              <Button
                type="button"
                size="compact"
                variant={scope === "language" ? "default" : "outline"}
                aria-pressed={scope === "language"}
                data-testid="button-revision-scope-language"
                onClick={() => setScope("language")}
              >
                This language
              </Button>
              <Button
                type="button"
                size="compact"
                variant={scope === "all" ? "default" : "outline"}
                aria-pressed={scope === "all"}
                data-testid="button-revision-scope-all"
                onClick={() => setScope("all")}
              >
                All changes to this post
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {scope === "language"
                ? `Only ${props.languageName} content changes. Shared changes to the whole post are listed under "All changes".`
                : "Every recorded change to this post, in one numbered timeline, in every language."}
            </p>
          </div>

          {props.translationDirty && (
            <p role="status" className="text-[11px] text-muted-foreground" data-testid="revision-dirty-baseline-notice">
              {COMPARING_AGAINST_SAVED_NOTICE}
            </p>
          )}

          {revisions.isError ? (
            <p role="alert" className="text-xs text-destructive" data-testid="revision-list-error">
              {editorialErrorMessage(revisions.error)}
            </p>
          ) : revisions.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading history…</p>
          ) : views.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="revision-empty-state">
              {REVISIONS_EMPTY_STATE}
            </p>
          ) : (
            <div className="space-y-2">
              <ul className="space-y-1" data-testid="revision-list">
                {bounded.rows.map((view) => {
                  const isSelected = view.id === selectedId;
                  return (
                    <li key={view.id}>
                      <button
                        type="button"
                        aria-expanded={isSelected}
                        aria-controls={`revision-panel-${view.id}`}
                        className={
                          isSelected
                            ? "w-full rounded-md border border-primary bg-muted/60 px-2 py-1.5 text-left"
                            : "w-full rounded-md border border-border px-2 py-1.5 text-left hover:bg-muted/40"
                        }
                        data-testid={`revision-row-${view.id}`}
                        onClick={() => setSelectedId(isSelected ? null : view.id)}
                      >
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-medium text-foreground">{view.eventLabel}</span>
                          <Badge variant="outline" className="text-[10px]">{view.scopeLabel}</Badge>
                          {view.languageCode && (
                            <span className="text-[10px] uppercase text-muted-foreground">{view.languageCode}</span>
                          )}
                          <span className="tabular-nums text-muted-foreground">#{view.revisionNumber}</span>
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          <span title={view.actorLabel === REMOVED_ACTOR_LABEL ? REMOVED_ACTOR_EXPLANATION : undefined}>
                            {view.actorLabel}
                          </span>
                          <time dateTime={view.timestamp} className="tabular-nums">{view.timestampLabel}</time>
                        </span>
                      </button>

                      {isSelected && (
                        <div
                          id={`revision-panel-${view.id}`}
                          className="mt-1 rounded-md border border-border bg-card p-3"
                          data-testid={`revision-panel-${view.id}`}
                        >
                          {detail.isLoading ? (
                            <p className="text-xs text-muted-foreground">Loading this version…</p>
                          ) : detail.isError ? (
                            <p role="alert" className="text-xs text-destructive" data-testid="revision-detail-error">
                              {editorialErrorMessage(detail.error)}
                            </p>
                          ) : detail.data && detail.data.id === view.id ? (
                            <RevisionDetailPanel
                              detail={detail.data}
                              view={view}
                              {...props}
                            />
                          ) : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {bounded.boundedNotice && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] text-muted-foreground" data-testid="revision-bounded-notice">
                    {bounded.boundedNotice}
                  </p>
                  <Button
                    type="button"
                    size="compact"
                    variant="outline"
                    data-testid="button-revision-show-all"
                    onClick={() => setShowAll(true)}
                  >
                    {bounded.showAllLabel}
                  </Button>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground" data-testid="revision-not-an-audit-note">
                {REVISIONS_NOT_AN_AUDIT_NOTE}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── The selected revision ───────────────────────────────────────────────────

function RevisionDetailPanel({
  detail,
  view,
  translationRow,
  languageCode,
  languageName,
  languages,
  canPublish,
  authors,
  topics,
  onSwitchLanguage,
  onRestore,
  restorePending,
  restoreError,
}: RevisionHistoryDrawerProps & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any;
}) {
  const snapshot = detail.snapshot;

  // ── Shared scope: displayed in full, NEVER restorable ───────────────────
  //
  // The disabled explanation is the backend's own 400 sentence, so the
  // operator reads the same reason whether the UI stops them or the server
  // would have. The snapshot holds ids, resolved against the reference lists
  // the editor already has, with an honest `#id` fallback for anything since
  // deleted — the Topics archived-chip precedent.
  if (snapshot.scope === "shared") {
    const authorName = snapshot.authorId == null
      ? "No author"
      : authors.find((row) => row.id === snapshot.authorId)?.publicName ?? `Author #${snapshot.authorId}`;
    return (
      <div className="space-y-2" data-testid="revision-shared-panel">
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Author</dt>
          <dd dir="auto">{authorName}</dd>
          <dt className="text-muted-foreground">Feature image</dt>
          <dd className="break-all">{snapshot.featureImageUrl ?? "—"}</dd>
          <dt className="text-muted-foreground">Topics</dt>
          <dd>
            {(snapshot.topics as number[]).length === 0
              ? "—"
              : (snapshot.topics as number[])
                  .map((id) => topics.find((topic) => topic.id === id)?.name ?? `Topic #${id}`)
                  .join(", ")}
          </dd>
        </dl>
        <p className="text-[11px] text-muted-foreground" data-testid="revision-shared-not-restorable">
          {SHARED_REVISION_NOT_RESTORABLE}
        </p>
      </div>
    );
  }

  // ── The revision's OWN language, read from its own snapshot ────────────
  //
  // NOT from the route, NOT from `translationRow`, NOT from the scope toggle.
  // "All changes to this post" deliberately lists every language's revisions,
  // so the selected one is frequently NOT the one open in the editor. Diffing
  // those two would compare two different documents — that is exactly the
  // fabricated diff, wrong-language confirmation and wedged-editor blocker
  // this branch exists to make unrepresentable.
  const revisionLanguageCode = revisionSnapshotLanguageCode(snapshot);
  const revisionLanguageName = languageDisplayName(revisionLanguageCode, languages);

  if (!canRestoreRevisionHere(revisionLanguageCode, languageCode)) {
    return (
      <div className="space-y-3" data-testid="revision-cross-language-panel">
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground">Language</dt>
          <dd data-testid="revision-cross-language-name">
            {revisionLanguageName}
            {revisionLanguageCode && (
              <span className="ml-1 uppercase text-muted-foreground">({revisionLanguageCode})</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Recorded</dt>
          <dd><time dateTime={view.timestamp} className="tabular-nums">{view.timestampLabel}</time></dd>
          <dt className="text-muted-foreground">By</dt>
          <dd>{view.actorLabel}</dd>
          <dt className="text-muted-foreground">Change</dt>
          <dd>{view.eventLabel}</dd>
        </dl>

        <p className="text-[11px] text-muted-foreground" data-testid="revision-cross-language-explanation">
          {crossLanguageRevisionExplanation(revisionLanguageName)}
        </p>

        {/* A read-only PREVIEW of what this revision itself holds — no "Now"
            column anywhere, because there is nothing comparable to put in it.
            Everything rendered here came with the detail response; no request
            is made for the other language's current translation. */}
        <dl
          className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]"
          data-testid="revision-cross-language-preview"
        >
          <dt className="text-muted-foreground">Title</dt>
          <dd className="break-words" dir="auto">{snapshotText(snapshot.title)}</dd>
          <dt className="text-muted-foreground">Deck</dt>
          <dd className="break-words" dir="auto">{snapshotText(snapshot.deck)}</dd>
          <dt className="text-muted-foreground">Context label</dt>
          <dd className="break-words" dir="auto">{snapshotText(snapshot.contextLabel)}</dd>
          <dt className="text-muted-foreground">Published byline</dt>
          <dd className="break-words" dir="auto">{snapshotText(snapshot.authorSnapshot?.name)}</dd>
        </dl>

        <div className="space-y-1" data-testid="revision-cross-language-body">
          <p className="text-[11px] font-medium text-muted-foreground">Body in this revision</p>
          {((snapshot.body?.blocks ?? []) as StoredBlock[]).length === 0 ? (
            <p className="text-[11px] text-muted-foreground">This revision has an empty body.</p>
          ) : (
            <ul className="space-y-1">
              {((snapshot.body?.blocks ?? []) as StoredBlock[]).map((block, index) => (
                <li key={index} className="rounded-md border border-border px-2 py-1">
                  <span className="text-[10px] uppercase text-muted-foreground">{blockNoun(block.type)}</span>
                  <p className="mt-0.5 break-words text-[11px]" dir="auto">{blockText(block)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── NO Restore control. The action is "go to the right editor". ── */}
        <div className="space-y-1.5 border-t border-border pt-2">
          <p className="text-[11px] text-muted-foreground" data-testid="revision-cross-language-restore-note">
            {crossLanguageRestoreExplanation(revisionLanguageName)}
          </p>
          {revisionLanguageCode && (
            <Button
              type="button"
              variant="outline"
              data-testid="button-open-revision-language"
              onClick={() => onSwitchLanguage(revisionLanguageCode)}
            >
              {crossLanguageRestoreLabel(revisionLanguageName)}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const fields = compareTranslationSnapshot(snapshot, translationRow);
  const restorable = fields.filter((field) => field.group === "restorable");
  const recorded = fields.filter((field) => field.group === "recorded");
  const blocks = compareBodyBlocks(
    (snapshot.body?.blocks ?? []) as never,
    (translationRow.body?.blocks ?? []) as never,
  );
  const changedCount = restorable.filter((field) => field.changed).length;

  return (
    <div className="space-y-3" data-testid="revision-translation-panel">
      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-muted-foreground">Recorded</dt>
        <dd><time dateTime={view.timestamp} className="tabular-nums">{view.timestampLabel}</time></dd>
        <dt className="text-muted-foreground">By</dt>
        <dd>{view.actorLabel}</dd>
        <dt className="text-muted-foreground">Change</dt>
        <dd>{view.eventLabel}</dd>
      </dl>

      <p className="text-[11px] text-muted-foreground" data-testid="revision-change-summary">
        {changedCount === 0
          ? "No field differs from the saved version."
          : `${changedCount} field${changedCount === 1 ? "" : "s"} differ from the saved version.`}
        {" "}{summariseBodyComparison(blocks)}
      </p>

      {/* Tier 1 — the fields a restore actually writes. A real table with
          header cells; empty values render "—" rather than a blank cell.
          Below `sm` every row STACKS (block cells, each value carrying its own
          visible label) rather than squeezing three columns into ~90px each or
          scrolling sideways — prose is unreadable either way. */}
      <table className="w-full sm:table-fixed text-[11px]" data-testid="revision-field-table">
        <thead className="hidden sm:table-header-group">
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="w-1/4 pb-1 font-medium">Field</th>
            <th scope="col" className="w-[37.5%] pb-1 font-medium">In this revision</th>
            <th scope="col" className="w-[37.5%] pb-1 font-medium">Now (saved)</th>
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {restorable.map((field) => (
            <tr
              key={field.key}
              className={`block border-b border-border/60 py-1 align-top sm:table-row sm:border-0 sm:py-0 ${field.changed ? "" : "text-muted-foreground"}`}
            >
              <th scope="row" className="block pr-2 text-left font-medium sm:table-cell sm:py-0.5 sm:font-normal">
                {field.label}
                {field.changed && <span className="ml-1 text-[10px] uppercase text-amber-600">changed</span>}
              </th>
              <td className="block break-words pr-2 sm:table-cell sm:py-0.5" dir="auto">
                <span className="mr-1 text-[10px] uppercase text-muted-foreground sm:hidden">In this revision</span>
                {field.was}
              </td>
              <td className="block break-words sm:table-cell sm:py-0.5" dir="auto">
                <span className="mr-1 text-[10px] uppercase text-muted-foreground sm:hidden">Now</span>
                {field.now}
              </td>
            </tr>
          ))}
        </tbody>
        {/* A SEPARATE tbody with its own caption row, not a colour: these
            three are recorded by the revision and are never written back. */}
        <tbody className="block sm:table-row-group" data-testid="revision-recorded-not-restored">
          <tr className="block sm:table-row">
            <td colSpan={3} className="block pt-2 text-[11px] text-muted-foreground sm:table-cell">
              {RECORDED_NOT_RESTORED_CAPTION}
            </td>
          </tr>
          {recorded.map((field) => (
            <tr key={field.key} className="block border-b border-border/60 py-1 align-top text-muted-foreground sm:table-row sm:border-0 sm:py-0">
              <th scope="row" className="block pr-2 text-left font-medium sm:table-cell sm:py-0.5 sm:font-normal">{field.label}</th>
              <td className="block break-words pr-2 sm:table-cell sm:py-0.5" dir="auto">
                <span className="mr-1 text-[10px] uppercase sm:hidden">In this revision</span>
                {field.was}
              </td>
              <td className="block break-words sm:table-cell sm:py-0.5" dir="auto">
                <span className="mr-1 text-[10px] uppercase sm:hidden">Now</span>
                {field.now}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Tier 2 — block-level structural comparison. Every entry carries a
          TEXT label as well as its styling, and added/removed text uses
          <ins>/<del> so assistive tech announces the semantics natively. */}
      <div className="space-y-1" data-testid="revision-body-comparison">
        <p className="text-[11px] font-medium text-muted-foreground">Body</p>
        {blocks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">This revision and the saved version both have an empty body.</p>
        ) : (
          <ul className="space-y-1">
            {blocks.map((block, index) => (
              <li
                key={`${block.kind}-${index}`}
                className="rounded-md border border-border px-2 py-1"
                data-testid={`revision-block-${block.kind}`}
              >
                <span className="flex flex-wrap items-center gap-2 text-[10px] uppercase text-muted-foreground">
                  <span>{block.label}</span>
                  <span>{block.noun}</span>
                </span>
                {block.kind === "modified" ? (
                  <div className="mt-0.5 space-y-0.5 text-[11px]">
                    <del className="block break-words text-muted-foreground" dir="auto">{block.wasText}</del>
                    <ins className="block break-words no-underline" dir="auto">{block.nowText}</ins>
                  </div>
                ) : block.kind === "removed" ? (
                  <del className="mt-0.5 block break-words text-[11px] text-muted-foreground" dir="auto">{block.wasText}</del>
                ) : block.kind === "added" ? (
                  <ins className="mt-0.5 block break-words text-[11px] no-underline" dir="auto">{block.nowText}</ins>
                ) : (
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground" dir="auto">{block.nowText}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Restore ─────────────────────────────────────────────────────── */}
      <div className="space-y-1.5 border-t border-border pt-2">
        <p className="text-[11px] text-muted-foreground" data-testid="revision-restore-impact">
          {restoreImpactSummary({ status: translationRow.status, languageName })}
        </p>
        <p className="text-[11px] text-muted-foreground" data-testid="revision-restore-media-caveat">
          {RESTORE_MEDIA_CAVEAT}
        </p>

        {restoreError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            data-testid="revision-restore-error"
          >
            {restoreError}
          </div>
        )}

        {canPublish ? (
          <Button
            type="button"
            variant={translationRow.status === "published" ? "destructive" : "outline"}
            disabled={restorePending}
            data-testid="button-restore-revision"
            onClick={() =>
              onRestore({
                id: detail.id,
                revisionNumber: detail.revisionNumber,
                createdAt: detail.createdAt,
                actorLabel: view.actorLabel,
                revisionByline: snapshot.authorSnapshot?.name ?? null,
                languageCode: revisionLanguageCode!,
                languageName: revisionLanguageName,
              })
            }
          >
            {restorePending
              ? "Restoring…"
              : translationRow.status === "published"
                ? "Restore published content"
                : "Restore this version"}
          </Button>
        ) : (
          <p className="text-[11px] text-muted-foreground" data-testid="revision-no-publish-permission">
            {NO_PUBLISH_PERMISSION_NOTICE}
          </p>
        )}
      </div>
    </div>
  );
}

/** The trigger, so the Publishing card imports one thing. */
export function RevisionHistoryTrigger({
  open,
  count,
  onOpen,
}: {
  open: boolean;
  count: number | null;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-1.5"
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="button-revision-history"
      onClick={onOpen}
    >
      <History className="h-4 w-4" aria-hidden="true" />
      {/* A count only appears once the query has actually run — an eager
          summary would fire the unpaginated request on every page load. */}
      {count == null ? "Revision history" : `Revision history (${count})`}
    </Button>
  );
}
