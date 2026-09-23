/**
 * Wave 2.1D — Posts screens.
 *
 * Source inspection, matching `editorialAuthorsPage.test.ts` and
 * `editorialTopicsPage.test.ts`: a `.tsx` screen cannot be imported by
 * node:test (JSX, `@/` aliases, `import.meta.env`). Everything genuinely
 * behavioural lives in the pure modules and is tested for real there; this
 * file pins the contracts a regex CAN prove — which hooks are called, which
 * payloads are sent, which controls exist and which deliberately do not.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

/**
 * Comments stripped. An "X must NOT appear" assertion has to run against
 * CODE — these files document what they deliberately do not do, so the prose
 * legitimately names the very things the code must not contain.
 */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const list = read("./EditorialPostsListPage.tsx");
const create = read("./EditorialPostCreatePage.tsx");
const detail = read("./EditorialPostDetailPage.tsx");
const editor = read("./EditorialPostTranslationPage.tsx");
const bodyEditor = readFileSync(
  new URL("../../components/editorial/post-body-editor.tsx", import.meta.url),
  "utf8",
);

const ALL_PAGES: Array<[string, string]> = [
  ["list", list],
  ["create", create],
  ["detail", detail],
  ["editor", editor],
];

const ALL_PAGES_CODE: Array<[string, string]> = ALL_PAGES.map(([name, source]) => [name, codeOf(source)]);
const editorCode = codeOf(editor);
const bodyEditorCode = codeOf(bodyEditor);

// ─── Shell + coexistence ─────────────────────────────────────────────────────

test("every Posts screen renders inside EditorialPageShell (legacy coexistence banner)", () => {
  for (const [name, source] of ALL_PAGES) {
    assert.match(source, /<EditorialPageShell/, `${name} must use the Editorial shell`);
    assert.match(
      source,
      /from "@\/components\/editorial\/editorial-page-shell"/,
      `${name} must import the shared shell`,
    );
  }
});

test("no Posts screen touches legacy News or Performance, the public website, or any backfill", () => {
  for (const [name, source] of ALL_PAGES_CODE) {
    assert.doesNotMatch(source, /websiteNews|WebsiteNews|websitePerformance|WebsitePerformance/, name);
    assert.doesNotMatch(source, /backfill|dualWrite|dual-write/i, name);
  }
});

// ─── List ────────────────────────────────────────────────────────────────────

