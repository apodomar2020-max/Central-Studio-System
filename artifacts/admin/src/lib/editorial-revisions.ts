/**
 * editorial-revisions — the PURE half of the Post Editor's revision history
 * and restore (Wave 2.1E).
 *
 * Everything a reviewer needs pinned lives here rather than in the drawer
 * component, for the reason every other Admin module gives: a file that
 * imports React cannot be loaded by `node --test --experimental-strip-types`
 * and can only be source-inspected. Actor wording, event labels, the bounded
 * history view, the restorable-vs-recorded field split, the body comparison
 * and every sentence of the restore confirmation are executed for real in
 * editorialRevisions.test.ts.
 *
 * ─── WHAT A REVISION IS, AND IS NOT ──────────────────────────────────────
 *
 * Re-derived from the backend, not assumed:
 *
 *  - Revisions are written for PUBLISHED content only, plus restores. A draft
 *    edit, a publish and a restore-to-draft write NOTHING. Revision history
 *    is therefore NOT a complete record of what happened to a post — the
 *    Activity Log is. The empty state says so.
 *  - `shared_field_change` is written by a feature-image change, a topics
 *    change AND a recommendations change, and its snapshot holds only
 *    { authorId, featureImageUrl, topics }. It cannot be attributed to any
 *    one of them, so its label is deliberately non-specific and the
 *    recommendations are never claimed to be recoverable from it.
 *  - Restore writes CONTENT only. `slug`, `status` and `publishedAt` are in
 *    the snapshot but are never written back, so they are presented in a
 *    separate "recorded, not restored" group and never as something the
 *    operator is about to change.
 *
 * ─── ACTOR (D1) ──────────────────────────────────────────────────────────
 *
 * A revision row stores `created_by_admin_id` and nothing else — no name, no
 * email. The only admin directory endpoint is gated on `adminUsers:view`, a
 * different permission module, and returns emails and super-admin flags for
 * every administrator. This module therefore resolves "You" from the session
 * the editor already holds and names everyone else by id. It never fabricates
 * a name and nothing here can cause a privileged lookup.
 */
import { formatDateTime } from "./editorial-posts.ts";
import { blockNoun, type EditorialBlockType, type StoredBlock } from "./editorial-post-body.ts";
import type {
  EditorialAuthorSnapshot,
  EditorialPostTranslation,
  EditorialRevisionEventType,
  EditorialRevisionSummary,
  EditorialTranslationRevisionSnapshot,
} from "@workspace/api-client-react";

// ─── Event labels ────────────────────────────────────────────────────────────

/**
 * The complete, real event set — six values, enumerated from the generated
 * `EditorialRevisionEventType` const, not guessed. There is no separate
 * "reason" field anywhere in the contract; `eventType` is the only classifier.
 */
export const REVISION_EVENT_LABELS: Record<EditorialRevisionEventType, string> = {
  published_edit: "Content edited",
  restore: "Restored from an earlier version",
  translation_status_change: "Taken out of publication",
  author_change: "Author changed",
  topics_change: "Topics changed",
  // NON-SPECIFIC ON PURPOSE. The same event type is written by a feature
  // image change, a topics replace and a recommendations replace, and the
  // snapshot cannot tell them apart. Naming one of them would be a guess.
  shared_field_change: "Shared settings changed",
};

export function revisionEventLabel(eventType: EditorialRevisionEventType): string {
  return REVISION_EVENT_LABELS[eventType] ?? "Changed";
}

// ─── Scope ───────────────────────────────────────────────────────────────────

export type RevisionScope = "translation" | "shared";

/**
 * `translation_id IS NULL` is the database's own definition of a shared row
 * (a CHECK constraint keeps event type and scope in agreement), so this reads
 * the same column the backend's own scope gate reads.
 */
export function revisionScope(row: { translationId: number | null }): RevisionScope {
  return row.translationId == null ? "shared" : "translation";
}

export function isRestorableRevision(row: { translationId: number | null }): boolean {
  return revisionScope(row) === "translation";
}

