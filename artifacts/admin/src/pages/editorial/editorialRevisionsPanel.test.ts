/**
 * Wave 2.1E — source-inspection of the two React surfaces.
 *
 * Used ONLY for what genuinely cannot be executed: the drawer, the card and
 * the editor page all import React, and this repo has no jsdom and no
 * testing-library. Every rule that CAN be executed — actor wording, event
 * labels, bounding, the field split, the block comparison, the confirmation
 * copy, ordering, the cap, the dirty comparison and the payload — lives in
 * lib/editorialRevisions.test.ts and lib/editorialRecommendations.test.ts and
 * is run for real there.
 *
 * What is asserted here is wiring: which query is gated, which scope is
 * cleared where, which keys are invalidated, and — most importantly — that
 * the restore's onSuccess re-baselines from the MUTATION RESPONSE rather than
 * trusting a refetch, because a restore changes the content of the same row
 * id and the re-baseline effect is keyed on that id.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Strip comments, so prose ABOUT a rule is never mistaken for the rule. */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const editor = read("./EditorialPostTranslationPage.tsx");
const editorCode = codeOf(editor);
const drawer = read("../../components/editorial/revision-history-drawer.tsx");
const drawerCode = codeOf(drawer);
const card = read("../../components/editorial/recommendations-card.tsx");
const cardCode = codeOf(card);
const app = read("../../App.tsx");
/**
 * Route assertions run over STRIPPED App.tsx. Final Editorial Phase A
 * rewrote the Editorial import comment to record which wave shipped which
 * screen, and that prose legitimately contains the word "Revisions" — which
 * must not be mistaken for a registered revision route. The negative check
 * has always been about real code; it now looks only at real code.
 */
const appCode = codeOf(app);
const routeEntrance = read("../../lib/route-entrance.ts");

// ─── D5: a drawer, not a route ───────────────────────────────────────────────

test("2.1E adds NO route — the editor's URL is unchanged, so it can never remount", () => {
  assert.doesNotMatch(appCode, /\/editorial\/posts\/:id\/:languageCode\/revisions/);
  assert.doesNotMatch(appCode, /revisions/i, "no revision route may be registered");
  // The wave must not have widened the entrance allowlist either.
  assert.doesNotMatch(routeEntrance, /revision/i);
  assert.doesNotMatch(routeEntrance, /recommend/i);
  assert.doesNotMatch(routeEntrance, /2\.1E/);
  // And the editor must not have gained a routeEntranceKey dependency.
  assert.doesNotMatch(editorCode, /routeEntranceKey/);
});

test("history is a Sheet rendered beside the layout, not a modal over a remounted page", () => {
  assert.match(drawerCode, /<Sheet open=\{props\.open\}/);
  assert.match(drawerCode, /SheetTitle/, "the drawer needs an accessible name");
  assert.match(editorCode, /<RevisionHistoryDrawer/);
  assert.match(drawerCode, /aria-haspopup="dialog"/, "the trigger announces what it opens");
  assert.match(drawerCode, /aria-expanded=\{open\}/);
});

// ─── §31: the drawer costs nothing until it is opened ────────────────────────

