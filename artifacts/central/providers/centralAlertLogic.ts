/**
 * CentralAlert — pure normalization + queue logic.
 *
 * Deliberately framework-free (no React, no React Native imports) so it can
 * be unit tested directly and reasoned about independently of rendering.
 * `providers/CentralAlertProvider.tsx` is the only consumer in the app.
 */

export type CentralAlertTone = "info" | "success" | "warning" | "error" | "destructive";

export type CentralAlertActionTone = "primary" | "neutral" | "danger";

export type CentralAlertAction = {
  label: string;
  tone?: CentralAlertActionTone;
  onPress?: () => void | Promise<void>;
  disabled?: boolean;
};

export type CentralAlertOptions = {
  title: string;
  message?: string;
  tone?: CentralAlertTone;
  actions?: CentralAlertAction[];
  dismissible?: boolean;
  cancelActionIndex?: number;
  dedupeKey?: string;
};

export type NormalizedCentralAlertAction = {
  label: string;
  tone: CentralAlertActionTone;
  onPress?: () => void | Promise<void>;
  disabled: boolean;
};

export type NormalizedCentralAlert = {
  id: string;
  title: string;
  message?: string;
  tone: CentralAlertTone;
  actions: NormalizedCentralAlertAction[];
  dismissible: boolean;
  cancelActionIndex: number | null;
  dedupeKey?: string;
};

let seq = 0;
function nextId(): string {
  seq += 1;
  return `central-alert-${seq}`;
}

/** Test-only: reset the id counter so snapshot-style assertions are stable. */
export function __resetCentralAlertIdsForTests(): void {
  seq = 0;
}

/**
 * Dismissal-policy defaults, applied only when the caller doesn't explicitly
 * set `dismissible` / `cancelActionIndex`. Mirrors the native Alert.alert
 * cancelable semantics this system replaces:
 *
 *  - No actions supplied (implicit single "OK", no callback) → dismissible,
 *    backdrop/back just close (nothing to invoke).
 *  - Exactly one explicit action (its onPress carries real behavior, e.g.
 *    navigation) → NOT dismissible; the action must be tapped. This matches
 *    how these alerts behaved on iOS, where Alert has no backdrop-dismiss at
 *    all, and avoids silently skipping a required acknowledgement.
 *  - Two or more actions → dismissible only if one of them is tone "neutral"
 *    (the safe/cancel action, carried over from the original `style:
 *    "cancel"` button). Backdrop/back invoke that action. A destructive
 *    ("danger") action is never reachable via backdrop or back.
 */
function resolveDismissal(
  actions: NormalizedCentralAlertAction[],
  explicitActionsProvided: boolean,
  dismissibleOverride: boolean | undefined,
  cancelActionIndexOverride: number | undefined,
): { dismissible: boolean; cancelActionIndex: number | null } {
  if (dismissibleOverride !== undefined) {
    const idx =
      cancelActionIndexOverride ??
      (dismissibleOverride ? actions.findIndex((a) => a.tone === "neutral") : -1);
    return {
      dismissible: dismissibleOverride,
      cancelActionIndex: idx != null && idx >= 0 ? idx : null,
    };
  }

  if (!explicitActionsProvided) {
    return { dismissible: true, cancelActionIndex: null };
  }
  if (actions.length === 1) {
    return { dismissible: false, cancelActionIndex: null };
  }
  const neutralIndex = actions.findIndex((a) => a.tone === "neutral");
  return {
    dismissible: neutralIndex !== -1,
    cancelActionIndex: neutralIndex !== -1 ? neutralIndex : null,
  };
}

export function normalizeAlertOptions(options: CentralAlertOptions): NormalizedCentralAlert {
  const explicitActionsProvided = Boolean(options.actions && options.actions.length > 0);
  const rawActions: CentralAlertAction[] = explicitActionsProvided
    ? (options.actions as CentralAlertAction[])
    : [{ label: "OK", tone: "primary" }];

  const actions: NormalizedCentralAlertAction[] = rawActions.map((a) => ({
    label: a.label,
    tone: a.tone ?? "primary",
    onPress: a.onPress,
    disabled: Boolean(a.disabled),
  }));

  const { dismissible, cancelActionIndex } = resolveDismissal(
    actions,
    explicitActionsProvided,
    options.dismissible,
    options.cancelActionIndex,
  );

  return {
    id: nextId(),
    title: options.title,
    message: options.message,
    tone: options.tone ?? "info",
    actions,
    dismissible,
    cancelActionIndex,
    dedupeKey: options.dedupeKey,
  };
}

/** Prevents alerts with the same explicit dedupeKey from piling up in the queue.
 *  Implicit auto-deduplication based on visible content is removed. */
export function isDuplicateAlert(
  queue: NormalizedCentralAlert[],
  options: CentralAlertOptions,
): boolean {
  if (!options.dedupeKey) return false;
  return queue.some((a) => a.dedupeKey === options.dedupeKey);
}

export function enqueueAlert(
  queue: NormalizedCentralAlert[],
  options: CentralAlertOptions,
): NormalizedCentralAlert[] {
  if (isDuplicateAlert(queue, options)) return queue;
  return [...queue, normalizeAlertOptions(options)];
}

export function dequeueAlert(queue: NormalizedCentralAlert[]): NormalizedCentralAlert[] {
  return queue.slice(1);
}

/** Guards against double-taps / pressing a second action while one is still
 *  processing. Pure so it can be asserted directly instead of only through
 *  rendered-component behavior. */
export function canPressAction(pendingIndex: number | null, action: NormalizedCentralAlertAction | undefined): boolean {
  if (!action || action.disabled) return false;
  return pendingIndex == null;
}

export type AlertActionOutcome =
  | { kind: "sync" }
  | { kind: "resolved" }
  | { kind: "rejected"; error: unknown };

/**
 * Calls an action's onPress and, if it returned a promise, awaits it and
 * reports how it settled — without touching any React state itself. The
 * provider uses `kind` to decide whether to show a per-action loading state
 * (only for the async branch — a synchronous action closes immediately,
 * exactly like native Alert.alert, with no loading flash) and whether a
 * rejection should restore interaction instead of closing the alert. Split
 * into a synchronous "start" step and the returned promise so the provider
 * never has to await before deciding whether to show a spinner. Fully
 * unit-testable with plain async/await — no rendering required.
 */
export function startAlertAction(
  action: NormalizedCentralAlertAction,
): { kind: "sync" } | { kind: "async"; settled: Promise<AlertActionOutcome> } {
  const result = action.onPress?.();
  const isThenable = Boolean(result) && typeof (result as Promise<void>).then === "function";
  if (!isThenable) return { kind: "sync" };

  const settled = (result as Promise<void>).then(
    (): AlertActionOutcome => ({ kind: "resolved" }),
    (error: unknown): AlertActionOutcome => ({ kind: "rejected", error }),
  );
  return { kind: "async", settled };
}

/** Convenience wrapper over `startAlertAction` for callers (tests, mostly)
 *  that just want the final outcome regardless of sync/async timing. */
export async function invokeAlertAction(action: NormalizedCentralAlertAction): Promise<AlertActionOutcome> {
  const started = startAlertAction(action);
  if (started.kind === "sync") return { kind: "sync" };
  return started.settled;
}
