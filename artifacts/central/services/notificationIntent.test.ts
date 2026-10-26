import assert from "node:assert/strict";
import test from "node:test";
import { initialNotificationIntentState as initial, notificationIntentReducer as reduce, notificationIntentRoute, notificationNavigationReady as ready } from "./notificationIntent";
const tap = (key = "tap") => ({ type: "receive" as const, key, data: { type: "booking_confirmed" } });
const session = (account: string | null) => ({ type: "session" as const, account });
test("cold tap survives restoration and binds to restored session", () => {
  const pending = reduce(initial, tap());
  const restored = reduce(pending, session("A"));
  assert.equal(restored.pending?.owner, "A");
  assert.equal(restored.pending?.key, "tap");
});
test("warm and background taps create reactive pending state even with unchanged account", () => {
  const signedIn = reduce(initial, session("A"));
  const tapped = reduce(signedIn, tap());
  assert.notEqual(tapped, signedIn);
  assert.equal(tapped.pending?.owner, "A");
});
test("logged out intent waits for login, while logout/switch discards a bound intent", () => {
  assert.equal(reduce(reduce(initial, tap()), session("A")).pending?.key, "tap");
  const bound = reduce(reduce(initial, session("A")), tap());
  assert.equal(reduce(bound, session(null)).pending, null);
  assert.equal(reduce(bound, session("B")).pending, null);
});
test("duplicate callbacks do not replay; consumption cannot erase a newer tap", () => {
  const a = reduce(reduce(initial, session("A")), tap());
  assert.equal(reduce(a, tap()), a);
  const b = reduce(a, tap("new"));
  assert.equal(reduce(b, { type: "consume", key: "tap" }), b);
  const consumed = reduce(b, { type: "consume", key: "new" });
  assert.equal(reduce(consumed, tap("new")), consumed);
});
test("response deduplication is bounded", () => {
  let state = initial;
  for (let i = 0; i < 300; i++) state = reduce(state, tap(String(i)));
  assert.equal(state.seen.length, 128);
});
test("startup, verification and guided profile routes settle before notification navigation", () => {
  for (const path of ["/", "/index", "/auth/login", "/auth/complete-profile", "/verify-email", "/onboarding/children", "/onboarding/success"]) assert.equal(ready(false, "A", true, true, path), false);
  assert.equal(ready(true, "A", true, true, "/bookings"), false);
  assert.equal(ready(false, null, true, true, "/bookings"), false);
  assert.equal(ready(false, "A", false, true, "/bookings"), false);
  assert.equal(ready(false, "A", true, false, "/bookings"), false);
  assert.equal(ready(false, "A", true, true, "/bookings"), true);
  // Expo Router removes route groups from pathname: Home and startup both read "/".
  assert.equal(ready(false, "A", true, true, "/", true), true);
});
test("booking approval uses current-user list; malformed payloads use existing safe fallback", async () => {
  const unused = async () => { throw Error("must not fetch"); };
  assert.equal(await notificationIntentRoute({ type: "booking_confirmed", bookingId: 999 }, unused), "/(tabs)/bookings");
  for (const data of [null, [], "https://evil.invalid", { type: "unknown", url: "/booking/999" }]) assert.equal(await notificationIntentRoute(data, unused), "/notifications");
});
test("entity destination uses server-visible metadata, never untrusted application identity", async () => {
  const data = { type: "ballet_absence_recorded", notificationId: 7, applicationId: 999 };
  assert.equal(await notificationIntentRoute(data, async () => [{ id: 7, type: "ballet_absence_recorded", metadata: { applicationId: 2 } }]), "/ballet/application-status?id=2");
  assert.equal(await notificationIntentRoute(data, async () => []), "/notifications");
  assert.equal(await notificationIntentRoute(data, async () => { throw Error("offline"); }), "/notifications");
});