/**
 * Byte-identical to the 400 the restore endpoint returns for a shared-scope
 * revision (editorialPostsService.restoreTranslationRevision). Pinned as a
 * literal the same way SLUG_LOCKED_EXPLANATION pins the server's 409 wording,
 * so the disabled explanation and the error the operator would otherwise have
 * hit are the same sentence.
 */
export const SHARED_REVISION_NOT_RESTORABLE =
  "That revision records a shared post change (author, topics, or feature image), not one language's content, so there is no translation to restore.";

/** The shorter in-list version, for the row badge's helper line. */
export const SHARED_REVISION_SUMMARY =
  "This revision records a shared post change and cannot be restored into one language.";

export const REVISIONS_EMPTY_STATE =
  "No revision history yet. Revisions are recorded when published content is edited, when a published language is taken out of publication, and when a version is restored — editing a draft records nothing.";

export const REVISIONS_NOT_AN_AUDIT_NOTE =
  "Revision history records content, not every action. The Activity Log is the full record of who did what.";

export const COMPARING_AGAINST_SAVED_NOTICE =
  "Comparing against the last saved version. You have unsaved changes in this language that are not shown here.";

// ─── Actor (D1) ──────────────────────────────────────────────────────────────

export const REMOVED_ACTOR_LABEL = "System / account removed";

export const REMOVED_ACTOR_EXPLANATION =
  "The administrator account that made this change has since been deleted. The history was deliberately kept.";

/**
 * "You" / "Administrator #14" / "System / account removed".
 *
 * Never an email, never a username, never a role or super-admin flag: none of
 * those are available without `adminUsers:view`, which is a different
 * permission module from `website.posts` and returns the whole admin
 * directory. An editor reading history must not need it, and must not leak it.
 */
export function describeRevisionActor(
  createdByAdminId: number | null | undefined,
  currentAdminId: number | null | undefined,
): string {
  if (createdByAdminId == null) return REMOVED_ACTOR_LABEL;
  if (currentAdminId != null && createdByAdminId === currentAdminId) return "You";
  return `Administrator #${createdByAdminId}`;
}

// ─── Bounded history (D2) ────────────────────────────────────────────────────

/**
 * The endpoint is unpaginated and returns the COMPLETE, server-sorted,
 * newest-first array with no `total`. So the client genuinely holds every row,
 * correctly ordered — bounding the RENDER is truthful, and is not client-side
 * paging over a partial dataset. The copy says exactly that, and the real
 * total is the array's own length rather than an estimate.
 */
export const REVISION_RENDER_LIMIT = 20;

export interface BoundedRevisions<T> {
  rows: T[];
  total: number;
  hidden: number;
  /** Null when everything is on screen — no affordance, no sentence. */
  boundedNotice: string | null;
  showAllLabel: string | null;
}

export function boundRevisions<T>(
  rows: readonly T[],
  showAll: boolean,
  limit: number = REVISION_RENDER_LIMIT,
): BoundedRevisions<T> {
  const total = rows.length;
  if (showAll || total <= limit) {
    return { rows: [...rows], total, hidden: 0, boundedNotice: null, showAllLabel: null };
  }
  return {
    rows: rows.slice(0, limit),
    total,
    hidden: total - limit,
    boundedNotice: `Showing the ${limit} most recent of ${total}.`,
    showAllLabel: `Show all (${total})`,
  };
}

// ─── Row metadata ────────────────────────────────────────────────────────────

export interface RevisionRowView {
  id: number;
  revisionNumber: number;
  scope: RevisionScope;
  scopeLabel: string;
  eventLabel: string;
  actorLabel: string;
  timestampLabel: string;
  /** The machine-readable value for <time dateTime>. */
  timestamp: string;
  languageCode: string | null;
  canRestore: boolean;
}

export function toRevisionRowView(
  row: EditorialRevisionSummary,
  currentAdminId: number | null | undefined,
): RevisionRowView {
  const scope = revisionScope(row);
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    scope,
    scopeLabel: scope === "shared" ? "Shared" : "This language",
    eventLabel: revisionEventLabel(row.eventType),
    actorLabel: describeRevisionActor(row.createdByAdminId, currentAdminId),
    timestampLabel: formatDateTime(row.createdAt),
    timestamp: row.createdAt,
    languageCode: row.languageCode ?? null,
    canRestore: scope === "translation",
  };
}

