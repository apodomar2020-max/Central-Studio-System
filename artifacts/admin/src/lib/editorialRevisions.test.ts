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
  RESTORE_MEDIA_CAVEAT,
  REVISION_EVENT_LABELS,
  REVISION_RENDER_LIMIT,
  REVISIONS_EMPTY_STATE,
  SHARED_REVISION_NOT_RESTORABLE,
  blockText,
  boundRevisions,
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

test("translation_status_change is named for what actually writes it — archiving live content", () => {
  // Verified in the service: the only caller is archiveTranslation, and only
  // from `published`.
  assert.match(service, /recordTranslationRevisionIfPublished\([\s\S]{0,200}translation_status_change/);
  assert.equal(REVISION_EVENT_LABELS.translation_status_change, "Taken off the website");
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
  const written = [...setBlock.matchAll(/^\s+(\w+): snapshot\./gm)].map((match) => match[1]!);
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

test("a PUBLISHED restore says plainly that live content changes immediately, and is destructive", () => {
  const confirmation = restoreConfirmation({ ...baseConfirmation, status: "published" });
  assert.match(confirmation.description, /on the website right now/);
  assert.match(confirmation.description, /immediately/);
  assert.match(confirmation.description, /stays published/);
  assert.equal(confirmation.destructive, true);
  assert.equal(confirmation.confirmLabel, "Restore live content");
});

test("the confirm label never collides with the archived -> draft 'Restore to draft' button", () => {
  for (const status of ["draft", "published", "archived"] as const) {
    const label = restoreConfirmation({ ...baseConfirmation, status }).confirmLabel;
    assert.notEqual(label, "Restore");
    assert.notEqual(label, "Restore to draft");
  }
});

test("a DRAFT restore makes no live-content claim", () => {
  const confirmation = restoreConfirmation({ ...baseConfirmation, status: "draft" });
  assert.match(confirmation.description, /nothing on the website changes/);
  assert.doesNotMatch(confirmation.description, /on the website right now/);
  assert.equal(confirmation.destructive, false);
});

test("an ARCHIVED restore says the website is unaffected until it is published again", () => {
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
  assert.match(dirtyDraft.description, /nothing on the website changes/);
});

test("the confirmation names the revision, when it was taken and who took it", () => {
  const confirmation = restoreConfirmation({ ...baseConfirmation, status: "published" });
  assert.match(confirmation.description, /revision #41/);
  assert.match(confirmation.description, /by Administrator #3/);
  assert.match(confirmation.description, /2030-02-02/);
});

test("the non-modal impact summary matches the lifecycle state it describes", () => {
  assert.match(restoreImpactSummary({ status: "published", languageName: "English" }), /live English page immediately/);
  assert.match(restoreImpactSummary({ status: "draft", languageName: "English" }), /without changing anything on the website/);
  assert.match(restoreImpactSummary({ status: "archived", languageName: "English" }), /archived/);
});

test("the media caveat is honest, non-alarming and free of security jargon", () => {
  assert.match(RESTORE_MEDIA_CAVEAT, /not re-checked/);
  assert.doesNotMatch(RESTORE_MEDIA_CAVEAT, /SSRF|allowlist|host/i);
  // And it is TRUE: the restore path writes snapshot.body verbatim with no
  // media validation of its own.
  const body = service.slice(service.indexOf("export async function restoreTranslationRevision"));
  assert.ok(!body.includes("validateEditorialMediaUrls"));
  assert.ok(!body.includes("collectBodyImageUrls"));
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
