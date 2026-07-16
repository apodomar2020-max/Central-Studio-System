/**
 * CentralAlertProvider
 *
 * App-wide replacement for native `Alert.alert()`. Mount once near the root
 * (see app/_layout.tsx), above every screen, inside the existing
 * SafeAreaProvider/ErrorBoundary and — importantly — above AppContextProvider,
 * since AppContext's own mutation handlers (addChild/updateChild/removeChild)
 * call useCentralAlert() and need to be its descendant.
 *
 * Two ways to trigger an alert:
 *   1. `useCentralAlert()` — for any React component/hook.
 *   2. `presentCentralAlert()` — a plain-function bridge for the handful of
 *      non-component utility modules (utils/authRequired.ts,
 *      utils/profileCompletionRequired.ts) that show alerts from many call
 *      sites and cannot call hooks. The provider registers itself into this
 *      module-level singleton on mount and clears it on unmount, so the
 *      bridge is always backed by a live provider in the running app (it
 *      mounts once at boot, before any screen can call the bridge) and never
 *      references a stale instance.
 *
 * Alerts are served from a small FIFO queue (§7): concurrent show() calls —
 * e.g. two API failures in flight at once — are never dropped or overwritten,
 * they simply show one after another. Exact duplicate alerts (same title +
 * message + action count) already waiting in the queue are coalesced so a
 * re-firing effect can't flood the queue with repeats of the same message.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import CentralAlertDialog from "@/components/ui/CentralAlertDialog";
import {
  type CentralAlertOptions,
  type NormalizedCentralAlert,
  canPressAction,
  dequeueAlert,
  startAlertAction,
  normalizeAlertOptions,
} from "./centralAlertLogic";
import {
  type PresentCentralAlertResult,
  type BridgePresenter,
  registerPresenter,
  unregisterPresenter,
  presentCentralAlert,
} from "./centralAlertBridge";

export type { CentralAlertOptions, CentralAlertAction, CentralAlertTone, CentralAlertActionTone } from "./centralAlertLogic";
export { presentCentralAlert } from "./centralAlertBridge";

export type CentralAlertApi = {
  show: (options: CentralAlertOptions) => PresentCentralAlertResult;
  hide: () => void;
};

const CentralAlertContext = createContext<CentralAlertApi | null>(null);

export function CentralAlertProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<NormalizedCentralAlert[]>([]);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const queueRef = useRef<NormalizedCentralAlert[]>([]);
  const isMountedRef = useRef(true);
  const isRegisteredRef = useRef(false);

  // Single commitQueue source of truth helper
  const commitQueue = useCallback((nextQueue: NormalizedCentralAlert[]) => {
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const show = useCallback((options: CentralAlertOptions): PresentCentralAlertResult => {
    // 1. Startup acceptance correctness: Context show() must not directly enqueue before registration is complete.
    if (!isRegisteredRef.current) {
      return presentCentralAlert(options);
    }

    // 2. Atomic duplicate check against queueRef.current
    if (options.dedupeKey && queueRef.current.some((a) => a.dedupeKey === options.dedupeKey)) {
      return { kind: "rejected", reason: "duplicate_dedupe_key" };
    }

    const normalized = normalizeAlertOptions(options);
    commitQueue([...queueRef.current, normalized]);
    return { kind: "accepted", buffered: false };
  }, [commitQueue]);

  const hide = useCallback(() => {
    setPendingIndex(null);
    commitQueue(dequeueAlert(queueRef.current));
  }, [commitQueue]);

  const apiValue = useMemo<CentralAlertApi>(() => ({ show, hide }), [show, hide]);

  useEffect(() => {
    const presenter: BridgePresenter = (alerts) => {
      const results: PresentCentralAlertResult[] = [];
      const newQueue = [...queueRef.current];
      let updated = false;

      for (const alertOpts of alerts) {
        if (alertOpts.dedupeKey && newQueue.some((a) => a.dedupeKey === alertOpts.dedupeKey)) {
          results.push({ kind: "rejected", reason: "duplicate_dedupe_key" });
        } else {
          newQueue.push(normalizeAlertOptions(alertOpts));
          results.push({ kind: "accepted", buffered: false });
          updated = true;
        }
      }

      if (updated) {
        commitQueue(newQueue);
      }
      return results;
    };

    const { token, bufferedAlerts } = registerPresenter(presenter);
    isRegisteredRef.current = true;

    // Atomically prepend older bootstrap alerts before any alerts already present in queueRef.current
    if (bufferedAlerts.length > 0) {
      const mergedQueue: NormalizedCentralAlert[] = [];
      for (const raw of bufferedAlerts) {
        const norm = normalizeAlertOptions(raw);
        if (norm.dedupeKey && mergedQueue.some((a) => a.dedupeKey === norm.dedupeKey)) {
          continue;
        }
        mergedQueue.push(norm);
      }
      for (const existing of queueRef.current) {
        if (existing.dedupeKey && mergedQueue.some((a) => a.dedupeKey === existing.dedupeKey)) {
          continue;
        }
        mergedQueue.push(existing);
      }
      commitQueue(mergedQueue);
    }

    return () => {
      isRegisteredRef.current = false;
      unregisterPresenter(token);
    };
  }, [commitQueue]);

  const current = queue[0] ?? null;

  const handleActionPress = useCallback(
    (index: number) => {
      const action = current?.actions[index];
      if (!current || !canPressAction(pendingIndex, action)) return;

      const started = startAlertAction(action!);
      if (started.kind === "sync") {
        // Matches native Alert.alert's immediate dismiss — no loading flash.
        commitQueue(dequeueAlert(queueRef.current));
        return;
      }

      setPendingIndex(index);
      started.settled.then((outcome) => {
        if (!isMountedRef.current) return; // Prevent React state update after unmount
        if (outcome.kind === "rejected") {
          // Restore interaction so the user can retry or dismiss — never
          // leave an action stuck spinning after a rejected callback.
          setPendingIndex(null);
          if (__DEV__) console.warn("[CentralAlert] action onPress rejected:", outcome.error);
          return;
        }
        setPendingIndex(null);
        commitQueue(dequeueAlert(queueRef.current));
      });
    },
    [current, pendingIndex, commitQueue],
  );

  const handleRequestClose = useCallback(() => {
    if (!current || pendingIndex != null) return;
    if (!current.dismissible) return; // non-dismissible: Back/backdrop are no-ops
    if (current.cancelActionIndex != null) {
      handleActionPress(current.cancelActionIndex);
    } else {
      hide();
    }
  }, [current, pendingIndex, hide, handleActionPress]);

  return (
    <CentralAlertContext.Provider value={apiValue}>
      {children}
      <CentralAlertDialog
        alert={current}
        pendingIndex={pendingIndex}
        onActionPress={handleActionPress}
        onRequestClose={handleRequestClose}
      />
    </CentralAlertContext.Provider>
  );
}

export function useCentralAlertContext(): CentralAlertApi {
  const ctx = useContext(CentralAlertContext);
  if (!ctx) throw new Error("useCentralAlert must be used within CentralAlertProvider");
  return ctx;
}