// ─── Field comparison (tier 1) ───────────────────────────────────────────────

export type FieldGroup = "restorable" | "recorded";

export interface FieldComparison {
  key: string;
  label: string;
  group: FieldGroup;
  /** The value held by the revision. */
  was: string;
  /** The value on the last SAVED server row. */
  now: string;
  changed: boolean;
}

export const EMPTY_VALUE_PLACEHOLDER = "—";

function text(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : EMPTY_VALUE_PLACEHOLDER;
}

function numberText(value: number | null | undefined): string {
  return value == null ? EMPTY_VALUE_PLACEHOLDER : String(value);
}

function bylineText(snapshot: EditorialAuthorSnapshot | null | undefined): string {
  const name = snapshot?.name?.trim();
  return name && name.length > 0 ? name : EMPTY_VALUE_PLACEHOLDER;
}

/**
 * The fields restore ACTUALLY writes, in editor order, plus the three the
 * snapshot records but restore never writes.
 *
 * `slug`, `status` and `publishedAt` are in the snapshot and are genuinely
 * useful context — the operator wants to know the revision came from when the
 * post was still a draft — but presenting them next to the restorable fields
 * would claim the restore changes a live URL or a lifecycle state. It does
 * not. They are a separate group with their own caption, never a colour.
 *
 * `bodyVersion` is machinery and is never shown. The body itself gets the
 * structural comparison below rather than a "was/now" cell.
 */
export function compareTranslationSnapshot(
  snapshot: EditorialTranslationRevisionSnapshot,
  current: Pick<
    EditorialPostTranslation,
    | "title" | "slug" | "deck" | "contextLabel" | "featureImageAlt" | "authorSnapshot"
    | "listingImageUrl"
    | "readingTimeOverrideMinutes" | "seoTitle" | "seoDescription" | "ogImageUrl"
    | "status" | "publishedAt"
  >,
): FieldComparison[] {
  const rows: Array<Omit<FieldComparison, "changed">> = [
    { key: "title", label: "Title", group: "restorable", was: text(snapshot.title), now: text(current.title) },
    { key: "deck", label: "Deck", group: "restorable", was: text(snapshot.deck), now: text(current.deck) },
    { key: "contextLabel", label: "Context label", group: "restorable", was: text(snapshot.contextLabel), now: text(current.contextLabel) },
    { key: "featureImageAlt", label: "Feature image alt text", group: "restorable", was: text(snapshot.featureImageAlt), now: text(current.featureImageAlt) },
    { key: "listingImageUrl", label: "Listing image link", group: "restorable", was: text(snapshot.listingImageUrl), now: text(current.listingImageUrl) },
    { key: "authorSnapshot", label: "Published byline", group: "restorable", was: bylineText(snapshot.authorSnapshot), now: bylineText(current.authorSnapshot) },
    { key: "readingTimeOverrideMinutes", label: "Reading time override", group: "restorable", was: numberText(snapshot.readingTimeOverrideMinutes), now: numberText(current.readingTimeOverrideMinutes) },
    { key: "seoTitle", label: "Search title", group: "restorable", was: text(snapshot.seoTitle), now: text(current.seoTitle) },
    { key: "seoDescription", label: "Search description", group: "restorable", was: text(snapshot.seoDescription), now: text(current.seoDescription) },
    { key: "ogImageUrl", label: "Sharing image link", group: "restorable", was: text(snapshot.ogImageUrl), now: text(current.ogImageUrl) },
    { key: "slug", label: "Address", group: "recorded", was: text(snapshot.slug), now: text(current.slug) },
    { key: "status", label: "State", group: "recorded", was: text(snapshot.status), now: text(current.status) },
    { key: "publishedAt", label: "First published", group: "recorded", was: formatDateTime(snapshot.publishedAt), now: formatDateTime(current.publishedAt) },
  ];
  return rows.map((row) => ({ ...row, changed: row.was !== row.now }));
}

export const RECORDED_NOT_RESTORED_CAPTION =
  "Recorded in this revision but NOT restored — the address, the state and the publication date are never changed by a restore.";

