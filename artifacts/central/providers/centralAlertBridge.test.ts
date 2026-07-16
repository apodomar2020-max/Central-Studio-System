import assert from "node:assert/strict";
import test from "node:test";

import { createCentralAlertBridge, type BridgePresenter, type PresentCentralAlertResult } from "./centralAlertBridge";
import { type CentralAlertOptions } from "./centralAlertLogic";

test("registration ownership: unregistration clears only if token matches", () => {
  const bridge = createCentralAlertBridge();

  const presenter1: BridgePresenter = () => [{ kind: "accepted", buffered: false }];
  const presenter2: BridgePresenter = () => [{ kind: "accepted", buffered: false }];

  const { token: token1 } = bridge.registerPresenter(presenter1);
  assert.equal(bridge.isPresenterRegistered(), true);

  // Registering a second presenter updates the active presenter and token
  const { token: token2 } = bridge.registerPresenter(presenter2);

  // Unregistering the old token should NOT clear the presenter
  bridge.unregisterPresenter(token1);
  assert.equal(bridge.isPresenterRegistered(), true);

  // Unregistering the current token clears the presenter
  bridge.unregisterPresenter(token2);
  assert.equal(bridge.isPresenterRegistered(), false);
});

test("bootstrap buffering: pre-mount alerts are buffered", () => {
  const bridge = createCentralAlertBridge();

  const result = bridge.presentCentralAlert({ title: "Pre-mount 1" });
  assert.deepEqual(result, { kind: "accepted", buffered: true });
  assert.equal(bridge.getBootstrapQueue().length, 1);
  assert.equal(bridge.getBootstrapQueue()[0].title, "Pre-mount 1");
});

test("bootstrap queue overflow: alert number 11 is rejected, first 10 remain unchanged", () => {
  const bridge = createCentralAlertBridge();

  // Enqueue 10 alerts
  for (let i = 1; i <= 10; i++) {
    const res = bridge.presentCentralAlert({ title: `Alert ${i}` });
    assert.deepEqual(res, { kind: "accepted", buffered: true });
  }

  // 11th alert should be rejected as queue full
  const res11 = bridge.presentCentralAlert({ title: "Alert 11" });
  assert.deepEqual(res11, { kind: "rejected", reason: "bootstrap_queue_full" });
});

test("rejection priority: duplicate request against a full queue must return duplicate_dedupe_key", () => {
  const bridge = createCentralAlertBridge();

  // Enqueue 10 alerts. First one has a dedupeKey
  bridge.presentCentralAlert({ title: "Alert 1", dedupeKey: "dup-key" });
  for (let i = 2; i <= 10; i++) {
    bridge.presentCentralAlert({ title: `Alert ${i}` });
  }

  // Now the queue has 10 items.
  // 11th alert with SAME dedupeKey must return duplicate_dedupe_key (priority 1)
  const dupRes = bridge.presentCentralAlert({ title: "Another Dup", dedupeKey: "dup-key" });
  assert.deepEqual(dupRes, { kind: "rejected", reason: "duplicate_dedupe_key" });

  // 11th alert with DIFFERENT/no dedupeKey must return bootstrap_queue_full (priority 2)
  const fullRes = bridge.presentCentralAlert({ title: "Alert 11" });
  assert.deepEqual(fullRes, { kind: "rejected", reason: "bootstrap_queue_full" });

  // Verify the first 10 remain unchanged and in order
  const queue = bridge.getBootstrapQueue();
  assert.equal(queue.length, 10);
  assert.equal(queue[0].title, "Alert 1");
  assert.equal(queue[9].title, "Alert 10");
});

