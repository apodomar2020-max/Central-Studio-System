/**
 * Finding D — a language switch must not destroy post-level form state.
 *
 * ROOT CAUSE, found in App.tsx's Layout: the Admin 2.0 page-entrance wrapper
 * was `<div key={location} className="admin2-route-enter">`. `location` is
 * the raw wouter path, so changing ANY character of it — including the
 * `:languageCode` parameter of `/editorial/posts/:id/:languageCode` —
 * unmounted and remounted the whole route subtree. `EditorialPostTranslation-
 * Page` therefore lost ALL of its `useState` on a language switch, including
 * the `shared` (author + feature image) and `topicIds` state, which are
 * POST-level: they are saved through post-level endpoints and have nothing
 * to do with which language is open. The editor's own switch guard only
 * warns about the translation scope, so those edits were destroyed silently.
 *
 * This file pins the key derivation, and simulates the full dirty-scope
 * matrix across a switch under both the old and the new key.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { IN_PAGE_SUB_VIEW_ROUTES, routeEntranceKey } from "./route-entrance.ts";
import {
  DIRTY_SCOPES,
  UNSAVED_LANGUAGE_SWITCH_CONFIRMATION,
  UNSAVED_LEAVE_CONFIRMATION,
  type DirtyFlags,
} from "./editorial-post-dirty.ts";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

// ─── The key itself ─────────────────────────────────────────────────────────

test("D: switching language does NOT change the entrance key (so nothing remounts)", () => {
  // FAILS under the old behaviour, where the key WAS the location.
  assert.equal(
    routeEntranceKey("/editorial/posts/7/en"),
    routeEntranceKey("/editorial/posts/7/ar"),
  );
  assert.equal(routeEntranceKey("/editorial/posts/7/en"), "/editorial/posts/7");
});

test("D: a different POST is still a real navigation", () => {
  assert.notEqual(
    routeEntranceKey("/editorial/posts/7/en"),
    routeEntranceKey("/editorial/posts/8/en"),
  );
});

test("D: every other route is keyed by the location verbatim — no animation change", () => {
  for (const location of [
    "/",
    "/editorial/posts",
    "/editorial/posts/new",
    "/editorial/posts/7",
    "/editorial/authors",
    "/editorial/topics",
    "/settings/website/languages",
    "/students/42",
    "/editorial/posts/7/en/revisions",
    "/editorial/posts/abc/en",
  ]) {
    assert.equal(routeEntranceKey(location), location, `${location} must be keyed verbatim`);
  }
});

test("D: the collapse is opt-in per route prefix, and only for /editorial/posts today", () => {
  assert.deepEqual([...IN_PAGE_SUB_VIEW_ROUTES], ["/editorial/posts"]);
});

test("D: App.tsx keys the entrance wrapper by the derived key, not by location", () => {
  assert.match(app, /routeEntranceKey\(location\)/);
  assert.match(app, /<div key=\{entranceKey\} className="admin2-route-enter">/);
  assert.doesNotMatch(
    app,
    /<div key=\{location\} className="admin2-route-enter">/,
    "the raw-location key is what destroyed post-level state on a language switch",
  );
});

// ─── The dirty-scope matrix across a language switch ────────────────────────
//
// A `.tsx` page cannot be mounted here (no jsdom / testing-library in this
// repo), so the two behaviours are modelled exactly as the code implements
// them: a remount zeroes every scope's state; no remount preserves the two
// post-level scopes, while the translation scope is re-baselined by the
// effect keyed on the new translation row id.

interface EditorState {
  flags: DirtyFlags;
  sharedDraft: string | null;
  topicsDraft: readonly number[] | null;
}

const CLEAN_SERVER_SHARED = "author:3";
const CLEAN_SERVER_TOPICS: readonly number[] = [1];

/** What the OLD raw-location key did: full unmount, all state re-created. */
function switchLanguageWithRemount(_before: EditorState): EditorState {
  return {
    flags: { translation: false, shared: false, topics: false },
    sharedDraft: CLEAN_SERVER_SHARED,
    topicsDraft: CLEAN_SERVER_TOPICS,
  };
}

