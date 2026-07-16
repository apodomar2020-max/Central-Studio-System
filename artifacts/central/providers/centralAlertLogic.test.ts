import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetCentralAlertIdsForTests,
  canPressAction,
  dequeueAlert,
  enqueueAlert,
  invokeAlertAction,
  isDuplicateAlert,
  normalizeAlertOptions,
  startAlertAction,
  type CentralAlertOptions,
  type NormalizedCentralAlert,
} from "./centralAlertLogic";

test.beforeEach(() => {
  __resetCentralAlertIdsForTests();
});

// ── Default OK action (native Alert.alert(title, message) parity) ─────────

test("an alert with no actions gets a single default primary OK action", () => {
  const alert = normalizeAlertOptions({ title: "Coming soon", message: "Not wired up yet." });
  assert.equal(alert.actions.length, 1);
  assert.deepEqual(alert.actions[0], { label: "OK", tone: "primary", onPress: undefined, disabled: false });
});

test("a default OK alert is dismissible with no callback to invoke on dismiss", () => {
  const alert = normalizeAlertOptions({ title: "Coming soon" });
  assert.equal(alert.dismissible, true);
  assert.equal(alert.cancelActionIndex, null);
});

// ── One-action error/info alert ────────────────────────────────────────────

test("a single explicit action (e.g. an error OK that navigates) is NOT dismissible", () => {
  const onPress = () => {};
  const alert = normalizeAlertOptions({
    tone: "error",
    title: "Already booked",
    message: "You already have an active booking.",
    actions: [{ label: "OK", tone: "primary", onPress }],
  });
  assert.equal(alert.actions.length, 1);
  assert.equal(alert.dismissible, false);
  assert.equal(alert.cancelActionIndex, null);
  assert.equal(alert.actions[0].onPress, onPress);
});

// ── Two-action confirmation ─────────────────────────────────────────────────

test("two-action confirmation: the neutral (cancel-style) action is the safe dismiss target", () => {
  const onKeep = () => {};
  const onCancelBooking = () => {};
  const alert = normalizeAlertOptions({
    tone: "destructive",
    title: "Cancel booking?",
    message: "This frees up your seat.",
    actions: [
      { label: "Keep booking", tone: "neutral", onPress: onKeep },
      { label: "Cancel booking", tone: "danger", onPress: onCancelBooking },
    ],
  });
  assert.equal(alert.dismissible, true);
  assert.equal(alert.cancelActionIndex, 0);
  assert.equal(alert.actions[0].tone, "neutral");
  assert.equal(alert.actions[1].tone, "danger");
});

test("two-action alert where NEITHER action is neutral requires an explicit tap", () => {
  // e.g. "Request Cash Refund?" — both choices proceed, neither is a no-op cancel.
  const alert = normalizeAlertOptions({
    title: "Request Cash Refund?",
    actions: [
      { label: "No Refund", tone: "primary", onPress: () => {} },
      { label: "Request Cash Refund", tone: "primary", onPress: () => {} },
    ],
  });
  assert.equal(alert.dismissible, false);
  assert.equal(alert.cancelActionIndex, null);
});

// ── Three-action decision (Ballet "Cancel Program") ─────────────────────────

test("three-action decision preserves exact label/tone/order and each callback reference", () => {
  const onImmediate = () => {};
  const onEndOfPeriod = () => {};

  const options: CentralAlertOptions = {
    tone: "destructive",
    title: "Cancel Program",
    message:
      "When would you like the enrollment cancellation to take effect? Your request will be reviewed by the studio.",
    actions: [
      { label: "Immediate", tone: "danger", onPress: onImmediate },
      { label: "End of Current Period", tone: "primary", onPress: onEndOfPeriod },
      { label: "Keep Enrollment", tone: "neutral" },
    ],
  };

  const alert = normalizeAlertOptions(options);

  assert.equal(alert.title, "Cancel Program");
  assert.equal(alert.actions.length, 3);
  assert.deepEqual(
    alert.actions.map((a) => a.label),
    ["Immediate", "End of Current Period", "Keep Enrollment"],
  );
  assert.deepEqual(
    alert.actions.map((a) => a.tone),
    ["danger", "primary", "neutral"],
  );
  // Exact same function references — callbacks are carried through untouched.
  assert.equal(alert.actions[0].onPress, onImmediate);
  assert.equal(alert.actions[1].onPress, onEndOfPeriod);
  assert.equal(alert.actions[2].onPress, undefined);

  // Backdrop / Android Back resolve to "Keep Enrollment" only — never Immediate.
  assert.equal(alert.dismissible, true);
  assert.equal(alert.cancelActionIndex, 2);
});

