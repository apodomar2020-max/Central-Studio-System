/**
 * editorial-post-dirty — the PURE half of the Post Editor's unsaved-change
 * tracking (Wave 2.1D).
 *
 * Split out of `hooks/use-dirty-state.ts` for the reason every other Admin
 * module is: a file that imports React cannot be loaded by
 * `node --test --experimental-strip-types` and can only be source-inspected.
 * The scope model, the leave copy and the truthful save messaging are the
 * parts a reviewer most needs pinned, so they live here where they are
 * exercised for real.
 *
 * WHY SCOPES, NOT ONE FLAG (D2 + the scoped save model): the Post Editor
 * writes through THREE independent endpoints —
 *   translation -> PATCH /posts/:id/translations/:code
 *   shared      -> PATCH /posts/:id            (author + feature image URL)
 *   topics      -> PUT   /posts/:id/topics
 *   recommendations -> PUT /posts/:id/recommendations   (Wave 2.1E)
 * Each can succeed or fail on its own. One global flag would either clear on
 * a partial success (losing the record that topics never saved) or stay set
 * after a successful translation save. So each scope owns its own flag, each
 * clears ONLY on its own success, and a failed save leaves its scope dirty.
 */

export type DirtyScope = "translation" | "shared" | "topics" | "recommendations";

export const DIRTY_SCOPES: readonly DirtyScope[] = [
  "translation",
  "shared",
  "topics",
  "recommendations",
];

export type DirtyFlags = Record<DirtyScope, boolean>;

export const NO_DIRTY_SCOPES: DirtyFlags = {
  translation: false,
  shared: false,
  topics: false,
  recommendations: false,
};

/** The exact wording of the in-app leave confirmation. */
export const UNSAVED_LEAVE_CONFIRMATION = {
  title: "Leave without saving?",
  description:
    "This page has changes that have not been saved. Leaving now discards them — nothing is kept as a draft in the background.",
  confirmLabel: "Discard changes",
  destructive: true,
} as const;

export const UNSAVED_LANGUAGE_SWITCH_CONFIRMATION = {
  title: "Switch language without saving?",
  description:
    "The changes to this language have not been saved. Switching now discards them. Shared settings, topics and recommended posts are unaffected.",
  confirmLabel: "Discard and switch",
  destructive: true,
} as const;

export const UNSAVED_INDICATOR_LABEL = "Unsaved changes";

/** Human names used in the unsaved summary. */
export const SCOPE_LABELS: Record<DirtyScope, string> = {
  translation: "this language",
  shared: "shared settings",
  topics: "topics",
  recommendations: "recommended posts",
};

/**
 * "Unsaved changes in this language and topics." — truthful about WHICH
 * scopes are outstanding, so a partial save is never reported as a whole one.
 */
export function describeDirtyScopes(flags: DirtyFlags): string | null {
  const names = DIRTY_SCOPES.filter((scope) => flags[scope]).map((scope) => SCOPE_LABELS[scope]);
  if (names.length === 0) return null;
  if (names.length === 1) return `Unsaved changes in ${names[0]}.`;
  const last = names[names.length - 1];
  return `Unsaved changes in ${names.slice(0, -1).join(", ")} and ${last}.`;
}

export function anyDirtyFrom(flags: DirtyFlags): boolean {
  return DIRTY_SCOPES.some((scope) => flags[scope]);
}

// ─── Scoped save reporting ───────────────────────────────────────────────────

export type SaveOutcome = "idle" | "saving" | "saved" | "failed";

/**
 * The truthful message for ONE scope's save. Never "Post saved" — three
 * endpoints, three answers, and claiming all of them succeeded when one did
 * is exactly the failure mode this model exists to prevent.
 */
export function saveSuccessMessage(scope: DirtyScope): string {
  switch (scope) {
    case "translation": return "This language's content was saved.";
    case "shared": return "Shared settings were saved. Other languages are unaffected.";
    case "topics": return "Topics were saved.";
    case "recommendations": return "Recommended posts were saved.";
  }
}

export function saveFailureTitle(scope: DirtyScope): string {
  switch (scope) {
    case "translation": return "This language's content was not saved";
    case "shared": return "Shared settings were not saved";
    case "topics": return "Topics were not saved";
    case "recommendations": return "Recommended posts were not saved";
  }
}

/**
 * When several scopes are saved in one gesture, report each result rather
 * than one aggregate verdict.
 */
export function describePartialSave(
  results: ReadonlyArray<{ scope: DirtyScope; ok: boolean }>,
): string {
  const saved = results.filter((result) => result.ok).map((result) => SCOPE_LABELS[result.scope]);
  const failed = results.filter((result) => !result.ok).map((result) => SCOPE_LABELS[result.scope]);
  if (failed.length === 0) return `Saved: ${saved.join(", ")}.`;
  if (saved.length === 0) return `Nothing was saved. Failed: ${failed.join(", ")}.`;
  return `Saved: ${saved.join(", ")}. NOT saved: ${failed.join(", ")}.`;
}