/** The keys restore writes. Nothing outside this set may be offered as restorable. */
export const RESTORABLE_FIELD_KEYS: readonly string[] = [
  "title", "deck", "contextLabel", "featureImageAlt", "listingImageUrl", "authorSnapshot",
  "readingTimeOverrideMinutes", "seoTitle", "seoDescription", "ogImageUrl",
];

export function changedFields(comparisons: readonly FieldComparison[]): FieldComparison[] {
  return comparisons.filter((row) => row.changed);
}

// ─── Body structural comparison (tier 2, D8) ─────────────────────────────────

export type BlockChangeKind = "unchanged" | "added" | "removed" | "moved" | "modified";

export interface BlockComparison {
  kind: BlockChangeKind;
  /** Human label, never colour alone. */
  label: string;
  noun: string;
  type: EditorialBlockType;
  /** Text as the REVISION holds it (absent for a block added since). */
  wasText: string | null;
  /** Text on the last SAVED row (absent for a block removed since). */
  nowText: string | null;
  wasIndex: number | null;
  nowIndex: number | null;
}

export const BLOCK_CHANGE_LABELS: Record<BlockChangeKind, string> = {
  unchanged: "Unchanged",
  added: "Added since",
  removed: "Removed since",
  moved: "Moved",
  modified: "Changed",
};

/**
 * The text payload of a block, flattened for comparison and display.
 * Deliberately includes every authored string — an image whose alt changed but
 * whose url did not IS a change, and an editor needs to see it.
 */
export function blockText(block: StoredBlock): string {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "heading":
      return block.text;
    case "image":
      return [block.url, block.alt, block.caption ?? ""].filter((part) => part.length > 0).join(" · ");
    case "bulleted-list":
      return block.items.join(" · ");
    case "quote":
      // Every authored string, same rule as the image case: a quote whose
      // attribution changed but whose text did not IS a change. Without
      // this case the `default` branch returned "" for every quote, which
      // made two DIFFERENT quotes compare as identical and hid quote edits
      // from the revision comparison entirely.
      return [block.text, block.attribution ?? "", block.attributionRole ?? ""]
        .filter((part) => part.length > 0)
        .join(" · ");
    default:
      return "";
  }
}

function blockSignature(block: StoredBlock): string {
  const level = block.type === "heading" ? String(block.level) : "";
  return `${block.type} ${level} ${blockText(block)}`;
}

interface Gap {
  from: Array<{ index: number; block: StoredBlock }>;
  to: Array<{ index: number; block: StoredBlock }>;
}

/**
 * Plain LCS over a normalized block signature.
 *
 * Blocks carry NO persisted identity — `EditableBlock.key` is minted at load
 * time and never stored — so correspondence has to be inferred. LCS over
 * ≤250 items is 250×250 comparisons: synchronous, sub-millisecond, and it
 * needs no dependency (the Admin has no diff library and this wave adds none).
 *
 * Anchors found by LCS are `unchanged`. What falls between two anchors is then
 * resolved in three passes, cheapest first:
 *   1. a signature present on BOTH sides of the alignment is a `moved` block,
 *      not an add plus a remove — that distinction is the whole reason an
 *      editor trusts the comparison after a reorder;
 *   2. within one gap, a same-type leftover on each side is a `modified`
 *      block, and both texts are shown stacked rather than word-diffed;
 *   3. whatever remains really is an `added` or a `removed` block.
 *
 * Direction: `from` is the REVISION, `to` is the last SAVED row, so the labels
 * describe what happened SINCE the revision. Restoring reverses them.
 */