// ── Destructive action styling / safe cancel ────────────────────────────────

test("a danger-tone action is never the backdrop/back target, even if listed first", () => {
  const alert = normalizeAlertOptions({
    title: "Sign Out",
    actions: [
      { label: "Cancel", tone: "neutral" },
      { label: "Sign Out", tone: "danger", onPress: () => {} },
    ],
  });
  assert.notEqual(alert.cancelActionIndex, 1);
  assert.equal(alert.cancelActionIndex, 0);
});

// ── Non-dismissible alert ────────────────────────────────────────────────────

test("explicit dismissible: false is honored even with a neutral action present", () => {
  const alert = normalizeAlertOptions({
    title: "Confirm",
    dismissible: false,
    actions: [
      { label: "Cancel", tone: "neutral" },
      { label: "Confirm", tone: "primary", onPress: () => {} },
    ],
  });
  assert.equal(alert.dismissible, false);
  assert.equal(alert.cancelActionIndex, null);
});

test("explicit cancelActionIndex overrides the automatic neutral-tone lookup", () => {
  const alert = normalizeAlertOptions({
    title: "Pick one",
    dismissible: true,
    cancelActionIndex: 1,
    actions: [
      { label: "A", tone: "primary", onPress: () => {} },
      { label: "B", tone: "primary", onPress: () => {} },
    ],
  });
  assert.equal(alert.cancelActionIndex, 1);
});

// ── Async double-tap prevention ─────────────────────────────────────────────

test("canPressAction blocks a second press while one action is already pending", () => {
  const action = normalizeAlertOptions({
    title: "x",
    actions: [{ label: "OK", tone: "primary", onPress: () => {} }],
  }).actions[0];

  assert.equal(canPressAction(null, action), true);
  assert.equal(canPressAction(0, action), false); // some action already pending
});

test("canPressAction blocks a disabled action", () => {
  const action = normalizeAlertOptions({
    title: "x",
    actions: [{ label: "OK", tone: "primary", disabled: true }],
  }).actions[0];
  assert.equal(canPressAction(null, action), false);
});

// ── Sync vs async action settlement / rejection recovery ───────────────────

test("a synchronous action reports kind 'sync' with no pending window", () => {
  let called = false;
  const action = normalizeAlertOptions({
    title: "x",
    actions: [{ label: "OK", tone: "primary", onPress: () => { called = true; } }],
  }).actions[0];

  const started = startAlertAction(action);
  assert.equal(started.kind, "sync");
  assert.equal(called, true);
});

test("an async action that resolves reports kind 'resolved'", async () => {
  const action = normalizeAlertOptions({
    title: "x",
    actions: [{ label: "OK", tone: "primary", onPress: async () => {} }],
  }).actions[0];

  const outcome = await invokeAlertAction(action);
  assert.equal(outcome.kind, "resolved");
});

test("an async action that rejects reports kind 'rejected' — interaction can be restored", async () => {
  const boom = new Error("network down");
  const action = normalizeAlertOptions({
    title: "x",
    actions: [{ label: "Retry", tone: "primary", onPress: async () => { throw boom; } }],
  }).actions[0];

  const outcome = await invokeAlertAction(action);
  assert.equal(outcome.kind, "rejected");
  assert.equal((outcome as { kind: "rejected"; error: unknown }).error, boom);
});

// ── FIFO queue: ordering, duplicate suppression, sequential display ────────

test("enqueueAlert appends to the end — concurrent alerts show in the order they were requested", () => {
  let queue: NormalizedCentralAlert[] = [];
  queue = enqueueAlert(queue, { title: "First error" });
  queue = enqueueAlert(queue, { title: "Second error" });
  queue = enqueueAlert(queue, { title: "Third error" });

  assert.deepEqual(queue.map((a) => a.title), ["First error", "Second error", "Third error"]);
});

test("dequeueAlert removes only the front alert — the next one becomes current", () => {
  let queue: NormalizedCentralAlert[] = [];
  queue = enqueueAlert(queue, { title: "First" });
  queue = enqueueAlert(queue, { title: "Second" });

  assert.equal(queue[0].title, "First");
  queue = dequeueAlert(queue);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].title, "Second");
});