/**
 * What the page does now. The component stays mounted, so:
 *  - `shared` / `topicIds` state and their dirty flags are untouched (their
 *    re-baseline effect is keyed on `postRow?.id`, which did not change),
 *  - the translation form re-baselines against the new row and its scope
 *    clears, which is the ONLY thing a language switch legitimately drops.
 */
function switchLanguageWithoutRemount(before: EditorState): EditorState {
  return {
    flags: { ...before.flags, translation: false },
    sharedDraft: before.sharedDraft,
    topicsDraft: before.topicsDraft,
  };
}

const MATRIX: Array<{ name: string; flags: DirtyFlags }> = [
  { name: "1 translation only", flags: { translation: true, shared: false, topics: false } },
  { name: "2 shared only", flags: { translation: false, shared: true, topics: false } },
  { name: "3 topics only", flags: { translation: false, shared: false, topics: true } },
  { name: "4 translation + shared", flags: { translation: true, shared: true, topics: false } },
  { name: "5 translation + topics", flags: { translation: true, shared: false, topics: true } },
  { name: "6 shared + topics", flags: { translation: false, shared: true, topics: true } },
  { name: "7 all three", flags: { translation: true, shared: true, topics: true } },
  { name: "8 nothing dirty", flags: { translation: false, shared: false, topics: false } },
];

const dirtyState = (flags: DirtyFlags): EditorState => ({
  flags,
  sharedDraft: flags.shared ? "author:9" : CLEAN_SERVER_SHARED,
  topicsDraft: flags.topics ? [1, 4] : CLEAN_SERVER_TOPICS,
});

test("D: the OLD remount discarded shared/topics edits in 6 of the 8 combinations", () => {
  const lost = MATRIX.filter((row) => {
    const after = switchLanguageWithRemount(dirtyState(row.flags));
    return (row.flags.shared && !after.flags.shared) || (row.flags.topics && !after.flags.topics);
  });
  assert.deepEqual(lost.map((row) => row.name), [
    "2 shared only",
    "3 topics only",
    "4 translation + shared",
    "5 translation + topics",
    "6 shared + topics",
    "7 all three",
  ]);
});

test("D: post-level scopes survive a language switch in every combination", () => {
  for (const row of MATRIX) {
    const before = dirtyState(row.flags);
    const after = switchLanguageWithoutRemount(before);

    assert.equal(after.flags.shared, row.flags.shared, `${row.name}: shared dirty flag changed`);
    assert.equal(after.flags.topics, row.flags.topics, `${row.name}: topics dirty flag changed`);
    assert.equal(after.sharedDraft, before.sharedDraft, `${row.name}: shared draft lost`);
    assert.deepEqual(after.topicsDraft, before.topicsDraft, `${row.name}: topics draft lost`);

    // The translation scope is the one thing a language switch drops — and
    // it is the one thing the switch guard warns about.
    assert.equal(after.flags.translation, false, `${row.name}: translation must re-baseline`);
  }
});

test("D: discarding the translation via the guard does NOT clear the other scopes", () => {
  const before = dirtyState({ translation: true, shared: true, topics: true });
  const after = switchLanguageWithoutRemount(before);
  assert.deepEqual(after.flags, { translation: false, shared: true, topics: true });
  assert.equal(after.sharedDraft, "author:9");
  assert.deepEqual(after.topicsDraft, [1, 4]);
});

// ─── The guard copy must match what actually happens ────────────────────────

test("D: the language-switch copy names only the translation scope as lost", () => {
  const { description, title } = UNSAVED_LANGUAGE_SWITCH_CONFIRMATION;
  assert.match(title, /Switch language/);
  assert.match(description, /changes to this language/i);
  assert.match(
    description,
    /Shared settings and topics are unaffected/,
    "this claim is only true now that the page no longer remounts",
  );
  // It must not make the generic "everything is discarded" claim.
  assert.doesNotMatch(description, /This page has changes/);
});

test("D: the full-leave copy stays generic, because leaving DOES lose every scope", () => {
  assert.match(UNSAVED_LEAVE_CONFIRMATION.description, /Leaving now discards them/);
  assert.equal(DIRTY_SCOPES.length, 3);
});