test("the revisions list is enabled-gated on the drawer being open", () => {
  assert.match(
    drawerCode,
    /useListEditorialPostRevisions\([\s\S]{0,400}enabled: props\.open && props\.postId > 0/,
    "the endpoint is unpaginated — it must never fire on page load",
  );
  assert.match(drawerCode, /queryKey: getListEditorialPostRevisionsQueryKey\(props\.postId, params\)/);
});

test("the revision DETAIL is gated on a selection and cached forever, because rows are immutable", () => {
  assert.match(drawerCode, /enabled: props\.open && selectedId != null/);
  assert.match(drawerCode, /staleTime: Infinity/);
});

test("the trigger's count comes from the list the drawer already loaded — no eager request", () => {
  assert.match(editorCode, /onCountKnown=\{setRevisionCount\}/);
  assert.match(drawerCode, /onCountKnown\(loadedCount\)/);
  // There is no count endpoint, so nothing may pretend there is one.
  assert.doesNotMatch(editorCode, /revisionCount.*useQuery|useRevisionCount/);
});

// ─── D1: actor ───────────────────────────────────────────────────────────────

test("no privileged admin-directory lookup is made anywhere in 2.1E", () => {
  for (const [name, source] of [["editor", editorCode], ["drawer", drawerCode], ["card", cardCode]] as const) {
    assert.doesNotMatch(source, /adminUsers/, name);
    assert.doesNotMatch(source, /admin\/users/, name);
    assert.doesNotMatch(source, /useListAdminUsers/, name);
  }
  // "You" is resolved from the session the editor already holds.
  assert.match(editorCode, /currentAdminId=\{user\?\.id \?\? null\}/);
});

// ─── D6/§13: RBAC ────────────────────────────────────────────────────────────

test("restore is gated on canPublish, and everyone else still sees the history", () => {
  assert.match(editorCode, /canPublish=\{capabilities\.canPublish\}/);
  assert.match(drawerCode, /canPublish \? \([\s\S]{0,900}data-testid="button-restore-revision"/);
  assert.match(drawerCode, /NO_PUBLISH_PERMISSION_NOTICE/, "the existing notice is reused, not re-written");
  assert.match(editorCode, /if \(!translationRow \|\| !capabilities\.canPublish\) return;/);
});

test("saving recommendations is gated on canEdit, matching the endpoint's own permission", () => {
  assert.match(editorCode, /<RecommendationsCard[\s\S]{0,700}disabled=\{readOnly\}/);
});

// ─── §14: the re-baseline trap — the highest-value assertion in the wave ─────

test("restore re-baselines the form from the MUTATION RESPONSE, not from a refetch", () => {
  const handler = editorCode.slice(
    editorCode.indexOf("restoreRevision.mutate("),
    editorCode.indexOf("const runTransition"),
  );
  assert.match(handler, /onSuccess: \(restored\) => \{[\s\S]{0,600}rebaselineTranslation\(restored\)/);
  assert.match(
    editorCode,
    /const rebaselineTranslation = useCallback\(\(row: NonNullable<typeof translationRow>\) => \{[\s\S]{0,600}setFormRowId\(row\.id\)/,
    "one function re-baselines, reused by the effect and by the restore",
  );
});

test("restore clears ONLY the translation scope — the other three survive it untouched", () => {
  assert.match(editorCode, /dirty\.clearScope\("translation"\);/);
  const rebaseline = editorCode.slice(
    editorCode.indexOf("const rebaselineTranslation"),
    editorCode.indexOf("useEffect(() => {\n    if (!translationRow) return;"),
  );
  for (const scope of ["shared", "topics", "recommendations"]) {
    assert.doesNotMatch(
      rebaseline,
      new RegExp(`clearScope\\("${scope}"\\)`),
      `a restore must never clear the ${scope} scope — the server did not write it`,
    );
  }
});

test("a REJECTED restore touches no dirty flag, no form state and raises no success toast", () => {
  const handler = editorCode.slice(
    editorCode.indexOf("restoreRevision.mutate("),
    editorCode.indexOf("const runTransition"),
  );
  const onError = handler.slice(handler.indexOf("onError:"));
  assert.doesNotMatch(onError, /clearScope|setForm|setBaseline|rebaselineTranslation|setFormRowId/);
  assert.doesNotMatch(onError, /toast\(/, "a rejection is a persistent inline message, not a toast");
  assert.match(onError, /setRestoreError\(editorialErrorMessage\(err\)\)/);
  // ...and it is rendered persistently, inside the drawer, with role=alert.
  assert.match(drawerCode, /data-testid="revision-restore-error"/);
  assert.match(drawer, /role="alert"[\s\S]{0,200}data-testid="revision-restore-error"/);
});

test("the restore confirmation is built from real state, including the dirty translation scope", () => {
  assert.match(editorCode, /restoreConfirmation\(\{[\s\S]{0,500}translationDirty: dirty\.flags\.translation/);
  assert.match(editorCode, /status: translationRow\.status/);
  assert.match(editorCode, /currentByline: translationRow\.authorSnapshot\?\.name \?\? null/);
  assert.match(editorCode, /if \(!confirmed\) return;/);
});

// ─── §30: invalidation is targeted ───────────────────────────────────────────

test("NO global invalidateQueries() exists anywhere in the three files", () => {
  for (const [name, source] of [["editor", editorCode], ["drawer", drawerCode], ["card", cardCode]] as const) {
    assert.doesNotMatch(source, /invalidateQueries\(\s*\)/, name);
    assert.doesNotMatch(source, /invalidateQueries\(\{\s*\}\)/, name);
    assert.doesNotMatch(source, /resetQueries|clear\(\)/, name);
  }
});

test("the revisions list is invalidated by its generated key prefix, with no predicate", () => {
  assert.match(
    editorCode,
    /invalidateQueries\(\{ queryKey: getListEditorialPostRevisionsQueryKey\(postId\) \}\)/,
  );
  const invalidator = editorCode.slice(
    editorCode.indexOf("const invalidateRevisions"),
    editorCode.indexOf("const invalidateRecommendations"),
  );
  assert.doesNotMatch(invalidator, /predicate/, "the key is [path, params] — array prefix matching works here");
  assert.doesNotMatch(invalidator, /isEditorialPostTranslationKey/);
});

test("a successful restore invalidates the translation, the lists, the post and the history — and nothing else", () => {
  const handler = editorCode.slice(
    editorCode.indexOf("restoreRevision.mutate("),
    editorCode.indexOf("const runTransition"),
  );
  assert.match(handler, /invalidateTranslation\(\)/);
  assert.match(handler, /invalidateRevisions\(\)/);
  // Restore writes exactly ONE translation row, chosen from the snapshot's own
  // languageId, so the cross-language predicate would evict good cache for
  // nothing. The revision detail is append-only and can never change.
  assert.doesNotMatch(handler, /isEditorialPostTranslationKey/);
  assert.doesNotMatch(handler, /getGetEditorialPostRevisionQueryKey/);
  assert.doesNotMatch(handler, /reference|invalidateShared/);
});

test("saving recommendations invalidates the post detail (which embeds them) and the history", () => {
  const invalidator = editorCode.slice(
    editorCode.indexOf("const invalidateRecommendations"),
    editorCode.indexOf("const invalidateTopics"),
  );
  assert.match(invalidator, /getGetEditorialPostQueryKey\(postId\)/);
  assert.match(invalidator, /invalidateRevisions\(\)/);
  assert.doesNotMatch(invalidator, /getGetEditorialPostTranslationQueryKey/, "no translation row is touched");
});

test("the revision-producing saves refresh history; publish and restore-to-draft need no such refresh", () => {
  // publish and restoreTranslationToDraft write NO revision, and both go
  // through runTransition alongside archive — invalidating there is a cheap
  // no-op for them rather than a false claim.
  assert.match(editorCode, /invalidateTranslation\(\);\s*invalidateRevisions\(\);/);
});

// ─── D7: one PUT, only on Save ───────────────────────────────────────────────

test("no recommendation mutation fires from add, remove or move — only from Save", () => {
  assert.doesNotMatch(cardCode, /mutate\(/, "the card holds no mutation at all");
  assert.doesNotMatch(cardCode, /useReplaceEditorialPostRecommendations/);
  const save = editorCode.slice(
    editorCode.indexOf("const saveRecommendations"),
    editorCode.indexOf("const handleRestoreRevision"),
  );
  assert.equal(
    (save.match(/replaceRecommendations\.mutate\(/g) ?? []).length,
    1,
    "exactly one PUT per explicit save",
  );
  assert.equal(
    (editorCode.match(/replaceRecommendations\.mutate\(/g) ?? []).length,
    1,
    "and nowhere else in the page",
  );
  assert.match(editorCode, /onSave=\{saveRecommendations\}/);
});

test("the payload is the pure helper's, so array order is the order and position is omitted", () => {
  assert.match(editorCode, /toRecommendationsPayload\(recommendations\)/);
  assert.doesNotMatch(editorCode, /position:/);
});

test("a successful save clears ONLY the recommendations scope; a failure leaves it dirty", () => {
  const save = editorCode.slice(
    editorCode.indexOf("const saveRecommendations"),
    editorCode.indexOf("const handleRestoreRevision"),
  );
  assert.match(save, /dirty\.clearScope\("recommendations"\)/);
  for (const scope of ["translation", "shared", "topics"]) {
    assert.doesNotMatch(save, new RegExp(`clearScope\\("${scope}"\\)`));
  }
  const onError = save.slice(save.indexOf("onError:"));
  assert.doesNotMatch(onError, /clearScope|setRecommendationsBaseline|setRecommendations\(/);
  assert.match(onError, /setRecommendationsError/);
  // No aggregate verdict anywhere.
  assert.doesNotMatch(editorCode, /"Post saved"/);
});

// ─── §17/§31: no redundant read ──────────────────────────────────────────────

test("recommendations are read from the post detail the editor already fetches", () => {
  assert.match(editorCode, /toRecommendationIds\(post\.data\?\.recommendations \?\? \[\]\)/);
  assert.match(editorCode, /saved=\{post\.data\?\.recommendations \?\? \[\]\}/);
  assert.doesNotMatch(editorCode, /useListEditorialPostRecommendations/);
  assert.doesNotMatch(cardCode, /useListEditorialPostRecommendations/);
  // Baselined in the SAME post-level effect as topics, so it survives a
  // language switch exactly as topics does.
  assert.match(
    editorCode,
    /setTopicBaseline\(ids\);[\s\S]{0,300}setRecommendationsBaseline\(targets\);[\s\S]{0,120}\}, \[postRow\?\.id\]\);/,
  );
});

// ─── §19: candidate search ───────────────────────────────────────────────────

test("the picker searches the SERVER, scoped to this post's channel, debounced", () => {
  assert.match(cardCode, /toCandidateQuery\(\{ channel, search: debounced, publishedOnly \}\)/);
  assert.match(cardCode, /useDebouncedValue\(search, 250\)/);
  assert.match(cardCode, /useListEditorialPosts\(params/);
  assert.match(cardCode, /queryKey: getListEditorialPostsQueryKey\(params\)/);
  assert.match(editorCode, /channel=\{postRow\.channel\}/);
});

test("the picker is opt-in, so the editor's initial load gains NO request", () => {
  // Found in the browser: without this gate the candidate search fired on
  // every editor page load, whether or not anyone intended to add anything.
  assert.match(cardCode, /enabled: postId > 0 && \(pickerOpen \|\| debounced\.trim\(\)\.length > 0\)/);
  assert.match(cardCode, /onFocus=\{\(\) => setPickerOpen\(true\)\}/);
  assert.match(cardCode, /data-testid="recommendation-picker-closed"/);
});

test("focus after a removal is deterministic — it runs AFTER React commits", () => {
  assert.match(cardCode, /window\.setTimeout\(\(\) => \{/);
  assert.doesNotMatch(cardCode, /requestAnimationFrame/);
  assert.match(cardCode, /data-remove-recommendation/);
});

test("the comparison STACKS below sm rather than scrolling sideways", () => {
  assert.match(drawerCode, /block border-b border-border\/60 py-1 align-top sm:table-row/);
  assert.match(drawerCode, /hidden sm:table-header-group/);
  // Each stacked value keeps its own visible label, so a cell is never orphaned.
  assert.match(drawerCode, /sm:hidden">In this revision<\/span>/);
  assert.match(drawerCode, /sm:hidden">Now<\/span>/);
  assert.doesNotMatch(drawerCode, /overflow-x-auto/);
});

test("the only client-side exclusion is self plus already-selected", () => {
  assert.match(cardCode, /filterCandidates\(candidateItems, \{ sourcePostId: postId, selected \}\)/);
  // No client-side text filtering pretending to be a search.
  assert.doesNotMatch(cardCode, /toLowerCase\(\)\.includes/);
});

test("the cap disables Add while Move and Remove stay available, with a reason", () => {
  assert.match(cardCode, /const atCap = !canAddRecommendation\(selected\)/);
  assert.match(cardCode, /disabled=\{atCap\}/);
  assert.match(cardCode, /title=\{atCap \? RECOMMENDATIONS_CAP_MESSAGE : undefined\}/);
  const rows = card.slice(card.indexOf("data-testid=\"recommendation-rows\""), card.indexOf("</ul>"));
  assert.doesNotMatch(rows, /atCap/, "removing and reordering must keep working at the cap");
});

// ─── §32: accessibility ──────────────────────────────────────────────────────

test("reordering and removal are keyboard-operable and announced", () => {
  assert.match(card, /aria-label=\{`Move \$\{info\.label\} up`\}/);
  assert.match(card, /aria-label=\{`Move \$\{info\.label\} down`\}/);
  assert.match(card, /aria-label=\{`Remove recommended post \$\{info\.label\}`\}/);
  assert.match(card, /aria-live="polite"/);
  assert.match(cardCode, /moveAnnouncement\(/);
  assert.doesNotMatch(cardCode, /draggable|onDragStart/, "no drag-and-drop: it is not keyboard-operable here");
});

test("the comparison never relies on colour alone and uses ins/del semantics", () => {
  assert.match(drawerCode, /\{block\.label\}/, "every block carries a TEXT label");
  assert.match(drawer, /<del /);
  assert.match(drawer, /<ins /);
  assert.match(drawer, /<th scope="col"/, "the field comparison is a real table");
  assert.match(drawer, /<time dateTime=/);
  assert.match(drawer, /dir="auto"/, "Arabic is a first-class language here");
});

test("the recorded-but-not-restored group is a separate tbody with its own caption", () => {
  assert.match(drawer, /<tbody className="block sm:table-row-group" data-testid="revision-recorded-not-restored">/);
  assert.match(drawerCode, /RECORDED_NOT_RESTORED_CAPTION/);
});

// ─── §33: responsive ─────────────────────────────────────────────────────────

test("the drawer is full-width on a phone and wide enough for a real comparison on desktop", () => {
  assert.match(drawerCode, /w-full sm:max-w-3xl/);
  assert.match(drawerCode, /overflow-y-auto/);
});

// ─── Honesty ─────────────────────────────────────────────────────────────────

test("nothing claims restored images were re-checked, and nothing says 'Related posts'", () => {
  // Comments stripped: the 2.1D header legitimately says the readiness gate is
  // "re-run", and what matters is what the operator is SHOWN.
  for (const source of [drawerCode, cardCode, editorCode]) {
    assert.doesNotMatch(source, /re-?validated|re-?verified|re-?checked and safe/i);
    assert.doesNotMatch(source, /Related posts/);
  }
  assert.match(drawerCode, /RESTORE_MEDIA_CAVEAT/);
});

test("a shared revision is labelled Shared, offers no Restore, and shows the backend's sentence", () => {
  assert.match(drawerCode, /snapshot\.scope === "shared"/);
  const shared = drawerCode.slice(
    drawerCode.indexOf('if (snapshot.scope === "shared")'),
    drawerCode.indexOf("const fields = compareTranslationSnapshot"),
  );
  assert.doesNotMatch(shared, /button-restore-revision/, "a shared revision must never offer Restore");
  assert.match(shared, /SHARED_REVISION_NOT_RESTORABLE/);
  // Topic and author ids resolve against the cached reference lists, with an
  // honest #id fallback — never a request per id.
  assert.match(shared, /`Topic #\$\{id\}`/);
  assert.match(shared, /`Author #\$\{snapshot\.authorId\}`/);
});

test("the drawer writes nothing: no setForm, no clearScope, no mutation of its own", () => {
  assert.doesNotMatch(drawerCode, /setForm|setBaseline|clearScope|setDirty/);
  assert.doesNotMatch(drawerCode, /\.mutate\(/);
});

test("the comparison's baseline is the SAVED row, and says so when the form is dirty", () => {
  assert.match(drawerCode, /compareTranslationSnapshot\(snapshot, translationRow\)/);
  assert.match(drawerCode, /props\.translationDirty && \([\s\S]{0,300}COMPARING_AGAINST_SAVED_NOTICE/);
});

// ─── 2.1E pre-PR: cross-language revision context ────────────────────────────

test("the detail panel derives the revision's language from its OWN snapshot", () => {
  assert.match(drawerCode, /revisionSnapshotLanguageCode\(snapshot\)/);
  assert.match(drawerCode, /languageDisplayName\(revisionLanguageCode, languages\)/);
  assert.match(drawerCode, /canRestoreRevisionHere\(revisionLanguageCode, languageCode\)/);
  // It must NEVER infer the language from the open translation or the scope.
  assert.doesNotMatch(drawerCode, /revisionLanguage\w* = (props\.)?languageCode/);
  assert.doesNotMatch(drawerCode, /translationRow\.languageCode/);
  assert.doesNotMatch(drawerCode, /scope === "all" \?[\s\S]{0,80}language/);
});

test("a cross-language revision builds NO comparison — it previews its own snapshot instead", () => {
  const cross = drawerCode.slice(
    drawerCode.indexOf("if (!canRestoreRevisionHere(revisionLanguageCode, languageCode))"),
    drawerCode.indexOf("const fields = compareTranslationSnapshot"),
  );
  assert.ok(cross.length > 0, "the cross-language branch must return before any comparison is built");
  assert.doesNotMatch(cross, /compareTranslationSnapshot|compareBodyBlocks|summariseBodyComparison/);
  assert.doesNotMatch(cross, /translationRow/, "nothing from the OPEN translation may appear in it");
  // The revision's own content is shown, read-only, from data already fetched.
  assert.match(cross, /data-testid="revision-cross-language-preview"/);
  assert.match(cross, /data-testid="revision-cross-language-body"/);
  assert.match(cross, /crossLanguageRevisionExplanation\(revisionLanguageName\)/);
  assert.match(cross, /data-testid="revision-cross-language-name"/);
  // And it costs no extra request: no hook, no fetch, inside the branch.
  assert.doesNotMatch(cross, /use[A-Z]\w*\(/);
});

test("a cross-language revision offers NO restore control, only a language CTA", () => {
  const cross = drawerCode.slice(
    drawerCode.indexOf("if (!canRestoreRevisionHere(revisionLanguageCode, languageCode))"),
    drawerCode.indexOf("const fields = compareTranslationSnapshot"),
  );
  assert.doesNotMatch(cross, /button-restore-revision/);
  assert.doesNotMatch(cross, /onRestore\(/);
  assert.doesNotMatch(cross, /restorePending/);
  assert.match(cross, /data-testid="button-open-revision-language"/);
  assert.match(cross, /crossLanguageRestoreLabel\(revisionLanguageName\)/);
});

test("the CTA calls the editor's REAL language switcher — never a parallel navigate", () => {
  assert.match(drawerCode, /onSwitchLanguage\(revisionLanguageCode\)/);
  // The drawer must own no navigation of its own, so the CTA inherits the
  // translation dirty-state guard and the no-remount behaviour for free.
  assert.doesNotMatch(drawerCode, /setLocation|useLocation|navigate\(|useNavigate|wouter/);
  // The editor hands it the same function the Languages switcher calls.
  assert.match(editorCode, /onSwitchLanguage=\{switchLanguage\}/);
  const switcher = editorCode.slice(
    editorCode.indexOf("const switchLanguage = async"),
    editorCode.indexOf("if (!match || postId <= 0) return null;"),
  );
  assert.match(switcher, /dirty\.flags\.translation && !\(await confirmAction\(\{ \.\.\.UNSAVED_LANGUAGE_SWITCH_CONFIRMATION \}\)\)/);
  assert.match(switcher, /navigate\(`\/editorial\/posts\/\$\{postId\}\/\$\{code\}`\)/);
  // ONLY the translation scope is guarded: shared, topics and recommendations
  // belong to the post and survive the switch untouched.
  for (const scope of ["shared", "topics", "recommendations"]) {
    assert.doesNotMatch(switcher, new RegExp(`dirty\\.flags\\.${scope}`));
    assert.doesNotMatch(switcher, new RegExp(`clearScope\\("${scope}"\\)`));
  }
  assert.doesNotMatch(switcher, /setShared|setTopicIds|setRecommendations/);
  // And the CTA must not chain switch + restore, or auto-discard edits.
  assert.doesNotMatch(drawerCode, /onSwitchLanguage\([\s\S]{0,80}onRestore/);
});

test("the restore handler fails closed on a language mismatch BEFORE confirming or mutating", () => {
  const handler = editorCode.slice(
    editorCode.indexOf("const handleRestoreRevision"),
    editorCode.indexOf("restoreRevision.mutate("),
  );
  assert.match(handler, /if \(revision\.languageCode !== languageCode\) \{[\s\S]{0,120}setRestoreError\(RESTORE_LANGUAGE_MISMATCH_ERROR\);[\s\S]{0,40}return;/);
  assert.ok(
    handler.indexOf("RESTORE_LANGUAGE_MISMATCH_ERROR") < handler.indexOf("confirmAction("),
    "the invariant must run before the confirmation dialog, not after it",
  );
});

test("the confirmation and the success toast name the REVISION's language, not the page's", () => {
  const handler = editorCode.slice(
    editorCode.indexOf("const handleRestoreRevision"),
    editorCode.indexOf("const runTransition"),
  );
  assert.match(handler, /languageName: revision\.languageName/);
  assert.match(handler, /The \$\{revision\.languageName\} content was restored/);
  assert.doesNotMatch(handler, /^\s*languageName,\s*$/m, "the page-level languageName must not be passed implicitly");
  // The drawer supplies it from the revision's own snapshot.
  assert.match(drawerCode, /languageCode: revisionLanguageCode!/);
  assert.match(drawerCode, /languageName: revisionLanguageName/);
});

test("a mismatched restore RESPONSE re-baselines nothing — the Loading… wedge is unreachable", () => {
  const restoreHandler = editorCode.slice(
    editorCode.indexOf("restoreRevision.mutate("),
    editorCode.indexOf("const runTransition"),
  );
  const onSuccess = restoreHandler.slice(
    restoreHandler.indexOf("onSuccess:"),
    restoreHandler.indexOf("onError:"),
  );
  assert.match(onSuccess, /restoredRowMatchesOpenTranslation\(restored, \{/);
  assert.match(onSuccess, /id: translationRow\.id,/);
  assert.match(onSuccess, /postId,/);
  assert.match(onSuccess, /languageCode,/);
  assert.ok(
    onSuccess.indexOf("restoredRowMatchesOpenTranslation") < onSuccess.indexOf("rebaselineTranslation(restored)"),
    "the identity check must run BEFORE the re-baseline",
  );
  assert.match(onSuccess, /setRestoreError\(RESTORE_RESPONSE_MISMATCH_ERROR\);\s*\n\s*return;/);
  // The guard it protects is still the one the editor actually renders on.
  assert.match(editorCode, /formRowId !== translationRow\.id/);
});

test("a SHARED revision is untouched by the language work — no CTA, no language claim", () => {
  const shared = drawerCode.slice(
    drawerCode.indexOf('if (snapshot.scope === "shared")'),
    drawerCode.indexOf("const revisionLanguageCode"),
  );
  assert.ok(shared.length > 0, "the shared branch must still return before any language logic");
  assert.match(shared, /SHARED_REVISION_NOT_RESTORABLE/);
  assert.doesNotMatch(shared, /button-restore-revision/);
  assert.doesNotMatch(shared, /button-open-revision-language|crossLanguage|onSwitchLanguage/);
});

test("cross-language revisions stay VISIBLE under 'All changes' — nothing is hidden", () => {
  // The list renders every row the server returned; only the DETAIL panel
  // branches on language. No language filter may be applied to the list.
  const list = drawerCode.slice(
    drawerCode.indexOf("const rows: EditorialRevisionSummary[]"),
    drawerCode.indexOf("function RevisionDetailPanel"),
  );
  assert.doesNotMatch(list, /canRestoreRevisionHere|revisionSnapshotLanguageCode/);
  assert.match(list, /rows\.map\(\(row\) => toRevisionRowView\(row, props\.currentAdminId\)\)/);
  assert.match(list, /view\.languageCode && \(/, "each row still shows its own language code");
});

// ─── 2.1E pre-PR: Published ≠ on the public website ──────────────────────────

test("no Editorial Posts surface claims public-website exposure while coexistence is on", () => {
  const shell = read("../../components/editorial/editorial-page-shell.tsx");
  const posts = read("../../lib/editorial-posts.ts");
  const revisions = read("../../lib/editorial-revisions.ts");
  const create = read("./EditorialPostCreatePage.tsx");
  const detail = read("./EditorialPostDetailPage.tsx");

  const banned = [
    /on the website right now/i,
    /becomes readable on the public website/i,
    /the URL is public/i,
    /visitors see this/i,
    /live website content/i,
    /publishes these changes to the website/i,
    /put live/i,
  ];
  const surfaces: Array<[string, string]> = [
    ["editorial-posts", codeOf(posts)],
    ["editorial-revisions", codeOf(revisions)],
    ["translation editor", editorCode],
    ["create page", codeOf(create)],
    ["detail page", codeOf(detail)],
    ["revision drawer", drawerCode],
    ["recommendations card", cardCode],
  ];
  for (const [name, source] of surfaces) {
    for (const pattern of banned) {
      assert.doesNotMatch(source, pattern, `${name} must not claim ${pattern}`);
    }
  }

  // The ONE place the coexistence fact is stated is the shell's banner, and it
  // must not be removed or weakened by this correction.
  assert.match(shell, /EDITORIAL_COEXISTENCE_NOTICE/);
  assert.match(shell, /The public website still reads the existing News and Performance sections\. Content published here is not live yet\./);
  assert.match(shell, /data-testid="editorial-coexistence-banner"/);
  assert.match(editorCode, /<EditorialPageShell/, "the editor renders inside the shell that carries it");
});

test("the corrected copy keeps every real warning about editing PUBLISHED content", () => {
  const posts = codeOf(read("../../lib/editorial-posts.ts"));
  // The safety point is intact: a save on published content takes effect now.
  assert.match(posts, /You are editing Published Editorial content/);
  assert.match(posts, /Saving changes this published translation immediately/);
  // The slug lock is still explained, and still keyed on it being published.
  assert.match(posts, /slug cannot be changed[\s\S]{0,80}already been published/);
  // The author-reassignment confirmation still fires and still says "immediately".
  assert.match(posts, /Saving rewrites the published byline immediately/);
});

// ─── 2.1E pre-PR: a saved recommendation shows no cached status ──────────────

test("a SAVED recommendation row renders no status sourced from the picker's cache", () => {
  const savedBranch = cardCode.slice(
    cardCode.indexOf("const entry = savedById.get(targetPostId);"),
    cardCode.indexOf("return sessionLabels[targetPostId]"),
  );
  assert.match(savedBranch, /annotation: null/);
  assert.doesNotMatch(savedBranch, /sessionLabels/, "the ephemeral picker cache may not reach a saved row");
  assert.doesNotMatch(savedBranch, /targetStateAnnotation/);
  // Candidate rows still show their own search response's real state.
  assert.match(cardCode, /annotation: targetStateAnnotation\(item\.translations\)/);
});

// ─── 2.1E pre-PR: the route-entrance contract is untouched ───────────────────

test("route-entrance is not modified, and the drawer still adds no route", () => {
  // Comments legitimately DISCUSS the :languageCode tail; the CODE must carry
  // no revision/recommendation knowledge and no new language behaviour.
  const routeEntranceCode = codeOf(routeEntrance);
  assert.doesNotMatch(routeEntranceCode, /revision|recommend/i);
  assert.doesNotMatch(editorCode, /routeEntranceKey/);
  assert.doesNotMatch(drawerCode, /routeEntranceKey|useRoute\(/);
});