test("two alerts with identical title/message/action count but different callbacks both appear in FIFO order", () => {
  let queue: NormalizedCentralAlert[] = [];
  let callCount1 = 0;
  let callCount2 = 0;

  const alert1: CentralAlertOptions = {
    title: "Update Required",
    message: "A new update is available.",
    actions: [{ label: "OK", tone: "primary", onPress: () => { callCount1++; } }]
  };
  const alert2: CentralAlertOptions = {
    title: "Update Required",
    message: "A new update is available.",
    actions: [{ label: "OK", tone: "primary", onPress: () => { callCount2++; } }]
  };

  queue = enqueueAlert(queue, alert1);
  queue = enqueueAlert(queue, alert2);

  assert.equal(queue.length, 2);
  assert.equal(queue[0].title, "Update Required");
  assert.equal(queue[1].title, "Update Required");

  // Call the callbacks to prove isolation:
  const action1 = queue[0].actions[0];
  const action2 = queue[1].actions[0];

  action1.onPress?.();
  assert.equal(callCount1, 1);
  assert.equal(callCount2, 0);

  action2.onPress?.();
  assert.equal(callCount1, 1);
  assert.equal(callCount2, 1);
});

test("two alerts with the same explicit dedupeKey produce only one queued item", () => {
  let queue: NormalizedCentralAlert[] = [];
  const alert1: CentralAlertOptions = { title: "Error", message: "Same key", dedupeKey: "my-key" };
  const alert2: CentralAlertOptions = { title: "Different Title", message: "Same key different body", dedupeKey: "my-key" };

  queue = enqueueAlert(queue, alert1);
  queue = enqueueAlert(queue, alert2);

  assert.equal(queue.length, 1);
  assert.equal(queue[0].title, "Error");
});

test("different explicit dedupeKeys both enqueue", () => {
  let queue: NormalizedCentralAlert[] = [];
  const alert1: CentralAlertOptions = { title: "Error", message: "Key 1", dedupeKey: "key-1" };
  const alert2: CentralAlertOptions = { title: "Error", message: "Key 2", dedupeKey: "key-2" };

  queue = enqueueAlert(queue, alert1);
  queue = enqueueAlert(queue, alert2);

  assert.equal(queue.length, 2);
  assert.equal(queue[0].dedupeKey, "key-1");
  assert.equal(queue[1].dedupeKey, "key-2");
});

test("a destructive confirmation is never dropped because another alert has the same visible text", () => {
  let queue: NormalizedCentralAlert[] = [];
  const alert1: CentralAlertOptions = {
    title: "Delete Account?",
    message: "This cannot be undone.",
    tone: "destructive",
    actions: [
      { label: "Cancel", tone: "neutral" },
      { label: "Delete", tone: "danger" }
    ]
  };
  const alert2: CentralAlertOptions = {
    title: "Delete Account?",
    message: "This cannot be undone.",
    tone: "destructive",
    actions: [
      { label: "Cancel", tone: "neutral" },
      { label: "Delete", tone: "danger" }
    ]
  };

  queue = enqueueAlert(queue, alert1);
  queue = enqueueAlert(queue, alert2);

  // Destructive confirmations do not have auto-dedupe, so they must both be enqueued
  assert.equal(queue.length, 2);
});

test("same dedupeKey as the active alert is rejected", () => {
  let queue: NormalizedCentralAlert[] = [];
  const alert1: CentralAlertOptions = { title: "Active", dedupeKey: "active-key" };
  const alert2: CentralAlertOptions = { title: "Active Duplicate", dedupeKey: "active-key" };

  queue = enqueueAlert(queue, alert1); // Becomes active (index 0)
  assert.equal(isDuplicateAlert(queue, alert2), true);
  queue = enqueueAlert(queue, alert2);
  assert.equal(queue.length, 1);
});

test("same dedupeKey in the waiting queue is rejected", () => {
  let queue: NormalizedCentralAlert[] = [];
  const alert1: CentralAlertOptions = { title: "Active", dedupeKey: "active-key" };
  const alert2: CentralAlertOptions = { title: "Waiting", dedupeKey: "waiting-key" };
  const alert3: CentralAlertOptions = { title: "Waiting Duplicate", dedupeKey: "waiting-key" };

  queue = enqueueAlert(queue, alert1); // Becomes active (index 0)
  queue = enqueueAlert(queue, alert2); // Becomes waiting (index 1)
  assert.equal(isDuplicateAlert(queue, alert3), true);
  queue = enqueueAlert(queue, alert3);
  assert.equal(queue.length, 2);
  assert.equal(queue[1].dedupeKey, "waiting-key");
});

test("identical visible alerts without dedupeKey both enqueue", () => {
  let queue: NormalizedCentralAlert[] = [];
  const alert1: CentralAlertOptions = { title: "Oops", message: "Something went wrong" };
  const alert2: CentralAlertOptions = { title: "Oops", message: "Something went wrong" };

  queue = enqueueAlert(queue, alert1);
  queue = enqueueAlert(queue, alert2);

  assert.equal(queue.length, 2);
});
