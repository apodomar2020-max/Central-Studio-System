/**
 * use-dirty-state — independent per-scope unsaved-change tracking for the
 * Post Editor (Wave 2.1D).
 *
 * NEW INFRASTRUCTURE. Verified first: `grep -rn "beforeunload\|isDirty"
 * artifacts/admin/src` returned NOTHING before this file, and no admin screen
 * used react-hook-form's `formState.isDirty`. There was no precedent to adapt
 * to, so this is the first one — deliberately small, and scoped to the
 * Editorial Post Editor rather than installed app-wide.
 *
 * ─── WHY SCOPES, NOT ONE FLAG (D2 + the scoped save model) ───────────────
 *
 * The Post Editor writes through THREE independent endpoints:
 *   translation → PATCH /posts/:id/translations/:code
 *   shared      → PATCH /posts/:id            (author + feature image URL)
 *   topics      → PUT   /posts/:id/topics
 * Each can succeed or fail on its own. One global flag would either clear on
 * a partial success (losing the record that topics never saved) or stay set
 * after a successful translation save. So each scope owns its own flag, each
 * clears ONLY on its own success, and a failed save leaves its scope dirty.
 *
 * ─── NAVIGATION ──────────────────────────────────────────────────────────
 *
 * `beforeunload` covers leaving the TAB and is registered only while
 * something is actually dirty — an always-on listener would make every
 * navigation away from a clean editor prompt, and browsers penalise it.
 *
 * In-APP navigation is NOT intercepted here. The app routes with `wouter`,
 * which has no navigation blocker, and monkey-patching `history.pushState`
 * to fake one would break every other screen in the admin. Instead the
 * editor routes its own leave actions (Back to posts, language switch)
 * through `useAdminConfirm` before navigating — a real dialog on the paths
 * that actually exist, rather than an unreliable global interception.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  NO_DIRTY_SCOPES,
  anyDirtyFrom,
  describeDirtyScopes,
  type DirtyFlags,
  type DirtyScope,
} from "@/lib/editorial-post-dirty";

// Re-exported so a consuming screen imports one module, not two.
export * from "@/lib/editorial-post-dirty";

export interface DirtyState {
  flags: DirtyFlags;
  anyDirty: boolean;
  /** Set or clear one scope. */
  setDirty: (scope: DirtyScope, dirty: boolean) => void;
  /** Clear exactly one scope — what a scope's own successful save calls. */
  clearScope: (scope: DirtyScope) => void;
  /** Clear everything — only on a full reload of the editor's data. */
  reset: () => void;
  summary: string | null;
}

export function useDirtyState(): DirtyState {
  const [flags, setFlags] = useState<DirtyFlags>(NO_DIRTY_SCOPES);

  const setDirty = useCallback((scope: DirtyScope, dirty: boolean) => {
    setFlags((current) => (current[scope] === dirty ? current : { ...current, [scope]: dirty }));
  }, []);

  const clearScope = useCallback((scope: DirtyScope) => {
    setFlags((current) => (current[scope] ? { ...current, [scope]: false } : current));
  }, []);

  const reset = useCallback(() => setFlags(NO_DIRTY_SCOPES), []);

  const anyDirty = anyDirtyFrom(flags);

  // Registered ONLY while something is dirty, and removed again the moment
  // everything is saved.
  useEffect(() => {
    if (!anyDirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Assigning returnValue is what actually triggers the browser's own
      // dialog in Chrome and Safari; the string itself is never shown.
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  const summary = useMemo(() => describeDirtyScopes(flags), [flags]);

  return { flags, anyDirty, setDirty, clearScope, reset, summary };
}

/**
 * Cmd/Ctrl+S. Binds to the TRANSLATION scope only — the primary writing
 * surface — and never to Publish: a keyboard shortcut must not be able to put
 * content live. Returns nothing and does nothing when that scope is clean.
 */
export function useSaveShortcut(enabled: boolean, onSave: () => void): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key !== "s" && event.key !== "S") return;
      event.preventDefault();
      onSave();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onSave]);
}