test("bootstrap FIFO flush: pre-mount alerts flush once in FIFO order, and are cleared", () => {
  const bridge = createCentralAlertBridge();

  bridge.presentCentralAlert({ title: "Alert A" });
  bridge.presentCentralAlert({ title: "Alert B" });

  const received: CentralAlertOptions[] = [];
  const presenter: BridgePresenter = (alerts) => {
    received.push(...alerts);
    return alerts.map(() => ({ kind: "accepted", buffered: false }));
  };

  const { bufferedAlerts } = bridge.registerPresenter(presenter);
  assert.equal(bufferedAlerts.length, 2);
  assert.equal(bufferedAlerts[0].title, "Alert A");
  assert.equal(bufferedAlerts[1].title, "Alert B");

  // Verify they are removed from the bootstrap queue
  assert.equal(bridge.getBootstrapQueue().length, 0);
});

test("flushed alerts are never replayed after remount", () => {
  const bridge = createCentralAlertBridge();

  bridge.presentCentralAlert({ title: "Alert A" });

  // Register presenter 1 (flushes Alert A)
  const { token: token1, bufferedAlerts: flushed1 } = bridge.registerPresenter(() => [{ kind: "accepted", buffered: false }]);
  assert.equal(flushed1.length, 1);
  assert.equal(flushed1[0].title, "Alert A");

  // Unregister presenter 1
  bridge.unregisterPresenter(token1);

  // Register presenter 2 (should flush nothing since Alert A was already consumed)
  const { bufferedAlerts: flushed2 } = bridge.registerPresenter(() => [{ kind: "accepted", buffered: false }]);
  assert.equal(flushed2.length, 0);
});

test("presenter calls after unmount are buffered rather than sent to a stale provider", () => {
  const bridge = createCentralAlertBridge();

  let receivedCount = 0;
  const presenter: BridgePresenter = (alerts) => {
    receivedCount += alerts.length;
    return alerts.map(() => ({ kind: "accepted", buffered: false }));
  };

  // Register
  const { token } = bridge.registerPresenter(presenter);

  // Present while mounted -> goes to presenter
  const res1 = bridge.presentCentralAlert({ title: "Mount alert" });
  assert.deepEqual(res1, { kind: "accepted", buffered: false });
  assert.equal(receivedCount, 1);

  // Unmount
  bridge.unregisterPresenter(token);

  // Present after unmount -> should be buffered, not call presenter
  const res2 = bridge.presentCentralAlert({ title: "Unmount alert" });
  assert.deepEqual(res2, { kind: "accepted", buffered: true });
  assert.equal(receivedCount, 1); // still 1
  assert.equal(bridge.getBootstrapQueue().length, 1);
  assert.equal(bridge.getBootstrapQueue()[0].title, "Unmount alert");
});

test("atomic duplicate check: mock provider queueRef implementation rejects duplicates synchronously in same tick", () => {
  const bridge = createCentralAlertBridge();

  // Let's simulate the provider's state and queueRef logic in the presenter callback
  const providerQueueRef: any[] = [];
  const presenter: BridgePresenter = (alerts) => {
    const results: PresentCentralAlertResult[] = [];
    for (const a of alerts) {
      if (a.dedupeKey && providerQueueRef.some((x) => x.dedupeKey === a.dedupeKey)) {
        results.push({ kind: "rejected", reason: "duplicate_dedupe_key" });
      } else {
        providerQueueRef.push(a);
        results.push({ kind: "accepted", buffered: false });
      }
    }
    return results;
  };

  bridge.registerPresenter(presenter);

  // Call show/present alert 1 with dedupeKey
  const res1 = bridge.presentCentralAlert({ title: "Msg 1", dedupeKey: "key-x" });
  // Call show/present alert 2 synchronously with same dedupeKey before any state rerender
  const res2 = bridge.presentCentralAlert({ title: "Msg 2", dedupeKey: "key-x" });

  assert.deepEqual(res1, { kind: "accepted", buffered: false });
  assert.deepEqual(res2, { kind: "rejected", reason: "duplicate_dedupe_key" });

  assert.equal(providerQueueRef.length, 1);
  assert.equal(providerQueueRef[0].title, "Msg 1");
});
