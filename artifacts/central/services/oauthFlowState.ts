import { useSyncExternalStore } from "react";

export type OAuthFlowState = "idle" | "starting" | "pending" | "exchanging" | "resolving";

let oauthFlowState: OAuthFlowState = "idle";
const subscribers = new Set<() => void>();

export function setOAuthFlowState(nextState: OAuthFlowState) {
  if (oauthFlowState === nextState) return;
  oauthFlowState = nextState;
  subscribers.forEach((notify) => notify());
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function getSnapshot() {
  return oauthFlowState;
}

export function useOAuthFlowState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
