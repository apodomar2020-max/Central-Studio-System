/**
 * Wave 2.1E — revision history, comparison and the restore confirmation.
 *
 * Executed for real under `node --test --experimental-strip-types`. The drawer
 * that renders all of this imports React and is source-inspected separately in
 * pages/editorial/editorialRevisionsPanel.test.ts; everything a reviewer needs
 * to trust — the actor wording, the six event labels, the bounded view, which
 * fields restore actually writes, the block comparison and every clause of the
 * confirmation — is exercised here rather than asserted as a string match.
 *
 * Several assertions are pinned against the API server's own source so the
 * Admin's copy cannot drift from the behaviour it describes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { StoredBlock } from "./editorial-post-body.ts";
import {
  BLOCK_CHANGE_LABELS,
  COMPARING_AGAINST_SAVED_NOTICE,
  EMPTY_VALUE_PLACEHOLDER,
  RECORDED_NOT_RESTORED_CAPTION,
  REMOVED_ACTOR_LABEL,
  RESTORABLE_FIELD_KEYS,
  RESTORE_LANGUAGE_MISMATCH_ERROR,
  RESTORE_MEDIA_CAVEAT,
  RESTORE_RESPONSE_MISMATCH_ERROR,
  REVISION_EVENT_LABELS,
  REVISION_RENDER_LIMIT,
  REVISIONS_EMPTY_STATE,
  SHARED_REVISION_NOT_RESTORABLE,
  blockText,
  boundRevisions,
  canRestoreRevisionHere,
  crossLanguageRestoreExplanation,
  crossLanguageRestoreLabel,
  crossLanguageRevisionExplanation,
  languageDisplayName,
  restoredRowMatchesOpenTranslation,
  revisionLanguageRelation,
  revisionSnapshotLanguageCode,
  changedFields,
  compareBodyBlocks,
  compareTranslationSnapshot,
  describeRevisionActor,
  isRestorableRevision,
  restoreConfirmation,
  restoreImpactSummary,
  revisionEventLabel,
  revisionScope,
  summariseBodyComparison,
  toRevisionRowView,
} from "./editorial-revisions.ts";

const service = readFileSync(
  new URL("../../../api-server/src/lib/editorialPostsService.ts", import.meta.url),
  "utf8",
);
const generated = readFileSync(
  new URL("../../../../lib/api-client-react/src/generated/api.schemas.ts", import.meta.url),
  "utf8",
);

// ─── Fixtures ────────────────────────────────────────────────────────────────

function paragraph(text: string): StoredBlock {
  return { type: "paragraph", text };
}
function heading(text: string, level: 2 | 3 = 2): StoredBlock {
  return { type: "heading", level, text };
}
function image(url: string, alt: string, caption?: string): StoredBlock {
  return caption === undefined ? { type: "image", url, alt } : { type: "image", url, alt, caption };
}
function list(...items: string[]): StoredBlock {
  return { type: "bulleted-list", items };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snapshot(overrides: Record<string, unknown> = {}): any {
  return {
    scope: "translation",
    languageId: 1,
    languageCode: "en",
    title: "Original title",
    slug: "original-title",
    deck: "Original deck",
    contextLabel: null,
    body: { blocks: [paragraph("One"), paragraph("Two")] },
    bodyVersion: 1,
    featureImageAlt: "Alt as it was",
    authorSnapshot: { name: "Old Author", role: "Staff", avatarUrl: null, biography: "Bio" },
    readingTimeOverrideMinutes: null,
    seoTitle: null,
    seoDescription: null,
    ogImageUrl: null,
    status: "published",
    publishedAt: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function current(overrides: Record<string, unknown> = {}): any {
  return {
    title: "Current title",
    slug: "original-title",
    deck: "Original deck",
    contextLabel: null,
    featureImageAlt: "Alt as it was",
    authorSnapshot: { name: "Old Author", role: "Staff", avatarUrl: null, biography: "Bio" },
    readingTimeOverrideMinutes: null,
    seoTitle: null,
    seoDescription: null,
    ogImageUrl: null,
    status: "published",
    publishedAt: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summaryRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: 5,
    postId: 7,
    translationId: 11,
    languageCode: "en",
    revisionNumber: 3,
    eventType: "published_edit",
    createdAt: "2030-02-02T10:00:00.000Z",
    createdByAdminId: 14,
    ...overrides,
  };
}

// ─── Event labels ────────────────────────────────────────────────────────────

test("every event type the contract defines has a label — and no label is invented for one that does not exist", () => {
  // The generated const is the single source of truth for the event set.
  const block = generated.slice(
    generated.indexOf("export const EditorialRevisionEventType = {"),
  ).split("} as const;")[0]!;
  const real = [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]!);
  assert.deepEqual(
    real.sort(),
    Object.keys(REVISION_EVENT_LABELS).sort(),
    "the label map must cover exactly the contract's event types",
  );
  for (const eventType of real) {
    assert.ok(revisionEventLabel(eventType as never).length > 0);
  }
});

test("shared_field_change is labelled NON-specifically — it cannot be attributed to one cause", () => {
  const label = REVISION_EVENT_LABELS.shared_field_change;
  assert.equal(label, "Shared settings changed");
  // The same event type is written by a feature-image change, a topics replace
  // and a recommendations replace, and the snapshot holds none of them.
  assert.doesNotMatch(label, /feature image/i);
  assert.doesNotMatch(label, /recommend/i);
  assert.doesNotMatch(label, /topic/i);
});

test("translation_status_change is named for what actually writes it — archiving published content", () => {
  // Verified in the service: the only caller is archiveTranslation, and only
  // from `published`.
  assert.match(service, /recordTranslationRevisionIfPublished\([\s\S]{0,200}translation_status_change/);
  assert.equal(REVISION_EVENT_LABELS.translation_status_change, "Taken out of publication");
});

// ─── Scope ───────────────────────────────────────────────────────────────────

test("a null translationId is a SHARED revision and is never restorable", () => {
  assert.equal(revisionScope({ translationId: null }), "shared");
  assert.equal(isRestorableRevision({ translationId: null }), false);
  assert.equal(revisionScope({ translationId: 11 }), "translation");
  assert.equal(isRestorableRevision({ translationId: 11 }), true);
});

test("the shared-scope explanation is BYTE-IDENTICAL to the backend's own 400", () => {
  assert.ok(
    service.includes(SHARED_REVISION_NOT_RESTORABLE),
    "the disabled explanation must be the sentence the server would have returned",
  );
});

test("a row view carries its scope badge, actor and event label without any lookup", () => {
  const view = toRevisionRowView(summaryRow(), 14);
  assert.equal(view.scope, "translation");
  assert.equal(view.scopeLabel, "This language");
  assert.equal(view.actorLabel, "You");
  assert.equal(view.eventLabel, "Content edited");
  assert.equal(view.canRestore, true);
  assert.equal(view.timestamp, "2030-02-02T10:00:00.000Z", "the machine-readable value is preserved for <time>");

  const shared = toRevisionRowView(summaryRow({ translationId: null, languageCode: null, eventType: "topics_change" }), 14);
  assert.equal(shared.scopeLabel, "Shared");
  assert.equal(shared.canRestore, false);
  assert.equal(shared.languageCode, null);
});

// ─── Actor (D1) ──────────────────────────────────────────────────────────────

test("the actor is You, Administrator #id, or the removed-account phrase — and NEVER a name or email", () => {
  assert.equal(describeRevisionActor(14, 14), "You");
  assert.equal(describeRevisionActor(3, 14), "Administrator #3");
  assert.equal(describeRevisionActor(null, 14), REMOVED_ACTOR_LABEL);
  // An unknown session still must not fabricate "You".
  assert.equal(describeRevisionActor(14, null), "Administrator #14");
  assert.equal(describeRevisionActor(14, undefined), "Administrator #14");

  for (const label of [
    describeRevisionActor(14, 14),
    describeRevisionActor(3, 14),
    describeRevisionActor(null, 14),
  ]) {
    assert.doesNotMatch(label, /@/, "an email address must never appear");
    assert.doesNotMatch(label, /super/i);
  }
});

test("the module performs no privileged directory lookup of any kind", () => {
  // Comments are stripped first: the header DISCUSSES why the directory is
  // off limits, and that explanation must not be mistaken for a call to it.
  const code = readFileSync(new URL("./editorial-revisions.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /adminUsers/);
  assert.doesNotMatch(code, /admin\/users/);
  assert.doesNotMatch(code, /useListAdminUsers|fullName|username|email/);
});

// ─── Bounded history (D2) ────────────────────────────────────────────────────

test("20 of 47 are rendered, the order is the server's, and the count is REAL", () => {
  const rows = Array.from({ length: 47 }, (_, index) => ({ n: 47 - index }));
  const bounded = boundRevisions(rows, false);
  assert.equal(bounded.rows.length, REVISION_RENDER_LIMIT);
  assert.equal(bounded.total, 47);
  assert.equal(bounded.hidden, 27);
  assert.equal(bounded.rows[0]!.n, 47, "newest first, untouched");
  assert.equal(bounded.rows[19]!.n, 28);
  assert.equal(bounded.boundedNotice, "Showing the 20 most recent of 47.");
  assert.equal(bounded.showAllLabel, "Show all (47)");
});

test("Show all renders everything, and a short history gets no affordance and no sentence", () => {
  const rows = Array.from({ length: 47 }, (_, index) => ({ n: index }));
  const all = boundRevisions(rows, true);
  assert.equal(all.rows.length, 47);
  assert.equal(all.boundedNotice, null);
  assert.equal(all.showAllLabel, null);

  const short = boundRevisions(Array.from({ length: 12 }, (_, i) => ({ n: i })), false);
  assert.equal(short.rows.length, 12);
  assert.equal(short.total, 12);
  assert.equal(short.hidden, 0);
  assert.equal(short.boundedNotice, null, "nothing is hidden, so nothing is claimed");
  assert.equal(short.showAllLabel, null);

  const exact = boundRevisions(Array.from({ length: 20 }, (_, i) => ({ n: i })), false);
  assert.equal(exact.boundedNotice, null, "exactly the limit is not a bounded view");
});

test("the empty state explains why an untouched post has no history rather than implying a failure", () => {
  assert.match(REVISIONS_EMPTY_STATE, /editing a draft records nothing/);
});

// ─── Field comparison ────────────────────────────────────────────────────────

test("the restorable set is EXACTLY the columns restoreTranslationRevision writes", () => {
  const body = service.slice(service.indexOf("export async function restoreTranslationRevision"));
  const setBlock = body.slice(body.indexOf(".set({"), body.indexOf(".where(eq(editorialPostTranslationsTable.id, translation.id))"));
  // Matches a key written FROM ITS OWN snapshot key, however it is read.
  // Phase B widened this from a literal `key: snapshot.key` prefix: the
  // gallery is restored as `gallery: readStoredGallery(snapshot.gallery)`,
  // because a pre-0129 snapshot physically cannot carry the key and absent
  // has to be read as the empty gallery the column then held. Back-
  // referencing the key name keeps the check STRICTER than a bare
  // "mentions snapshot" — a field restored from the wrong snapshot key
  // still fails.
  const written = [...setBlock.matchAll(/^\s+(\w+):[^,\n]*snapshot\.\1\b/gm)].map((match) => match[1]!);
  // Everything offered as restorable must genuinely be written back...
  for (const key of RESTORABLE_FIELD_KEYS) {
    assert.ok(written.includes(key), `${key} is offered as restorable but the service does not write it`);
  }
  // ...and body/bodyVersion are written but shown structurally instead of as a cell.
  assert.deepEqual(
    written.filter((key) => !RESTORABLE_FIELD_KEYS.includes(key)).sort(),
    ["body", "bodyVersion"],
  );
});

test("slug, status and publishedAt are NEVER presented as restorable", () => {
  const comparisons = compareTranslationSnapshot(snapshot(), current());
  for (const key of ["slug", "status", "publishedAt"]) {
    const row = comparisons.find((entry) => entry.key === key);
    assert.ok(row, `${key} should still be shown as context`);
    assert.equal(row!.group, "recorded", `${key} must sit in the recorded-not-restored group`);
    assert.ok(!RESTORABLE_FIELD_KEYS.includes(key));
  }
  // And the service really does omit them from the UPDATE.
  const body = service.slice(service.indexOf("export async function restoreTranslationRevision"));
  const setBlock = body.slice(body.indexOf(".set({"), body.indexOf(".where(eq(editorialPostTranslationsTable.id, translation.id))"));
  for (const column of ["status:", "publishedAt:", "slug:"]) {
    assert.ok(!setBlock.includes(column), `restore must not write ${column}`);
  }
  assert.match(RECORDED_NOT_RESTORED_CAPTION, /NOT restored/);
});

test("only genuinely different fields are reported as changed, and empty values render as an em dash", () => {
  const identical = compareTranslationSnapshot(snapshot(), current({ title: "Original title" }));
  assert.deepEqual(changedFields(identical), [], "an unchanged revision reports no changes at all");

  const comparisons = compareTranslationSnapshot(
    snapshot({ deck: null, seoTitle: "Old SEO" }),
    current({ title: "Original title", deck: "A new deck", seoTitle: null }),
  );
  const changed = changedFields(comparisons).map((row) => row.key).sort();
  assert.deepEqual(changed, ["deck", "seoTitle"]);
  assert.equal(comparisons.find((row) => row.key === "deck")!.was, EMPTY_VALUE_PLACEHOLDER);
  assert.equal(comparisons.find((row) => row.key === "seoTitle")!.now, EMPTY_VALUE_PLACEHOLDER);
});

test("the byline is compared by the name a reader would see, not by object identity", () => {
  const comparisons = compareTranslationSnapshot(
    snapshot({ authorSnapshot: { name: "Old Author", role: "Staff", avatarUrl: "x", biography: "different" } }),
    current({ title: "Original title" }),
  );
  assert.equal(
    comparisons.find((row) => row.key === "authorSnapshot")!.changed,
    false,
    "a different avatar or biography on the same byline is not a byline change",
  );
  const renamed = compareTranslationSnapshot(
    snapshot(),
    current({ title: "Original title", authorSnapshot: { name: "New Author", role: "Staff", avatarUrl: null, biography: null } }),
  );
  assert.equal(renamed.find((row) => row.key === "authorSnapshot")!.changed, true);
});

// ─── Body structural comparison (D8) ─────────────────────────────────────────

function kinds(entries: ReturnType<typeof compareBodyBlocks>): string[] {
  return entries.map((entry) => entry.kind);
}

test("an identical body reports every block as unchanged, and says so", () => {
  const body = [paragraph("One"), heading("Two"), list("a", "b")];
  const entries = compareBodyBlocks(body, body);
  assert.deepEqual(kinds(entries), ["unchanged", "unchanged", "unchanged"]);
  assert.equal(summariseBodyComparison(entries), "The body is identical to this revision.");
});

test("a pure insertion is an addition and nothing else", () => {
  const entries = compareBodyBlocks([paragraph("One")], [paragraph("One"), paragraph("Two")]);
  assert.deepEqual(kinds(entries), ["unchanged", "added"]);
  assert.equal(entries[1]!.wasText, null);
  assert.equal(entries[1]!.nowText, "Two");
  assert.equal(entries[1]!.label, BLOCK_CHANGE_LABELS.added);
});

test("a pure deletion is a removal, shown where it used to sit", () => {
  const entries = compareBodyBlocks([paragraph("One"), paragraph("Two")], [paragraph("Two")]);
  assert.deepEqual(kinds(entries), ["removed", "unchanged"]);
  assert.equal(entries[0]!.wasText, "One");
  assert.equal(entries[0]!.nowText, null);
});

test("swapping two paragraphs is a MOVE, not an add plus a remove", () => {
  const entries = compareBodyBlocks(
    [paragraph("Alpha"), paragraph("Beta")],
    [paragraph("Beta"), paragraph("Alpha")],
  );
  assert.equal(entries.filter((entry) => entry.kind === "added").length, 0);
  assert.equal(entries.filter((entry) => entry.kind === "removed").length, 0);
  assert.equal(entries.filter((entry) => entry.kind === "moved").length, 1, "one anchor stays, one block moved");
  const moved = entries.find((entry) => entry.kind === "moved")!;
  assert.notEqual(moved.wasIndex, moved.nowIndex);
});

test("an edit in place is MODIFIED, with both texts kept for stacking", () => {
  const entries = compareBodyBlocks(
    [paragraph("One"), paragraph("The old sentence.")],
    [paragraph("One"), paragraph("The new sentence.")],
  );
  assert.deepEqual(kinds(entries), ["unchanged", "modified"]);
  assert.equal(entries[1]!.wasText, "The old sentence.");
  assert.equal(entries[1]!.nowText, "The new sentence.");
  assert.equal(entries[1]!.noun, "Paragraph");
});

test("a list whose items changed is one modified block, not a rebuilt list", () => {
  const entries = compareBodyBlocks([list("a", "b")], [list("a", "c")]);
  assert.deepEqual(kinds(entries), ["modified"]);
  assert.equal(entries[0]!.wasText, "a · b");
  assert.equal(entries[0]!.nowText, "a · c");
  assert.equal(entries[0]!.noun, "Bulleted list");
});

test("an image whose ALT changed but whose url did not is reported as changed", () => {
  const entries = compareBodyBlocks(
    [image("https://x/a.jpg", "Old alt")],
    [image("https://x/a.jpg", "New alt")],
  );
  assert.deepEqual(kinds(entries), ["modified"]);
  assert.match(entries[0]!.wasText!, /Old alt/);
  assert.match(entries[0]!.nowText!, /New alt/);
});

test("a heading that changed LEVEL but not text is still a change", () => {
  const entries = compareBodyBlocks([heading("Section", 2)], [heading("Section", 3)]);
  assert.deepEqual(kinds(entries), ["modified"]);
});

test("empty-to-populated and populated-to-empty are handled without throwing", () => {
  assert.deepEqual(kinds(compareBodyBlocks([], [paragraph("New")])), ["added"]);
  assert.deepEqual(kinds(compareBodyBlocks([paragraph("Gone")], [])), ["removed"]);
  assert.deepEqual(compareBodyBlocks([], []), []);
});

test("duplicate identical blocks do not confuse the alignment", () => {
  const entries = compareBodyBlocks(
    [paragraph("Same"), paragraph("Same")],
    [paragraph("Same"), paragraph("Same"), paragraph("Same")],
  );
  assert.equal(entries.filter((entry) => entry.kind === "unchanged").length, 2);
  assert.equal(entries.filter((entry) => entry.kind === "added").length, 1);
});

test("a 250-block body compares synchronously and stays correct", () => {
  const from = Array.from({ length: 250 }, (_, index) => paragraph(`Block ${index}`));
  const to = [...from];
  to[120] = paragraph("Block 120 — edited");
  const started = Date.now();
  const entries = compareBodyBlocks(from, to);
  assert.ok(Date.now() - started < 2_000, "the comparison must stay interactive at the body cap");
  assert.equal(entries.filter((entry) => entry.kind === "modified").length, 1);
  assert.equal(entries.filter((entry) => entry.kind === "unchanged").length, 249);
});

test("the summary counts each kind and never reports an unchanged body as changed", () => {
  const entries = compareBodyBlocks(
    [paragraph("A"), paragraph("B"), paragraph("C")],
    [paragraph("A"), paragraph("C-edited")],
  );
  const summary = summariseBodyComparison(entries);
  assert.match(summary, /^Body: /);
  assert.ok(summary.includes("removed since") || summary.includes("changed"));
});

test("blockText flattens every authored string, so nothing an editor typed is invisible", () => {
  assert.equal(blockText(paragraph("p")), "p");
  assert.equal(blockText(heading("h")), "h");
  assert.equal(blockText(list("one", "two")), "one · two");
  assert.match(blockText(image("https://x/a.jpg", "alt", "cap")), /a\.jpg · alt · cap/);
});

// ─── Restore confirmation (§12) ──────────────────────────────────────────────

const baseConfirmation = {
  languageName: "English",
  revisionNumber: 41,
  createdAt: "2030-02-02T10:00:00.000Z",
  actorLabel: "Administrator #3",
  revisionByline: "Old Author",
  currentByline: "Old Author",
  translationDirty: false,
} as const;

test("a PUBLISHED restore says plainly that the Published translation changes immediately, and is destructive", () => {
  const confirmation = restoreConfirmation({ ...baseConfirmation, status: "published" });
  assert.match(confirmation.description, /is Published right now/);
  assert.match(confirmation.description, /immediately/);
  assert.match(confirmation.description, /stays published/);
  assert.equal(confirmation.destructive, true);
  assert.equal(confirmation.confirmLabel, "Restore published content");
});

test("the confirm label never collides with the archived -> draft 'Restore to draft' button", () => {
  for (const status of ["draft", "published", "archived"] as const) {
    const label = restoreConfirmation({ ...baseConfirmation, status }).confirmLabel;
    assert.notEqual(label, "Restore");
    assert.notEqual(label, "Restore to draft");
  }
});

test("a DRAFT restore makes no published-content claim", () => {
  const confirmation = restoreConfirmation({ ...baseConfirmation, status: "draft" });
  assert.match(confirmation.description, /no published content changes/);
  assert.doesNotMatch(confirmation.description, /is Published right now/);
  assert.equal(confirmation.destructive, false);
});

test("an ARCHIVED restore says nothing is published until it is published again", () => {
  const confirmation = restoreConfirmation({ ...baseConfirmation, status: "archived" });
  assert.match(confirmation.description, /archived/);
  assert.match(confirmation.description, /restored to draft and published again/);
});

test("NO variant claims the lifecycle, the address or the publication date change", () => {
  for (const status of ["draft", "published", "archived"] as const) {
    const { description } = restoreConfirmation({ ...baseConfirmation, status });
    assert.match(description, /The address, the state and the publication date are not changed\./);
    assert.doesNotMatch(description, /deleted/i);
    assert.doesNotMatch(description, /republish/i);
    assert.doesNotMatch(description, /unpublish/i);
  }
});

test("every variant states that only this language is affected, and that the restore is undoable", () => {
  for (const status of ["draft", "published", "archived"] as const) {
    const { description } = restoreConfirmation({ ...baseConfirmation, status });
    assert.match(description, /Only this language is affected/);
    assert.match(description, /recorded first, so this can be undone/);
  }
  // Undoability is true: the service records the pre-restore state
  // UNCONDITIONALLY, not only when published.
  const body = service.slice(service.indexOf("export async function restoreTranslationRevision"));
  assert.match(body, /await recordTranslationRevision\(tx, translation, language\.code, "restore"/);
  assert.ok(!body.includes("recordTranslationRevisionIfPublished"));
});

test("the byline clause appears ONLY when the frozen byline genuinely differs", () => {
  const same = restoreConfirmation({ ...baseConfirmation, status: "published" });
  assert.doesNotMatch(same.description, /goes back to/);

  const differs = restoreConfirmation({
    ...baseConfirmation, status: "published", revisionByline: "Old Author", currentByline: "New Author",
  });
  assert.match(differs.description, /published byline in English goes back to Old Author/);
  assert.match(differs.description, /Other languages keep their own byline/);
  assert.match(differs.description, /the post's Author setting is not changed/);

  const toNothing = restoreConfirmation({
    ...baseConfirmation, status: "published", revisionByline: null, currentByline: "New Author",
  });
  assert.match(toNothing.description, /goes back to no byline/);
});

test("the unsaved-work clause appears ONLY when the translation scope is dirty, and names only that scope", () => {
  const clean = restoreConfirmation({ ...baseConfirmation, status: "published" });
  assert.doesNotMatch(clean.description, /unsaved/i);

  const dirty = restoreConfirmation({ ...baseConfirmation, status: "published", translationDirty: true });
  assert.match(dirty.description, /unsaved changes in this language/i);
  assert.match(dirty.description, /restoring discards them/i);
  assert.match(
    dirty.description,
    /Shared settings, topics and recommended posts are unaffected/,
    "the other three scopes survive a restore and must not be implied lost",
  );
  assert.equal(dirty.title, "Restore and discard your unsaved changes?");
  assert.equal(dirty.confirmLabel, "Discard and restore");
  assert.equal(dirty.destructive, true, "discarding work is destructive even on a draft");
});

test("a dirty DRAFT restore is still flagged destructive because unsaved work is lost", () => {
  const dirtyDraft = restoreConfirmation({ ...baseConfirmation, status: "draft", translationDirty: true });
  assert.equal(dirtyDraft.destructive, true);
  assert.match(dirtyDraft.description, /no published content changes/);
});

test("the confirmation names the revision, when it was taken and who took it", () => {
  const confirmation = restoreConfirmation({ ...baseConfirmation, status: "published" });
  assert.match(confirmation.description, /revision #41/);
  assert.match(confirmation.description, /by Administrator #3/);
  assert.match(confirmation.description, /2030-02-02/);
});

test("the non-modal impact summary matches the lifecycle state it describes", () => {
  assert.match(restoreImpactSummary({ status: "published", languageName: "English" }), /Published English translation immediately/);
  assert.match(restoreImpactSummary({ status: "draft", languageName: "English" }), /without changing any published content/);
  assert.match(restoreImpactSummary({ status: "archived", languageName: "English" }), /archived/);
});

test("the media caveat is honest, non-alarming and free of implementation jargon", () => {
  // CORRECTED in the 2.1E pre-PR pass. The old sentence said images are "not
  // re-checked" full stop, which is too broad: a PUBLISHED restore runs the
  // D3 readiness gate, which includes the static media rules. What a restore
  // does not do is the fuller link testing a normal media edit performs.
  assert.doesNotMatch(RESTORE_MEDIA_CAVEAT, /not re-checked|not checked/i);
  assert.match(RESTORE_MEDIA_CAVEAT, /still has to pass the same image checks/);
  assert.match(RESTORE_MEDIA_CAVEAT, /does not re-test the links/);
  // No implementation jargon reaches the operator.
  assert.doesNotMatch(RESTORE_MEDIA_CAVEAT, /SSRF|allowlist|host|DNS|HEAD/i);

  // And BOTH halves are TRUE in the service:
  const body = service.slice(service.indexOf("export async function restoreTranslationRevision"));
  //  (a) the restore path itself runs no media validation of its own;
  assert.ok(!body.includes("validateEditorialMediaUrls"));
  assert.ok(!body.includes("collectBodyImageUrls"));
  //  (b) but a PUBLISHED restore goes through the D3 readiness gate, which
  //      reuses assertTranslationPublishReady (static media rules included)
  //      with only the live network check skipped. Unchanged by this task.
  assert.match(body, /assertPublishedTranslationStillReady\(tx, post, updated, language\.code, ctx\.deps\)/);
  const gate = service.slice(
    service.indexOf("export async function assertPublishedTranslationStillReady"),
    service.indexOf("export async function loadPostTopicIds"),
  );
  assert.match(gate, /assertTranslationPublishReady/);
  assert.match(gate, /skipLiveCheck: true/);
});

test("the comparison is labelled honestly when the editor has unsaved work", () => {
  assert.match(COMPARING_AGAINST_SAVED_NOTICE, /last saved version/);
  assert.match(COMPARING_AGAINST_SAVED_NOTICE, /not shown here/);
});

// ─── The backend invariant this wave added ───────────────────────────────────

test("restore now runs the published-readiness gate, exactly as an edit does", () => {
  const body = service.slice(
    service.indexOf("export async function restoreTranslationRevision"),
  );
  assert.match(
    body,
    /\.returning\(\);[\s\S]{0,900}await assertPublishedTranslationStillReady\(tx, post, updated, language\.code, ctx\.deps\);[\s\S]{0,200}await auditEditorial\(/,
    "the gate must sit after the UPDATE, against its result, and before the audit — inside the transaction",
  );
});

// ─── 2.1E pre-PR: cross-language revision safety ─────────────────────────────
//
// THE BLOCKER, MODELLED END TO END.
//
// A post with EN + AR translations, the editor open on EN, and an AR
// translation revision selected under "All changes to this post". Under the
// original bug that combination produced a fabricated EN-vs-AR comparison, a
// confirmation and toast naming English, and — fatally — a re-baseline from
// the restored ARABIC row, which set `formRowId` to a value
// `translationRow.id` could never equal and wedged the editor on "Loading…"
// with the operator's unsaved English work gone.

const EN_ROW = { id: 11, postId: 7, languageCode: "en" } as const;
const AR_ROW = { id: 12, postId: 7, languageCode: "ar" } as const;

const arSnapshot = {
  scope: "translation" as const,
  languageId: 2,
  languageCode: "ar",
  title: "ليلة الافتتاح",
};
const enSnapshot = {
  scope: "translation" as const,
  languageId: 1,
  languageCode: "en",
  title: "Opening night",
};
const sharedSnapshot = { scope: "shared" as const, authorId: 3, featureImageUrl: null, topics: [] };

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ar", name: "Arabic" },
];

test("a revision's language comes from its OWN snapshot, and a shared revision has none", () => {
  assert.equal(revisionSnapshotLanguageCode(arSnapshot), "ar");
  assert.equal(revisionSnapshotLanguageCode(enSnapshot), "en");
  assert.equal(revisionSnapshotLanguageCode(sharedSnapshot), null);
  assert.equal(revisionSnapshotLanguageCode(null), null);
  // A blank code is treated as unknown, never as "the open one".
  assert.equal(revisionSnapshotLanguageCode({ scope: "translation", languageCode: "  " }), null);
});

test("the language display name comes from reference data the page already holds, with a code fallback", () => {
  assert.equal(languageDisplayName("ar", LANGUAGES), "Arabic");
  assert.equal(languageDisplayName("en", LANGUAGES), "English");
  // Unregistered / reference query failed: the RAW CODE, never a guess and
  // never a blank — and never a new network request to resolve it.
  assert.equal(languageDisplayName("de", LANGUAGES), "de");
  assert.equal(languageDisplayName("ar", []), "ar");
});

test("restore eligibility is same-language ONLY, and is never inferred from the open route", () => {
  assert.equal(revisionLanguageRelation("ar", "en"), "other");
  assert.equal(revisionLanguageRelation("en", "en"), "same");
  assert.equal(revisionLanguageRelation(null, "en"), "not-language-scoped");

  // THE BLOCKER CASE: editor on EN, revision is AR.
  assert.equal(canRestoreRevisionHere(revisionSnapshotLanguageCode(arSnapshot), "en"), false);
  // The same revision IS restorable from the Arabic editor.
  assert.equal(canRestoreRevisionHere(revisionSnapshotLanguageCode(arSnapshot), "ar"), true);
  // Shared revisions stay non-restorable everywhere (unchanged behaviour).
  for (const open of ["en", "ar"]) {
    assert.equal(canRestoreRevisionHere(revisionSnapshotLanguageCode(sharedSnapshot), open), false);
  }
});

test("the cross-language explanation names the REAL language and refuses to compare", () => {
  const text = crossLanguageRevisionExplanation(languageDisplayName("ar", LANGUAGES));
  assert.match(text, /Arabic translation/);
  assert.match(text, /not compared against the open translation/);
  assert.match(text, /different documents/);
  assert.doesNotMatch(text, /English/, "the open language must not be named as this revision's language");
});

test("the cross-language action is 'open that language', never 'Restore <open language>'", () => {
  const label = crossLanguageRestoreLabel(languageDisplayName("ar", LANGUAGES));
  assert.equal(label, "Open Arabic translation to restore this revision");
  assert.doesNotMatch(label, /Restore English/);
  assert.doesNotMatch(label, /^Restore\b/, "it must not read as an active restore control");

  const why = crossLanguageRestoreExplanation("Arabic");
  assert.match(why, /has to be done from the Arabic editor/);
  assert.match(why, /does not restore anything/);
  // It must not promise to discard work or to chain a restore after the switch.
  assert.doesNotMatch(why, /discard(s|ing)? your/i);
  assert.doesNotMatch(why, /then restores|and restore it for you|automatically/i);

  // And a code-only fallback still produces a usable, non-lying label.
  assert.equal(crossLanguageRestoreLabel(languageDisplayName("de", LANGUAGES)), "Open de translation to restore this revision");
});

test("the fail-closed restore guard refuses a cross-language restore instead of proceeding", () => {
  // A faithful model of handleRestoreRevision's ordering: the invariant runs
  // BEFORE the confirmation and BEFORE the mutation.
  const run = (openLanguageCode: string, revisionLanguageCode: string) => {
    const calls = { confirmed: 0, mutated: 0, error: null as string | null };
    if (revisionLanguageCode !== openLanguageCode) {
      calls.error = RESTORE_LANGUAGE_MISMATCH_ERROR;
      return calls;
    }
    calls.confirmed += 1;
    calls.mutated += 1;
    return calls;
  };

  const blocked = run("en", "ar");
  assert.equal(blocked.mutated, 0, "the restore mutation must never be called from the wrong language");
  assert.equal(blocked.confirmed, 0, "no confirmation dialog is even raised");
  assert.equal(blocked.error, RESTORE_LANGUAGE_MISMATCH_ERROR);
  assert.match(RESTORE_LANGUAGE_MISMATCH_ERROR, /different language/);
  assert.match(RESTORE_LANGUAGE_MISMATCH_ERROR, /was not restored/);

  const allowed = run("ar", "ar");
  assert.equal(allowed.mutated, 1);
  assert.equal(allowed.error, null);
});

test("the restore RESPONSE is identity-checked before the form is ever re-baselined", () => {
  // Exactly the wedge: EN open, the response is the AR row.
  assert.equal(restoredRowMatchesOpenTranslation(AR_ROW, EN_ROW), false);
  assert.equal(restoredRowMatchesOpenTranslation(EN_ROW, EN_ROW), true);
  // Every component of the identity is load-bearing.
  assert.equal(restoredRowMatchesOpenTranslation({ ...EN_ROW, postId: 8 }, EN_ROW), false);
  assert.equal(restoredRowMatchesOpenTranslation({ ...EN_ROW, id: 99 }, EN_ROW), false);
  assert.equal(restoredRowMatchesOpenTranslation({ ...EN_ROW, languageCode: "ar" }, EN_ROW), false);
});

test("the wedge is unreachable: a mismatched response re-baselines NOTHING and errors visibly", () => {
  // The editor's real render guard is `formRowId !== translationRow.id`.
  const editor = { formRowId: EN_ROW.id, translationRowId: EN_ROW.id, error: null as string | null };
  const onSuccess = (restored: { id: number; postId: number; languageCode: string }) => {
    if (!restoredRowMatchesOpenTranslation(restored, EN_ROW)) {
      editor.error = RESTORE_RESPONSE_MISMATCH_ERROR;
      return;
    }
    editor.formRowId = restored.id;
  };

  onSuccess(AR_ROW);
  assert.equal(editor.formRowId, EN_ROW.id, "the form must still belong to the open English row");
  assert.equal(
    editor.formRowId === editor.translationRowId,
    true,
    "the `formRowId !== translationRow.id` guard must NOT be left permanently false — that is the Loading… deadlock",
  );
  assert.equal(editor.error, RESTORE_RESPONSE_MISMATCH_ERROR);
  assert.match(RESTORE_RESPONSE_MISMATCH_ERROR, /nothing on this screen was changed/);

  // And the normal same-language path still re-baselines exactly as before.
  editor.error = null;
  onSuccess(EN_ROW);
  assert.equal(editor.formRowId, EN_ROW.id);
  assert.equal(editor.error, null);
});

test("after switching to Arabic, the SAME revision restores normally and names Arabic", () => {
  assert.equal(canRestoreRevisionHere("ar", "ar"), true);
  const confirmation = restoreConfirmation({
    // The revision's OWN language, which is what the drawer now hands over.
    languageName: languageDisplayName("ar", LANGUAGES),
    revisionNumber: 41,
    createdAt: "2030-02-02T10:00:00.000Z",
    actorLabel: "Administrator #3",
    status: "published",
    revisionByline: null,
    currentByline: null,
    translationDirty: false,
  });
  assert.match(confirmation.title, /Arabic/);
  assert.match(confirmation.description, /Arabic/);
  assert.doesNotMatch(confirmation.description, /English/, "the open-editor language must never leak in");
  assert.match(restoreImpactSummary({ status: "published", languageName: "Arabic" }), /Arabic/);
});

// ─── Copy regression: Published ≠ on the public website ──────────────────────

test("no restore copy claims the public website changes while coexistence is still on", () => {
  const strings = [
    RESTORE_MEDIA_CAVEAT,
    RESTORE_LANGUAGE_MISMATCH_ERROR,
    RESTORE_RESPONSE_MISMATCH_ERROR,
    crossLanguageRevisionExplanation("Arabic"),
    crossLanguageRestoreExplanation("Arabic"),
    ...(["draft", "published", "archived"] as const).flatMap((status) => [
      restoreConfirmation({
        languageName: "English", revisionNumber: 41, createdAt: "2030-02-02T10:00:00.000Z",
        actorLabel: "Administrator #3", status, revisionByline: null, currentByline: null,
        translationDirty: false,
      }).description,
      restoreImpactSummary({ status, languageName: "English" }),
    ]),
    ...Object.values(REVISION_EVENT_LABELS),
    REVISIONS_EMPTY_STATE,
  ];
  for (const value of strings) {
    assert.doesNotMatch(value, /public website/i, value);
    assert.doesNotMatch(value, /visitors?\b/i, value);
    assert.doesNotMatch(value, /on the website/i, value);
    assert.doesNotMatch(value, /\blive (content|page|website|URL)\b/i, value);
    assert.doesNotMatch(value, /the URL is public/i, value);
  }
  // …while the real safety point is NOT watered down.
  const published = restoreConfirmation({
    languageName: "English", revisionNumber: 41, createdAt: "2030-02-02T10:00:00.000Z",
    actorLabel: "Administrator #3", status: "published", revisionByline: null, currentByline: null,
    translationDirty: false,
  });
  assert.match(published.description, /Published right now/);
  assert.match(published.description, /immediately/);
  assert.equal(published.destructive, true);
});

// ════════════════════════════════════════════════════════════════════════════
// Final Editorial, Phase B — GALLERY comparison
//
// THE PRECEDENT THESE TESTS EXIST FOR. Phase A shipped `blockText` with a
// `default: return ""` branch, so every QUOTE block flattened to the empty
// string: two completely different quotes compared as identical and quote
// edits were invisible in the revision comparison. The bug was not that the
// code was wrong in an obvious way — it was that nothing asserted a change
// was DETECTED, only that comparison ran.
//
// A gallery has three further ways to fall into the same trap, so each gets
// an explicit test that a real change is SEEN:
//   1. comparing by item COUNT hides a url edit, an alt edit and a reorder;
//   2. comparing by url only hides an alt edit;
//   3. comparing order-insensitively hides a reorder.
// ════════════════════════════════════════════════════════════════════════════

const {
  compareGalleryItems,
  galleryChanged,
  galleryFingerprint,
  galleryItemText,
  readSnapshotGallery,
  summariseGalleryComparison,
} = await import("./editorial-revisions.ts");

const g = (...pairs: Array<[string, string]>) => pairs.map(([url, alt]) => ({ url, alt }));

const snapshotBase = {
  title: "T", slug: "s", deck: null, contextLabel: null, featureImageAlt: null,
  listingImageUrl: null, authorSnapshot: null, readingTimeOverrideMinutes: null,
  seoTitle: null, seoDescription: null, ogImageUrl: null,
  status: "published" as const, publishedAt: null,
};
const currentBase = { ...snapshotBase };

test("gallery: a pre-0129 snapshot with no gallery key reads as EMPTY, not as a crash", () => {
  // Revisions written before the column existed physically cannot carry
  // the key. Absent must mean "the gallery was empty then", which is what
  // the column would have held.
  assert.deepEqual(readSnapshotGallery(undefined), []);
  assert.deepEqual(readSnapshotGallery(null), []);
  assert.deepEqual(readSnapshotGallery({}), []);
  assert.deepEqual(readSnapshotGallery({ items: "nonsense" } as never), []);
});

test("gallery: a malformed stored item degrades to empty strings rather than throwing", () => {
  assert.deepEqual(readSnapshotGallery({ items: [{ url: 1 }, null] } as never), [
    { url: "", alt: "" },
    { url: "", alt: "" },
  ]);
});

test("gallery: item text flattens EVERY authored string — url AND alt", () => {
  // The Phase A quote bug in miniature: if either string were dropped,
  // edits to it would be invisible.
  const text = galleryItemText({ url: "https://x.test/a.jpg", alt: "A dancer." });
  assert.match(text, /https:\/\/x\.test\/a\.jpg/);
  assert.match(text, /A dancer\./);
});

test("gallery: an ALT-ONLY edit changes the fingerprint", () => {
  assert.notEqual(
    galleryFingerprint(g(["u", "before"])),
    galleryFingerprint(g(["u", "after"])),
  );
});

test("gallery: a URL-ONLY edit changes the fingerprint", () => {
  assert.notEqual(
    galleryFingerprint(g(["before", "a"])),
    galleryFingerprint(g(["after", "a"])),
  );
});

test("gallery: a PURE REORDER changes the fingerprint", () => {
  assert.notEqual(
    galleryFingerprint(g(["a", "A"], ["b", "B"])),
    galleryFingerprint(g(["b", "B"], ["a", "A"])),
  );
});

test("gallery: an identical gallery has an identical fingerprint", () => {
  assert.equal(
    galleryFingerprint(g(["a", "A"], ["b", "B"])),
    galleryFingerprint(g(["a", "A"], ["b", "B"])),
  );
});

test("gallery: the field row is CHANGED even when the item COUNT is unchanged", () => {
  // The row displays a count, and a count cannot detect a reorder or an
  // alt edit. `changed` must therefore be computed from the faithful
  // flattening, not from the displayed text.
  for (const [was, now] of [
    [g(["a", "A"], ["b", "B"]), g(["b", "B"], ["a", "A"])],   // reorder
    [g(["a", "A"]), g(["a", "A2"])],                            // alt edit
    [g(["a", "A"]), g(["a2", "A"])],                            // url edit
  ] as const) {
    const rows = compareTranslationSnapshot(
      { ...snapshotBase, gallery: { items: was } } as never,
      { ...currentBase, gallery: { items: now } } as never,
    );
    const row = rows.find((r) => r.key === "gallery");
    assert.ok(row, "a gallery row must be present");
    assert.equal(row!.changed, true, `expected a change to be detected for ${JSON.stringify(now)}`);
    assert.equal(row!.was, row!.now, "the displayed COUNT is deliberately identical here");
  }
});

test("gallery: an untouched gallery reports unchanged", () => {
  const rows = compareTranslationSnapshot(
    { ...snapshotBase, gallery: { items: g(["a", "A"]) } } as never,
    { ...currentBase, gallery: { items: g(["a", "A"]) } } as never,
  );
  assert.equal(rows.find((r) => r.key === "gallery")!.changed, false);
});

test("gallery: the gallery is offered as RESTORABLE", () => {
  assert.ok(RESTORABLE_FIELD_KEYS.includes("gallery"));
});

test("gallery: a reorder reads as MOVED, never as an add plus a remove", () => {
  // The distinction is what makes a reorder legible to a reviewer.
  const entries = compareGalleryItems(g(["a", "A"], ["b", "B"]), g(["b", "B"], ["a", "A"]));
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.kind === "moved"), JSON.stringify(entries));
  assert.equal(galleryChanged(entries), true);
});

test("gallery: an edited item reads as MODIFIED, carrying both texts", () => {
  const entries = compareGalleryItems(g(["a", "A"]), g(["a", "A2"]));
  assert.equal(entries[0].kind, "modified");
  assert.match(entries[0].wasText ?? "", /A$/);
  assert.match(entries[0].nowText ?? "", /A2$/);
});

test("gallery: an added item and a removed item are each named", () => {
  const added = compareGalleryItems(g(["a", "A"]), g(["a", "A"], ["b", "B"]));
  assert.deepEqual(added.map((e) => e.kind), ["unchanged", "added"]);

  const removed = compareGalleryItems(g(["a", "A"], ["b", "B"]), g(["a", "A"]));
  assert.deepEqual(removed.map((e) => e.kind), ["unchanged", "removed"]);
  // A removal has no position in the current gallery but is still reported.
  assert.equal(removed[1].nowIndex, null);
  assert.equal(removed[1].wasIndex, 1);
});

test("gallery: an identical gallery reports every item unchanged and no change overall", () => {
  const entries = compareGalleryItems(g(["a", "A"], ["b", "B"]), g(["a", "A"], ["b", "B"]));
  assert.ok(entries.every((e) => e.kind === "unchanged"));
  assert.equal(galleryChanged(entries), false);
  assert.match(summariseGalleryComparison(entries), /identical/);
});

test("gallery: the summary names what actually happened", () => {
  const entries = compareGalleryItems(g(["a", "A"], ["b", "B"]), g(["b", "B"], ["c", "C"]));
  const summary = summariseGalleryComparison(entries);
  assert.match(summary, /^Gallery: /);
  assert.doesNotMatch(summary, /identical/);
});

test("gallery: comparison labels are the SAME vocabulary the body comparison uses", () => {
  // One vocabulary for both collections: a reviewer learns "moved" once.
  const entries = compareGalleryItems(g(["a", "A"]), g(["a", "A2"]));
  assert.equal(entries[0].label, BLOCK_CHANGE_LABELS.modified);
});
