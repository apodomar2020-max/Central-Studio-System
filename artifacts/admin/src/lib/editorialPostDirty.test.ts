/**
 * Wave 2.1D — dirty-state scopes, leave confirmations and the truthful
 * scoped-save messaging.
 *
 * The pure module is exercised for real. The React hook that wraps it
 * (`hooks/use-dirty-state.ts`) imports React and therefore cannot be loaded
 * by node:test, so its behaviour is asserted by source inspection — the same
 * split `hooks/useEditorialReferenceData.test.ts` established in Wave 2.1A.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DIRTY_SCOPES,
  NO_DIRTY_SCOPES,
  SCOPE_LABELS,
  UNSAVED_INDICATOR_LABEL,
  UNSAVED_LANGUAGE_SWITCH_CONFIRMATION,
  UNSAVED_LEAVE_CONFIRMATION,
  anyDirtyFrom,
  describeDirtyScopes,
  describePartialSave,
  saveFailureTitle,
  saveSuccessMessage,
  type DirtyFlags,
} from "./editorial-post-dirty.ts";

const hook = readFileSync(new URL("../hooks/use-dirty-state.ts", import.meta.url), "utf8");

// ─── Scopes ──────────────────────────────────────────────────────────────────

test("there is one scope per independent save endpoint — no more, no fewer", () => {
  assert.deepEqual([...DIRTY_SCOPES], ["translation", "shared", "topics"]);
  assert.deepEqual(Object.keys(NO_DIRTY_SCOPES).sort(), ["shared", "topics", "translation"]);
  assert.equal(anyDirtyFrom(NO_DIRTY_SCOPES), false);
});

test("anyDirty is true when ANY single scope is dirty", () => {
  for (const scope of DIRTY_SCOPES) {
    const flags = { ...NO_DIRTY_SCOPES, [scope]: true } as DirtyFlags;
    assert.equal(anyDirtyFrom(flags), true, `${scope} must raise anyDirty`);
  }
});

test("the unsaved summary names exactly which scopes are outstanding", () => {
  assert.equal(describeDirtyScopes(NO_DIRTY_SCOPES), null);
  assert.equal(
    describeDirtyScopes({ ...NO_DIRTY_SCOPES, translation: true }),
    "Unsaved changes in this language.",
  );
  assert.equal(
    describeDirtyScopes({ translation: true, shared: false, topics: true }),
    "Unsaved changes in this language and topics.",
  );
  assert.equal(
    describeDirtyScopes({ translation: true, shared: true, topics: true }),
    "Unsaved changes in this language, shared settings and topics.",
  );
  assert.equal(UNSAVED_INDICATOR_LABEL, "Unsaved changes");
});

test("each scope has a human label used in that summary", () => {
  for (const scope of DIRTY_SCOPES) assert.ok(SCOPE_LABELS[scope].length > 0);
});

// ─── Truthful save reporting ─────────────────────────────────────────────────

test("NO message ever claims the whole post saved", () => {
  for (const scope of DIRTY_SCOPES) {
    const message = saveSuccessMessage(scope);
    assert.doesNotMatch(message, /^Post saved/);
    assert.doesNotMatch(message, /everything|all changes/i);
  }
  assert.match(saveSuccessMessage("shared"), /Other languages are unaffected/);
});

test("each scope has its own failure title, so a toast names what did not save", () => {
  const titles = new Set(DIRTY_SCOPES.map((scope) => saveFailureTitle(scope)));
  assert.equal(titles.size, DIRTY_SCOPES.length);
});

test("a partial multi-scope save reports BOTH what saved and what did not", () => {
  assert.equal(
    describePartialSave([{ scope: "translation", ok: true }, { scope: "topics", ok: false }]),
    "Saved: this language. NOT saved: topics.",
  );
  assert.equal(
    describePartialSave([{ scope: "translation", ok: true }, { scope: "shared", ok: true }]),
    "Saved: this language, shared settings.",
  );
  assert.equal(
    describePartialSave([{ scope: "translation", ok: false }]),
    "Nothing was saved. Failed: this language.",
  );
});

// ─── Leave confirmations ─────────────────────────────────────────────────────

test("the leave confirmation is honest that nothing is kept in the background (D2 — no autosave)", () => {
  assert.match(UNSAVED_LEAVE_CONFIRMATION.description, /nothing is kept as a draft in the background/);
  assert.equal(UNSAVED_LEAVE_CONFIRMATION.destructive, true);
});

test("the language-switch confirmation says shared scopes are unaffected", () => {
  assert.match(UNSAVED_LANGUAGE_SWITCH_CONFIRMATION.description, /Shared settings and topics are unaffected/);
});

// ─── Hook behaviour (source-inspected) ───────────────────────────────────────

test("beforeunload is registered ONLY while something is dirty, and removed again", () => {
  assert.match(hook, /if \(!anyDirty\) return undefined;[\s\S]{0,400}addEventListener\("beforeunload"/);
  assert.match(hook, /removeEventListener\("beforeunload", handler\)/);
});

test("clearScope clears exactly one scope — a failed save leaves its scope dirty", () => {
  assert.match(hook, /const clearScope = useCallback\(\(scope: DirtyScope\) => \{[\s\S]{0,200}\[scope\]: false/);
  assert.match(hook, /Clear everything — only on a full reload of the editor's data/);
});

test("Cmd/Ctrl+S saves the translation scope and can NEVER publish", () => {
  const shortcut = hook.slice(hook.indexOf("export function useSaveShortcut"));
  assert.match(shortcut, /metaKey \|\| event\.ctrlKey/);
  assert.match(shortcut, /preventDefault\(\)/);
  assert.doesNotMatch(shortcut, /publish/i);
  assert.match(hook, /never to Publish/);
});

test("the router is NOT monkey-patched — wouter has no blocker and none is faked", () => {
  assert.doesNotMatch(hook, /history\.pushState\s*=/);
  assert.doesNotMatch(hook, /popstate/);
  assert.match(hook, /useAdminConfirm/, "in-app leaves must route through the existing confirm dialog");
});

test("this is genuinely new infrastructure — the audit of prior precedent is recorded", () => {
  assert.match(hook, /returned NOTHING before this file/);
});