export function compareBodyBlocks(
  from: readonly StoredBlock[],
  to: readonly StoredBlock[],
): BlockComparison[] {
  const fromSigs = from.map(blockSignature);
  const toSigs = to.map(blockSignature);

  // LCS table.
  const n = from.length;
  const m = to.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = fromSigs[i] === toSigs[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  // Walk the alignment, collecting anchors and the gaps between them.
  const anchors: Array<{ fromIndex: number; toIndex: number }> = [];
  const gaps: Gap[] = [];
  let gap: Gap = { from: [], to: [] };
  let i = 0;
  let j = 0;
  const flushGap = () => { gaps.push(gap); gap = { from: [], to: [] }; };
  while (i < n && j < m) {
    if (fromSigs[i] === toSigs[j]) {
      flushGap();
      anchors.push({ fromIndex: i, toIndex: j });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      gap.from.push({ index: i, block: from[i]! });
      i += 1;
    } else {
      gap.to.push({ index: j, block: to[j]! });
      j += 1;
    }
  }
  while (i < n) { gap.from.push({ index: i, block: from[i]! }); i += 1; }
  while (j < m) { gap.to.push({ index: j, block: to[j]! }); j += 1; }
  flushGap();

  const entries: BlockComparison[] = [];
  const claimedFrom = new Set<number>();
  const claimedTo = new Set<number>();

  // Pass 1 — moves, detected across the WHOLE body: the same signature left
  // one place and appeared in another.
  const movePairs: Array<{ fromIndex: number; toIndex: number; block: StoredBlock }> = [];
  const pendingTo = gaps.flatMap((entry) => entry.to);
  for (const removed of gaps.flatMap((entry) => entry.from)) {
    const sig = blockSignature(removed.block);
    const match = pendingTo.find(
      (candidate) => !claimedTo.has(candidate.index) && blockSignature(candidate.block) === sig,
    );
    if (!match) continue;
    claimedFrom.add(removed.index);
    claimedTo.add(match.index);
    movePairs.push({ fromIndex: removed.index, toIndex: match.index, block: removed.block });
  }

  // Pass 2 — same-type leftovers inside ONE gap are one block that was edited,
  // not a deletion plus an unrelated insertion.
  const modifiedPairs: Array<{ from: { index: number; block: StoredBlock }; to: { index: number; block: StoredBlock } }> = [];
  for (const entry of gaps) {
    const removals = entry.from.filter((row) => !claimedFrom.has(row.index));
    const additions = entry.to.filter((row) => !claimedTo.has(row.index));
    for (const removal of removals) {
      const match = additions.find(
        (candidate) => !claimedTo.has(candidate.index) && candidate.block.type === removal.block.type,
      );
      if (!match) continue;
      claimedFrom.add(removal.index);
      claimedTo.add(match.index);
      modifiedPairs.push({ from: removal, to: match });
    }
  }

  // Emit in the order of the CURRENT body, so the comparison reads like the
  // article does now, with removals shown where they used to sit.
  const anchorByTo = new Map(anchors.map((anchor) => [anchor.toIndex, anchor]));
  const moveByTo = new Map(movePairs.map((pair) => [pair.toIndex, pair]));
  const modifiedByTo = new Map(modifiedPairs.map((pair) => [pair.to.index, pair]));
  const removalByFrom = new Map(
    gaps.flatMap((entry) => entry.from)
      .filter((row) => !claimedFrom.has(row.index))
      .map((row) => [row.index, row] as const),
  );

  const emitRemovalsBefore = (fromBoundary: number, cursor: { value: number }) => {
    while (cursor.value < fromBoundary) {
      const removal = removalByFrom.get(cursor.value);
      if (removal) {
        entries.push({
          kind: "removed",
          label: BLOCK_CHANGE_LABELS.removed,
          noun: blockNoun(removal.block.type),
          type: removal.block.type,
          wasText: blockText(removal.block),
          nowText: null,
          wasIndex: removal.index,
          nowIndex: null,
        });
      }
      cursor.value += 1;
    }
  };

  const cursor = { value: 0 };
  for (let index = 0; index < m; index += 1) {
    const anchor = anchorByTo.get(index);
    const move = moveByTo.get(index);
    const modified = modifiedByTo.get(index);
    const block = to[index]!;
    if (anchor) {
      emitRemovalsBefore(anchor.fromIndex, cursor);
      cursor.value = anchor.fromIndex + 1;
      entries.push({
        kind: "unchanged",
        label: BLOCK_CHANGE_LABELS.unchanged,
        noun: blockNoun(block.type),
        type: block.type,
        wasText: blockText(block),
        nowText: blockText(block),
        wasIndex: anchor.fromIndex,
        nowIndex: index,
      });
    } else if (move) {
      entries.push({
        kind: "moved",
        label: BLOCK_CHANGE_LABELS.moved,
        noun: blockNoun(block.type),
        type: block.type,
        wasText: blockText(move.block),
        nowText: blockText(block),
        wasIndex: move.fromIndex,
        nowIndex: index,
      });
    } else if (modified) {
      emitRemovalsBefore(modified.from.index, cursor);
      cursor.value = modified.from.index + 1;
      entries.push({
        kind: "modified",
        label: BLOCK_CHANGE_LABELS.modified,
        noun: blockNoun(block.type),
        type: block.type,
        wasText: blockText(modified.from.block),
        nowText: blockText(block),
        wasIndex: modified.from.index,
        nowIndex: index,
      });
    } else {
      entries.push({
        kind: "added",
        label: BLOCK_CHANGE_LABELS.added,
        noun: blockNoun(block.type),
        type: block.type,
        wasText: null,
        nowText: blockText(block),
        wasIndex: null,
        nowIndex: index,
      });
    }
  }
  emitRemovalsBefore(n, cursor);

  return entries;
}

export function bodyChanged(entries: readonly BlockComparison[]): boolean {
  return entries.some((entry) => entry.kind !== "unchanged");
}

export function summariseBodyComparison(entries: readonly BlockComparison[]): string {
  const counts = entries.reduce<Record<BlockChangeKind, number>>(
    (acc, entry) => { acc[entry.kind] += 1; return acc; },
    { unchanged: 0, added: 0, removed: 0, moved: 0, modified: 0 },
  );
  const parts = (["added", "removed", "moved", "modified"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${counts[kind]} ${BLOCK_CHANGE_LABELS[kind].toLowerCase()}`);
  if (parts.length === 0) return "The body is identical to this revision.";
  return `Body: ${parts.join(", ")}.`;
}

// ─── Restore confirmation (D4, D8, §12) ──────────────────────────────────────

export interface RestoreConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

export interface RestoreConfirmationContext {
  languageName: string;
  revisionNumber: number;
  createdAt: string;
  actorLabel: string;
  status: "draft" | "published" | "archived";
  /** The byline the revision would write back. */
  revisionByline: string | null;
  /** The byline currently frozen on this translation. */
  currentByline: string | null;
  /** True when the TRANSLATION scope has unsaved edits. */
  translationDirty: boolean;
}

/**
 * Built entirely from verified backend behaviour; every clause is traceable.
 *
 * States, because they are true: restore writes the live row and never touches
 * `status`, so a published translation stays published with the older content
 * the instant it commits; it is scoped to the snapshot's own language and
 * cannot reach a sibling; the pre-restore state is snapshotted first, so it is
 * undoable; and the address, the state and the publication date do not change.
 *
 * Does NOT state, because they are not true: that the lifecycle is rolled back,
 * that the URL changes, that other languages are affected, that anything is
 * deleted, that the public website changes (it does not — Editorial is still
 * in coexistence mode, and the page shell's banner is the ONE place that fact
 * is stated), or that restored images were re-tested the way a normal media
 * edit re-tests them (see RESTORE_MEDIA_CAVEAT).
 *
 * `languageName` MUST be the REVISION's own language, resolved from its
 * snapshot — never the open editor's language read off page state.
 */
export function restoreConfirmation(context: RestoreConfirmationContext): RestoreConfirmation {
  const when = formatDateTime(context.createdAt);
  const sentences: string[] = [];

  if (context.status === "published") {
    sentences.push(
      `This ${context.languageName} translation is Published right now. Restoring replaces its current Published content with revision #${context.revisionNumber} immediately — it stays published, with the older content.`,
    );
  } else if (context.status === "archived") {
    sentences.push(
      `This ${context.languageName} translation is archived, so nothing is published until it is restored to draft and published again. Revision #${context.revisionNumber} replaces its saved content.`,
    );
  } else {
    sentences.push(
      `Revision #${context.revisionNumber} replaces the saved ${context.languageName} content. This translation is a draft, so no published content changes.`,
    );
  }

  sentences.push(`The revision was recorded ${when} by ${context.actorLabel}.`);
  sentences.push("Only this language is affected — every other language keeps what it has.");
  sentences.push("The address, the state and the publication date are not changed.");

  // Conditional, never boilerplate — the same gate authorReassignmentConfirmation
  // uses. A byline warning that appears every time stops being read.
  const bylineDiffers = (context.revisionByline ?? null) !== (context.currentByline ?? null);
  if (bylineDiffers) {
    const was = context.revisionByline ?? "no byline";
    sentences.push(
      `The published byline in ${context.languageName} goes back to ${was}. Other languages keep their own byline, and the post's Author setting is not changed.`,
    );
  }

  if (context.translationDirty) {
    sentences.push(
      "You also have unsaved changes in this language. They are not saved anywhere and restoring discards them. Shared settings, topics and recommended posts are unaffected.",
    );
  }

  sentences.push("The current version is recorded first, so this can be undone from history.");

  return {
    title: context.translationDirty
      ? "Restore and discard your unsaved changes?"
      : context.status === "published"
        ? `Restore the Published ${context.languageName} content?`
        : `Restore this ${context.languageName} version?`,
    description: sentences.join(" "),
    // "Restore" alone would collide with the archived -> draft "Restore to
    // draft" button already in the Publishing card. Two different operations
    // must never share a label.
    confirmLabel: context.translationDirty
      ? "Discard and restore"
      : context.status === "published"
        ? "Restore published content"
        : "Restore this version",
    destructive: context.status === "published" || context.translationDirty,
  };
}

/**
 * The short, non-modal summary rendered next to the restore button, so the
 * consequence is legible before the dialog appears.
 */
export function restoreImpactSummary(context: {
  status: "draft" | "published" | "archived";
  languageName: string;
}): string {
  switch (context.status) {
    case "published":
      return `Restoring changes this Published ${context.languageName} translation immediately. It stays published; the address, the state and the publication date do not change.`;
    case "archived":
      return `This ${context.languageName} translation is archived, so restoring changes its saved content without changing any published content.`;
    case "draft":
      return `This ${context.languageName} translation is a draft, so restoring changes its saved content without changing any published content.`;
  }
}

/**
 * Honest, non-alarming, and free of implementation jargon.
 *
 * Corrected in the 2.1E pre-PR pass. The earlier sentence said images are
 * "not re-checked", which is too broad: restoring a PUBLISHED translation
 * goes through the same publish-readiness assertion a publish does, and that
 * assertion includes the static image rules. What a restore does NOT do is
 * the fuller link testing a normal image edit performs. Both halves are said,
 * neither is overclaimed, and no backend behaviour was changed to make the
 * sentence true.
 */
export const RESTORE_MEDIA_CAVEAT =
  "Images in an older version come back exactly as they were. Published content still has to pass the same image checks as a normal publish, but a restore does not re-test the links the way editing an image does — so a link that has stopped working since can come back as it was.";

// ─── Language safety (2.1E pre-PR blocker) ───────────────────────────────────
//
// THE BUG THIS SECTION EXISTS TO MAKE UNREPRESENTABLE
//
// "All changes to this post" legitimately lists translation revisions from
// EVERY language. The detail panel used to diff whatever was selected against
// the OPEN translation row, regardless of the snapshot's own language. For an
// Arabic revision opened from the English editor that produced:
//
//   * a fabricated field/body comparison between two different documents;
//   * a confirmation and a toast naming English for an Arabic restore;
//   * and — the release blocker — a re-baseline from the restored ARABIC row,
//     which set `formRowId` to the Arabic row's id while `translationRow.id`
//     stayed English, permanently failing the editor's
//     `formRowId !== translationRow.id` render guard and wedging the page on
//     "Loading…" with the operator's unsaved English edits gone.
//
// The backend was never wrong: it resolves the target purely from
// `revision.snapshot.languageId` and never from client input. Everything below
// is Admin-side context discipline: a revision's language is ALWAYS read from
// the revision's own data (`snapshot.languageCode` on the detail, `languageCode`
// on the list row — both are in the generated contract), never from the route,
// the open translation, or the drawer's scope toggle.

/** A translation snapshot always carries BOTH `languageId` and `languageCode`. */
export interface TranslationSnapshotLanguageLike {
  scope: "translation" | "shared";
  languageCode?: string | null;
}

/**
 * The revision's OWN language code, or null for a shared-scope revision (which
 * belongs to no single language and must never be offered a language CTA).
 */
export function revisionSnapshotLanguageCode(
  snapshot: TranslationSnapshotLanguageLike | null | undefined,
): string | null {
  if (!snapshot || snapshot.scope !== "translation") return null;
  const code = snapshot.languageCode ?? null;
  return code && code.trim().length > 0 ? code : null;
}

export interface LanguageNameLike {
  code: string;
  name: string;
}

/**
 * The registered display name for a code, from reference data the editor
 * ALREADY holds. Falls back to the raw code — never a request of its own, and
 * never a blank.
 */
export function languageDisplayName(
  code: string | null | undefined,
  languages: readonly LanguageNameLike[],
): string {
  if (!code) return "another language";
  const name = languages.find((language) => language.code === code)?.name;
  return name && name.trim().length > 0 ? name : code;
}

export type RevisionLanguageRelation = "same" | "other" | "not-language-scoped";

export function revisionLanguageRelation(
  revisionLanguageCode: string | null,
  openLanguageCode: string,
): RevisionLanguageRelation {
  if (revisionLanguageCode == null) return "not-language-scoped";
  return revisionLanguageCode === openLanguageCode ? "same" : "other";
}

/**
 * THE eligibility rule. A translation revision is restorable only from the
 * editor that is open on its own language. Shared revisions are never
 * restorable (unchanged 2.1E behaviour).
 */
export function canRestoreRevisionHere(
  revisionLanguageCode: string | null,
  openLanguageCode: string,
): boolean {
  return revisionLanguageRelation(revisionLanguageCode, openLanguageCode) === "same";
}

/**
 * Shown INSTEAD of a comparison for a cross-language revision.
 *
 * The comparison is omitted rather than faked: the revision and the open
 * translation are two different documents, so "In this revision / Now" has no
 * meaning across them. The revision's own snapshot is previewed instead, which
 * needs no extra request — the detail GET already carries it.
 */
export function crossLanguageRevisionExplanation(revisionLanguageName: string): string {
  return `This revision belongs to the ${revisionLanguageName} translation, which is not the one open here. Its content is shown as it was recorded, not compared against the open translation — they are different documents.`;
}

/** The action shown where Restore would otherwise be. Never "Restore <open language>". */
export function crossLanguageRestoreLabel(revisionLanguageName: string): string {
  return `Open ${revisionLanguageName} translation to restore this revision`;
}

export function crossLanguageRestoreExplanation(revisionLanguageName: string): string {
  return `Restoring writes the ${revisionLanguageName} translation, so it has to be done from the ${revisionLanguageName} editor. Opening it here does not restore anything — nothing is saved, and unsaved work in the open language is handled by the usual language-switch prompt.`;
}

/**
 * The fail-closed message. Defensive: after the UI gating above this is
 * unreachable, and it exists so a future regression surfaces as a visible
 * refusal rather than as a silent wrong-language write.
 */
export const RESTORE_LANGUAGE_MISMATCH_ERROR =
  "This revision belongs to a different language than the one open here, so it was not restored. Open that language's translation and restore it from there.";

/**
 * The last line of defence, applied to the restore mutation's OWN response.
 *
 * The response is a full translation row carrying `postId`, `languageCode` and
 * its row `id` (verified against RestoreEditorialPostRevisionResponse in the
 * generated contract). If any of the three disagrees with the translation the
 * editor has open, the form is NOT re-baselined: adopting it is precisely what
 * wedged the editor on "Loading…".
 */
export function restoredRowMatchesOpenTranslation(
  restored: { id: number; postId: number; languageCode: string },
  open: { id: number; postId: number; languageCode: string },
): boolean {
  return (
    restored.postId === open.postId &&
    restored.languageCode === open.languageCode &&
    restored.id === open.id
  );
}

export const RESTORE_RESPONSE_MISMATCH_ERROR =
  "The restore came back for a different translation than the one open here, so nothing on this screen was changed. Reload the post before trying again.";
