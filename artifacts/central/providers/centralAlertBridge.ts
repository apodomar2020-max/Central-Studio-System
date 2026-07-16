import type { CentralAlertOptions } from "./centralAlertLogic";

export type PresentCentralAlertResult =
  | { kind: "accepted"; buffered: boolean }
  | { kind: "rejected"; reason: "duplicate_dedupe_key" | "bootstrap_queue_full" };

export type BridgePresenter = (alerts: CentralAlertOptions[]) => PresentCentralAlertResult[];

export function createCentralAlertBridge() {
  let currentPresenter: BridgePresenter | null = null;
  let currentToken: string | null = null;
  let bootstrapQueue: CentralAlertOptions[] = [];
  const MAX_BOOTSTRAP_SIZE = 10;

  return {
    registerPresenter(presenter: BridgePresenter): { token: string; bufferedAlerts: CentralAlertOptions[] } {
      const token = Math.random().toString(36).substring(2, 9) + Date.now().toString();
      currentPresenter = presenter;
      currentToken = token;

      const flushed = [...bootstrapQueue];
      bootstrapQueue = [];

      return { token, bufferedAlerts: flushed };
    },

    unregisterPresenter(token: string): void {
      if (currentToken === token) {
        currentPresenter = null;
        currentToken = null;
      }
    },

    presentCentralAlert(options: CentralAlertOptions): PresentCentralAlertResult {
      // 1. Rejection priority: first check duplicate_dedupe_key
      if (options.dedupeKey) {
        const isDup = bootstrapQueue.some((a) => a.dedupeKey === options.dedupeKey);
        if (isDup) {
          return { kind: "rejected", reason: "duplicate_dedupe_key" };
        }
      }

      if (currentPresenter) {
        const results = currentPresenter([options]);
        return results[0];
      }

      // 2. Then check bootstrap_queue_full
      if (bootstrapQueue.length >= MAX_BOOTSTRAP_SIZE) {
        const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
        if (isDev) {
          console.warn(
            `[CentralAlert] presentCentralAlert("${options.title}") rejected: bootstrap queue is full (max ${MAX_BOOTSTRAP_SIZE}).`,
          );
        }
        return { kind: "rejected", reason: "bootstrap_queue_full" };
      }

      bootstrapQueue.push(options);
      const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
      if (isDev) {
        console.warn(
          `[CentralAlert] presentCentralAlert("${options.title}") called before CentralAlertProvider mounted. Buffered in bootstrap queue.`,
        );
      }
      return { kind: "accepted", buffered: true };
    },

    isPresenterRegistered(): boolean {
      return currentPresenter !== null;
    },

    getBootstrapQueue(): CentralAlertOptions[] {
      return bootstrapQueue;
    },
  };
}

// Export production singleton
export const centralAlertBridge = createCentralAlertBridge();

export function presentCentralAlert(options: CentralAlertOptions): PresentCentralAlertResult {
  return centralAlertBridge.presentCentralAlert(options);
}

export function registerPresenter(presenter: BridgePresenter) {
  return centralAlertBridge.registerPresenter(presenter);
}

export function unregisterPresenter(token: string) {
  centralAlertBridge.unregisterPresenter(token);
}