test("the list is server-paginated and server-filtered — no client-side array filtering", () => {
  assert.match(list, /useListEditorialPosts\(query\)/);
  assert.match(list, /toPostListQuery\(/);
  assert.match(list, /POST_LIST_PAGE_SIZE/);
  // The client never re-filters the returned page.
  assert.doesNotMatch(list, /items\.filter\(/);
});

test("changing any filter resets to page 1", () => {
  assert.match(list, /const patchFilters = [\s\S]{0,200}setPage\(1\)/);
  assert.match(list, /onSearchChange=\{\(value\) => \{ setSearch\(value\); setPage\(1\); \}\}/);
});

test("the list offers NO column sorting (D9) and says the ordering is server-owned", () => {
  assert.doesNotMatch(list, /sortContent=/);
  assert.doesNotMatch(list, /onSort|toggleSort|sortBy/i);
  assert.match(list, /posts-ordering-note/);
  assert.match(list, /Most recently updated first/);
});

test("the Author column is resolved from the SHARED reference cache, never per row", () => {
  assert.match(list, /useEditorialReferenceData\(\)/);
  assert.match(list, /authorsById/);
  // No per-row fetch of any kind.
  assert.doesNotMatch(list, /useGetEditorialAuthor\(/);
  assert.doesNotMatch(list, /items\.map\([\s\S]{0,400}use[A-Z]/);
});

test("there is no Topics column — the list endpoint cannot populate one without N+1", () => {
  assert.doesNotMatch(list, /<TableHead>Topics<\/TableHead>/);
});

test("the list has NO delete control — no delete route exists for a post", () => {
  for (const [name, source] of ALL_PAGES_CODE) {
    assert.doesNotMatch(source, /useDelete[A-Za-z]*EditorialPost/, name);
    assert.doesNotMatch(source, /button-delete-post/, name);
  }
});

test("the New post button is gated on create, not on edit", () => {
  assert.match(list, /capabilities\.canCreate \? \([\s\S]{0,300}button-new-post/);
});

test("the list distinguishes empty-from-no-data and empty-from-filters", () => {
  assert.match(list, /No posts yet\./);
  assert.match(list, /No posts match the current search and filters\./);
  assert.match(list, /Posts could not be loaded\./);
});

// ─── Create ──────────────────────────────────────────────────────────────────

test("create is ONE request and redirects straight into the editor", () => {
  assert.match(create, /useCreateEditorialPost\(\)/);
  assert.equal((create.match(/\.mutate\(/g) ?? []).length, 1, "a single request, not a wizard");
  assert.match(create, /navigate\(`\/editorial\/posts\/\$\{result\.post\.id\}\/\$\{languageCode\}`\)/);
});

test("create offers only ACTIVE languages", () => {
  assert.match(create, /\.filter\(\(language\) => language\.isActive\)/);
});

test("create filters authors to the chosen channel AND to active ones", () => {
  assert.match(create, /author\.channel === form\.channel && author\.status === "active"/);
});

test("the create slug preview stops once the operator types (D6)", () => {
  assert.match(create, /const preview = slugTouched \? form\.slug\.trim\(\) : slugPreview\(form\.title\)/);
  assert.match(create, /setSlugTouched\(true\)/);
  // And the preview is never what gets submitted.
  assert.match(create, /toCreatePostPayload\(form\)/);
  assert.doesNotMatch(create, /slug: slugPreview\(/);
});

test("create invalidates only the posts list, not reference data", () => {
  assert.match(create, /invalidateQueries\(\{ queryKey: getListEditorialPostsQueryKey\(\) \}\)/);
  assert.doesNotMatch(create, /getListEditorialAuthorsQueryKey|getListEditorialTopicsQueryKey/);
});

test("create renders a permission-denied surface rather than a broken form", () => {
  assert.match(create, /post-create-forbidden/);
});

// ─── Detail (D8 redirect) ────────────────────────────────────────────────────

test("the bare post id redirects to a translation and never duplicates the editor", () => {
  assert.match(detail, /preferredTranslationCode\(slots\)/);
  assert.match(detail, /navigate\(`\/editorial\/posts\/\$\{postId\}\/\$\{target\}`, \{ replace: true \}\)/);
  // No shared-field editing UI is duplicated here.
  assert.doesNotMatch(detail, /useUpdateEditorialPostShared|useReplaceEditorialPostTopics/);
});

test("a post with zero translations gets a real recovery screen", () => {
  assert.match(detail, /post-no-translations-recovery/);
  assert.match(detail, /if \(target\) return null;/);
});

// ─── Editor: domain separation ───────────────────────────────────────────────

test("the editor wires all three independent save endpoints, each with its own button", () => {
  assert.match(editor, /useUpdateEditorialPostTranslation\(\)/);
  assert.match(editor, /useUpdateEditorialPostShared\(\)/);
  assert.match(editor, /useReplaceEditorialPostTopics\(\)/);
  for (const id of ["button-save-translation", "button-save-shared", "button-save-topics"]) {
    assert.match(editor, new RegExp(`data-testid="${id}"`), `missing ${id}`);
  }
});

test("each save clears ONLY its own dirty scope", () => {
  for (const scope of ["translation", "shared", "topics"]) {
    assert.match(editor, new RegExp(`dirty\\.clearScope\\("${scope}"\\)`), `missing clearScope for ${scope}`);
  }
  // There is no blanket clear on a single save path.
  assert.doesNotMatch(editor, /onSuccess: \(\) => \{[\s\S]{0,200}dirty\.reset\(\)/);
});

test("NO toast ever claims the whole post saved", () => {
  assert.doesNotMatch(editor, /"Post saved"/);
  assert.match(editor, /saveSuccessMessage\("translation"\)/);
  assert.match(editor, /saveSuccessMessage\("shared"\)/);
  assert.match(editor, /saveSuccessMessage\("topics"\)/);
});

test("channel is read-only with no write path on the editor", () => {
  assert.match(editor, /channel-badge/);
  assert.match(editor, /POST_CHANNEL_IMMUTABLE_EXPLANATION/);
  assert.doesNotMatch(editor, /setShared\(\(current\)[^)]*channel:/);
  assert.doesNotMatch(editor, /data: \{ channel/);
});

test("status never rides a PATCH — only the three dedicated transitions exist", () => {
  assert.match(editor, /usePublishEditorialPostTranslation\(\)/);
  assert.match(editor, /useArchiveEditorialPostTranslation\(\)/);
  assert.match(editor, /useRestoreEditorialPostTranslation\(\)/);
  assert.doesNotMatch(editorCode, /data: \{[^}]*status:/);
  // No invented control.
  assert.doesNotMatch(editorCode, /Unpublish/i);
  assert.doesNotMatch(editorCode, /select-post-status|status-dropdown/);
});

test("publishedAt and authorSnapshot are rendered read-only, never as inputs", () => {
  assert.match(editor, /data-testid="published-at"/);
  assert.match(editor, /data-testid="frozen-byline"/);
  assert.doesNotMatch(editor, /id="translation-published-at"/);
  assert.doesNotMatch(editor, /onChange=\{[^}]*authorSnapshot/);
});

// ─── Editor: RBAC ────────────────────────────────────────────────────────────

test("publish/archive/restore are gated on canPublish, SEPARATELY from canEdit", () => {
  assert.match(editor, /capabilities\.canPublish \? \(/);
  assert.match(editor, /disabled=\{readOnly \|\| !dirty\.flags\.translation/);
  // The publish branch must not be keyed on canEdit.
  assert.doesNotMatch(editor, /capabilities\.canEdit && [\s\S]{0,80}button-publish/);
  assert.match(editor, /no-publish-permission/);
});

test("an operator without edit permission gets a read-only editor, not a broken one", () => {
  assert.match(editor, /const readOnly = !capabilities\.canEdit;/);
  assert.match(editor, /read-only-notice/);
});

// ─── Editor: slug (D6) ───────────────────────────────────────────────────────

test("a published translation's slug renders read-only with the server's own explanation", () => {
  assert.match(editor, /isSlugLocked\(translationRow\)/);
  assert.match(editor, /slugLocked \? \([\s\S]{0,600}readOnly[\s\S]{0,400}SLUG_LOCKED_EXPLANATION/);
});

// ─── Editor: language switcher ───────────────────────────────────────────────

test("the language switcher is prominent navigation, not a buried field", () => {
  assert.match(editor, /<nav aria-label="Translations"/);
  assert.match(editor, /buildLanguageSlots\(/);
  assert.match(editor, /slotStateLabel\(slot\.state\)/);
  assert.doesNotMatch(editor, /<Select[\s\S]{0,200}id="language-switcher"/);
});

test("a missing translation in a retired language is disabled and explained", () => {
  assert.match(editor, /slot\.state === "missing-inactive"/);
  assert.match(editor, /INACTIVE_LANGUAGE_ADD_BLOCKED/);
});

test("an existing translation in a retired language stays editable and says so", () => {
  assert.match(editor, /inactive-language-edit-notice/);
  assert.match(editor, /INACTIVE_LANGUAGE_EDIT_NOTICE/);
  // It is never filtered out of the switcher.
  assert.doesNotMatch(editor, /slots\.filter\(\(slot\) => slot\.isActive\)/);
});

test("a language with no translation yet routes to a real Add-translation surface", () => {
  assert.match(editor, /AddTranslationScreen/);
  assert.match(editor, /useCreateEditorialPostTranslation\(\)/);
});

// ─── Editor: dirty state ─────────────────────────────────────────────────────

test("leaving the workspace with unsaved work routes through the shared confirm dialog", () => {
  assert.match(editor, /useAdminConfirm/);
  assert.match(editor, /const leaveGuard = [\s\S]{0,200}confirmAction/);
  assert.match(editor, /UNSAVED_LEAVE_CONFIRMATION/);
  assert.match(editor, /UNSAVED_LANGUAGE_SWITCH_CONFIRMATION/);
  // wouter is not patched.
  assert.doesNotMatch(editor, /history\.pushState\s*=/);
});

test("a language switch only warns about the TRANSLATION scope", () => {
  assert.match(editor, /if \(dirty\.flags\.translation && !\(await confirmAction/);
});

test("Cmd/Ctrl\\+S is bound to the translation save and gated on edit permission", () => {
  assert.match(editor, /useSaveShortcut\(dirty\.flags\.translation && capabilities\.canEdit, saveTranslation\)/);
});

test("there is NO autosave anywhere (D2)", () => {
  for (const [name, source] of ALL_PAGES_CODE) {
    assert.doesNotMatch(source, /setTimeout\([^)]*mutate/, name);
    assert.doesNotMatch(source, /useDebouncedValue\([^)]*\)[\s\S]{0,200}\.mutate\(/, name);
    assert.doesNotMatch(source, /autosave/i, name);
  }
  assert.match(editor, /Nothing is saved automatically\./);
});

test("an unsaved indicator and a scope-accurate summary are rendered", () => {
  assert.match(editor, /unsaved-indicator/);
  assert.match(editor, /unsaved-summary/);
  assert.match(editor, /\{dirty\.summary\}/);
});

// ─── Editor: publish card ────────────────────────────────────────────────────

test("the Publish card is the FIRST card in the sidebar", () => {
  const sidebar = editor.slice(editor.indexOf('aria-label="Post settings"'));
  const publishIndex = sidebar.indexOf('data-testid="publish-card"');
  for (const other of ["channel-card", "shared-card", "topics-card"]) {
    const index = sidebar.indexOf(`data-testid="${other}"`);
    assert.ok(index > publishIndex, `${other} must come after the publish card`);
  }
});

test("the readiness checklist is advisory and states the server has the final say", () => {
  assert.match(editor, /readiness-checklist/);
  assert.match(editor, /publishReadiness\(\{/);
  assert.match(editor, /READINESS_ADVISORY_NOTE/);
});

test("publish and archive-a-published-translation are confirmed; restore and update are not", () => {
  assert.match(editor, /publishConfirmation\(/);
  assert.match(editor, /translationRow\.status === "published"[\s\S]{0,200}archivePublishedConfirmation/);
  assert.match(editor, /const handleRestore = \(\) =>\s*runTransition\(\s*restore,/);
  // The ordinary save has no confirmation.
  assert.doesNotMatch(editor, /confirmAction[\s\S]{0,120}saveTranslation/);
});

test("server rejections are shown as a persistent inline alert, not only as a toast", () => {
  for (const id of ["translation-error-alert", "shared-error-alert", "topics-error-alert"]) {
    assert.match(editor, new RegExp(`data-testid="${id}"`), `missing ${id}`);
  }
  assert.match(editor, /role="alert"/);
});

// ─── Editor: feature image / topics / author ─────────────────────────────────

test("the feature image card labels the shared URL and the per-language alt distinctly", () => {
  assert.match(editor, /SHARED_ACROSS_LANGUAGES_LABEL/);
  assert.match(editor, /TRANSLATION_SPECIFIC_LABEL/);
  assert.match(editor, /input-feature-image-url/);
  assert.match(editor, /input-translation-feature-alt/);
});

test("changing the shared image warns accurately — it does NOT rewrite any alt text", () => {
  assert.match(editor, /feature-image-alt-notice/);
  assert.match(editor, /does not change any language's alt text/);
  // No client-side mutation of another language's alt.
  assert.doesNotMatch(editor, /featureImageAlt: ""[\s\S]{0,80}featureImageUrl/);
});

test("topics send the complete desired set (full replace), never a delta", () => {
  assert.match(editor, /toTopicsPayload\(topicIds\)/);
  assert.doesNotMatch(editor, /addTopic|removeTopicRequest|topicDelta/);
});

test("an archived-but-assigned author or topic still renders, disabled", () => {
  assert.match(editor, /assigned && assigned\.status !== "active" \? \[assigned, \.\.\.selectable\]/);
  assert.match(editor, /disabled=\{author\.status !== "active"\}/);
  assert.match(editor, /topic\.status !== "active" && <span className="opacity-70">\(archived\)<\/span>/);
});

test("systemUserId is never exposed on any Posts screen", () => {
  for (const [name, source] of ALL_PAGES_CODE) {
    assert.doesNotMatch(source, /systemUserId/, name);
  }
});

test("both pickers have actionable, permission-aware empty states", () => {
  assert.match(editor, /no-authors-empty-state/);
  assert.match(editor, /no-topics-empty-state/);
  assert.match(editor, /href="\/editorial\/authors"/);
  assert.match(editor, /href="\/editorial\/topics"/);
});

// ─── Editor: SEO + read time ─────────────────────────────────────────────────

test("SEO is a collapsible section using the real field names, with no invented limits", () => {
  assert.match(editor, /<Collapsible/);
  assert.match(editor, /input-translation-seo-title/);
  assert.match(editor, /input-translation-seo-description/);
  assert.match(editor, /input-translation-og-image/);
  assert.match(editor, /the Admin invents no fallback of its own/);
  assert.doesNotMatch(editor, /maxLength=\{(60|70|155|160)\}/);
});

test("read time is EDITABLE because the contract genuinely supports writing it", () => {
  assert.match(editor, /input-translation-read-time/);
  assert.match(editor, /readingTimeError\(/);
  // Editable, not a rendered-read-only field: it has an onChange and no
  // readOnly attribute (the only `readOnly` on the page is the locked slug).
  assert.match(editor, /id="translation-read-time"[\s\S]{0,400}onChange=/);
  // No bare `readOnly` JSX attribute on it (the only one on the page is the
  // locked slug). `disabled={readOnly}` is the permission gate, not a
  // server-derived-field gate.
  assert.doesNotMatch(editor, /id="translation-read-time"[\s\S]{0,400}\n\s+readOnly\n/);
});

// ─── Body editor ─────────────────────────────────────────────────────────────

test("the body editor is per-type cards, never a raw JSON textarea", () => {
  assert.doesNotMatch(bodyEditor, /JSON\.stringify|JSON\.parse/);
  assert.match(bodyEditor, /BLOCK_TYPE_DEFINITIONS\.map/);
  for (const id of ["input-block-text-", "input-block-url-", "input-block-alt-", "input-block-item-"]) {
    assert.match(bodyEditor, new RegExp(id), `missing field ${id}`);
  }
});

test("all FIVE block types are offered — Quote shipped in Final Editorial Phase A", () => {
  // Wave 2.1D deferred Quote and this test pinned its absence. Phase A
  // implemented it through the documented extension path, so the assertion
  // inverts: Quote must now be a real, editable card, and the file must still
  // document how a SIXTH type would be added.
  assert.match(bodyEditorCode, /case "quote":/);
  assert.match(bodyEditorCode, /input-block-attribution-\$\{index\}/);
  assert.match(bodyEditorCode, /input-block-attribution-role-\$\{index\}/);
  assert.match(bodyEditor, /A SIXTH type/i);
  // Quote reuses existing primitives; it introduced no new design pattern.
  assert.doesNotMatch(bodyEditorCode, /dangerouslySetInnerHTML/);
});

test("insert controls disable at the real caps", () => {
  assert.match(bodyEditor, /disabled=\{disabled \|\| !canAddBlock\(blocks, definition\.type\)\}/);
  assert.match(bodyEditor, /body-block-count/);
  assert.match(bodyEditor, /body-image-count/);
});

test("move buttons carry descriptive aria-labels and disable at the ends", () => {
  assert.match(bodyEditor, /aria-label=\{moveUpLabel\(index, block\.type\)\}/);
  assert.match(bodyEditor, /aria-label=\{moveDownLabel\(index, block\.type\)\}/);
  assert.match(bodyEditor, /disabled=\{disabled \|\| index === 0\}/);
  assert.match(bodyEditor, /disabled=\{disabled \|\| index === blocks\.length - 1\}/);
});

test("focus moves after an insert and after a delete", () => {
  assert.match(bodyEditor, /pendingFocus\.current = blockFieldId\(created\.key, firstFieldOf\(type\)\)/);
  assert.match(bodyEditor, /focusIndexAfterDelete\(index, next\.length\)/);
  assert.match(bodyEditor, /"post-body-add-paragraph"/);
});

test("there is no drag-and-drop anywhere", () => {
  assert.doesNotMatch(bodyEditorCode, /dnd-kit|react-beautiful-dnd|draggable=|onDragStart/i);
});

test("image blocks require alt and reuse the Authors allowlist-hint pattern", () => {
  assert.match(bodyEditor, /Every image block needs alt text|Required on every image/);
  assert.match(bodyEditor, /picsum\.photos, images\.unsplash\.com/);
  assert.match(bodyEditor, /block-image-preview-/);
});

test("list item removal disables at the server minimum", () => {
  assert.match(bodyEditor, /disabled=\{disabled \|\| block\.items\.length <= MIN_LIST_ITEMS\}/);
  assert.match(bodyEditor, /disabled=\{disabled \|\| block\.items\.length >= MAX_LIST_ITEMS\}/);
});

// ─── Cache strategy ──────────────────────────────────────────────────────────

test("every invalidation names a specific key — no global invalidateQueries()", () => {
  for (const [name, source] of ALL_PAGES_CODE) {
    assert.doesNotMatch(source, /invalidateQueries\(\)/, `${name} must not invalidate globally`);
    assert.doesNotMatch(source, /invalidateQueries\(\{\s*\}\)/, name);
  }
});

test("the editor never invalidates the shared reference-data caches", () => {
  assert.doesNotMatch(editorCode, /getListEditorialAuthorsQueryKey|getListEditorialTopicsQueryKey|getListEditorialLanguagesQueryKey/);
  assert.match(editor, /Reference data is NOT invalidated/);
});

test("reference data is read through the shared hook, never re-fetched per component", () => {
  for (const [, source] of ALL_PAGES_CODE) {
    assert.doesNotMatch(source, /useListEditorialAuthors\(|useListEditorialTopics\(|useListEditorialLanguages\(/);
  }
  assert.match(editor, /useEditorialReferenceData\(\)/);
});

// ─── Deferred scope ──────────────────────────────────────────────────────────

/**
 * Wave 2.1E BUILT revisions + restore and recommended reading, so the 2.1D
 * "not yet" assertion narrows rather than disappears: PLACEMENTS are still
 * deferred, and the two capabilities that did land are pinned to the ONE page
 * that owns them.
 */
test("placements are still deferred, and 2.1E's surfaces live only in the editor", () => {
  for (const [name, source] of ALL_PAGES_CODE) {
    assert.doesNotMatch(source, /useListEditorialPlacements|useReplaceEditorialPlacements|PlacementCard/, name);
    // "Related posts" is the wrong domain name and must never appear: the
    // relation is directional and the editor term is "Recommended reading".
    assert.doesNotMatch(source, /RelatedPosts/, name);
    if (name === "editor") continue;
    assert.doesNotMatch(source, /useListEditorialPostRevisions|useGetEditorialPostRevision|useRestoreEditorialPostRevision/, name);
    assert.doesNotMatch(source, /useReplaceEditorialPostRecommendations/, name);
    assert.doesNotMatch(source, /RevisionHistory|RecommendationsCard/, name);
  }
  // The editor mounts the drawer and the card, and NOTHING mounts the
  // standalone recommendations GET — the post detail already carries it.
  assert.match(editorCode, /RevisionHistoryDrawer/);
  assert.match(editorCode, /RecommendationsCard/);
  assert.doesNotMatch(editorCode, /useListEditorialPostRecommendations/);
});

// ─── Responsive ──────────────────────────────────────────────────────────────

test("the editor is two-column on desktop and stacks sidebar-first", () => {
  assert.match(editor, /lg:grid lg:grid-cols-\[minmax\(0,1fr\)_20rem\]/);
  assert.match(editor, /lg:order-2/, "the sidebar takes column 2 on desktop");
  assert.match(editor, /lg:order-1/, "the canvas takes column 1 on desktop");
  assert.match(editor, /lg:sticky lg:top-4/);
});

test("tables stay inside a horizontal-scroll container rather than widening the page", () => {
  assert.match(list, /<div className="border rounded-md overflow-x-auto">/);
});

// ─── Frozen byline / author reassignment (release-blocker regression) ────────

test("the frozen byline renders the shared constant, never inline prose", () => {
  assert.match(editor, /data-testid="frozen-byline-explanation"/);
  assert.match(editorCode, /\{FROZEN_BYLINE_EXPLANATION\}/);
  // The old, wrong sentence must never come back in any form.
  assert.doesNotMatch(editor, /on the next publish/i);
  assert.doesNotMatch(editor, /next publish|re-?publish|future publication/i);
});

test("a shared save that reassigns the author on a live post is confirmed", () => {
  assert.match(editorCode, /const authorChanged = shared\.authorId !== sharedBaseline\.authorId/);
  // Derived from the post's OWN translations, never from the Languages
  // reference query — see the C tests below and in editorialPosts.test.ts.
  assert.match(editorCode, /const liveLanguages = publishedLanguageLabels;/);
  assert.match(
    editorCode,
    /if \(authorChanged && liveLanguages\.length > 0\)[\s\S]{0,200}confirmAction\(authorReassignmentConfirmation/,
    "the confirmation must be gated on BOTH an actual author change and at least one live language",
  );
  // Same useAdminConfirm hook as publish and archive — no bespoke dialog.
  assert.match(editorCode, /const confirmAction = useAdminConfirm\(\)/);
});

test("the shared save invalidates every cached language of THIS post when the author changes", () => {
  assert.match(editorCode, /const invalidateShared = useCallback\(\(authorChanged: boolean\) =>/);
  assert.match(
    editorCode,
    /if \(authorChanged\) \{[\s\S]{0,220}predicate: \(query\) => isEditorialPostTranslationKey\(postId, query\.queryKey\)/,
    "the translation-wide invalidation must run, and only on an author change",
  );
  assert.match(editorCode, /invalidateShared\(authorChanged\)/);
});

test("the shared invalidation is narrow — never global, never other posts", () => {
  assert.doesNotMatch(editorCode, /invalidateQueries\(\)/);
  assert.doesNotMatch(editorCode, /invalidateQueries\(\{\s*\}\)/);
  assert.doesNotMatch(editorCode, /queryClient\.clear\(\)|removeQueries\(\)|resetQueries\(\)/);
  assert.doesNotMatch(editorCode, /refetchQueries/);
  // Reference data (authors list) is still spared by the shared save.
  assert.doesNotMatch(editorCode, /getListEditorialAuthorsQueryKey/);
});

test("the shared save cannot clobber unsaved translation work", () => {
  // The re-baseline effect is keyed on the translation row IDENTITY, so the
  // refetch triggered above returns the same id and the effect does not run.
  assert.match(editorCode, /\}, \[translationRow\?\.id\]\);/);
  assert.doesNotMatch(editorCode, /\}, \[translationRow\]\);/);
  // And the shared mutation's own success handler touches no translation state.
  const sharedSuccess =
    /updateShared\.mutate\([\s\S]*?onSuccess: \(saved\) => \{([\s\S]*?)\},\s*onError/.exec(editorCode);
  assert.ok(sharedSuccess, "the shared mutation's onSuccess handler was not found");
  const body = sharedSuccess![1]!;
  assert.doesNotMatch(body, /setForm\(|setBaseline\(|setTopicIds\(|setTopicBaseline\(|setSlugTouched\(/);
});

test("the shared save clears the shared scope only", () => {
  const sharedSuccess =
    /updateShared\.mutate\([\s\S]*?onSuccess: \(saved\) => \{([\s\S]*?)\},\s*onError/.exec(editorCode);
  const body = sharedSuccess![1]!;
  assert.match(body, /dirty\.clearScope\("shared"\)/);
  assert.doesNotMatch(body, /clearScope\("translation"\)/);
  assert.doesNotMatch(body, /clearScope\("topics"\)/);
  assert.doesNotMatch(body, /clearAll|resetAll/);
});

// ─── Final pre-PR hardening: A, B, C, D wired into the screen ───────────────

test("A: the read-time error BLOCKS the save — it is no longer display-only", () => {
  const save = /const saveTranslation = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(editorCode);
  assert.ok(save, "saveTranslation was not found");
  const body = save![1]!;
  const gate = body.indexOf("readingTimeError(");
  const request = body.indexOf("updateTranslation.mutate(");
  assert.notEqual(gate, -1, "saveTranslation must consult readingTimeError");
  assert.notEqual(request, -1);
  assert.ok(gate < request, "the read-time gate must run BEFORE the PATCH is issued");
  // And it must actually return, not merely compute.
  assert.match(body, /if \(readTimeProblem\) \{[\s\S]{0,200}?return;/);
  assert.match(body, /setTranslationError\(`Reading time override: \$\{readTimeProblem\}`\)/);
});

test("A: the inline message is still rendered on the field itself", () => {
  assert.match(editor, /read-time-message/);
  assert.match(editor, /readingTimeError\(form\.readingTimeOverrideMinutes\)/);
});

test("B: failure titles are PASSED IN, never derived from the success title", () => {
  assert.doesNotMatch(
    editorCode,
    /successTitle\.replace/,
    "string surgery produced 'Archiv failed' and left a failed Restore success-sounding",
  );
  assert.match(editorCode, /failureTitle: string/);
  assert.match(editorCode, /toast\(\{ title: failureTitle,[\s\S]{0,120}variant: "destructive" \}\)/);
  for (const key of ["publish", "archive", "restore"]) {
    assert.match(
      editorCode,
      new RegExp(`TRANSITION_FAILURE_TITLES\\.${key}`),
      `${key} must pass its own failure title`,
    );
    assert.match(editorCode, new RegExp(`TRANSITION_SUCCESS_TITLES\\.${key}`));
  }
  // No transition still hard-codes a success-sounding literal.
  assert.doesNotMatch(editorCode, /runTransition\([\s\S]{0,80}"Restored to draft",\s*`?\w/);
});

test("B: a rejected transition changes no local state and clears no dirty flag", () => {
  const onError = /const runTransition =[\s\S]*?onError: \(err: unknown\) => \{([\s\S]*?)\},\s*\n\s*\},/.exec(editorCode);
  assert.ok(onError, "runTransition's onError was not found");
  const body = onError![1]!;
  assert.match(body, /setTranslationError\(/);
  assert.doesNotMatch(body, /setForm\(|setBaseline\(|setShared\(|setTopicIds\(|setFormRowId\(/);
  assert.doesNotMatch(body, /clearScope|dirty\./);
  assert.doesNotMatch(body, /invalidate/);
});

test("C: the live-byline confirmation is NOT derived from the Languages query", () => {
  // The gate must read the post's own translations, not the reference-data
  // -derived slots.
  assert.match(editorCode, /publishedTranslationLanguageLabels\(\s*post\.data\?\.translations \?\? \[\]/);
  assert.doesNotMatch(
    editorCode,
    /publishedLanguageNames\(slots\)/,
    "slots collapse to [] when the Languages query fails, silently skipping the warning",
  );
  assert.match(editorCode, /const liveLanguages = publishedLanguageLabels;/);
  assert.match(editorCode, /authorChanged && liveLanguages\.length > 0/);
});

test("C: a Languages failure is stated, not silently rendered as an empty box", () => {
  assert.match(editorCode, /reference\.languages\.isError/);
  assert.match(editor, /languages-reference-error/);
  assert.match(editorCode, /LANGUAGES_REFERENCE_UNAVAILABLE/);
  assert.match(editorCode, /role="alert"[\s\S]{0,160}languages-reference-error/);
});

test("D: the switch guard covers the translation scope only, which is now accurate", () => {
  const fn = /const switchLanguage = async \(code: string\) => \{([\s\S]*?)\n  \};/.exec(editorCode);
  assert.ok(fn, "switchLanguage was not found");
  const body = fn![1]!;
  assert.match(body, /dirty\.flags\.translation/);
  assert.doesNotMatch(body, /dirty\.anyDirty/);
  assert.match(body, /UNSAVED_LANGUAGE_SWITCH_CONFIRMATION/);
  // Switching must never clear the post-level scopes.
  assert.doesNotMatch(body, /clearScope\("shared"\)|clearScope\("topics"\)/);
});

test("D: no cross-language flash — the form must belong to the row being rendered", () => {
  assert.match(editorCode, /const \[formRowId, setFormRowId\] = useState<number \| null>\(null\)/);
  // Wave 2.1E moved the body of the re-baseline effect into
  // rebaselineTranslation(row) so the restore mutation can reuse it from its
  // own response; the guard itself is unchanged.
  assert.match(editorCode, /setFormRowId\(row\.id\)/);
  assert.match(editorCode, /rebaselineTranslation\(translationRow\)/);
  assert.match(editorCode, /formRowId !== translationRow\.id/);
});

test("D: the post-level re-baseline effect is still keyed on the POST, not the language", () => {
  assert.match(editorCode, /\}, \[postRow\?\.id\]\);/);
  assert.doesNotMatch(editorCode, /\}, \[postRow\?\.id, languageCode\]\);/);
});
