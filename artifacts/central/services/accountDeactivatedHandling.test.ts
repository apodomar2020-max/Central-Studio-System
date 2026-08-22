/**
 * Student Account Lifecycle — Phase B1C: client-side handling of a
 * `401 { code: "ACCOUNT_DEACTIVATED" }` response, as consumed by the mobile
 * app via @workspace/api-client-react's customFetch/setAccountDeactivatedHandler.
 *
 * Pure Node test: `globalThis.fetch` is stubbed with canned Response objects,
 * no network, no Express app, no database. Direct sibling/extension of
 * sessionRevokedHandling.test.ts — same technique, same file shape — verifying:
 *   - the handler fires exactly on a 401 carrying { code: "ACCOUNT_DEACTIVATED" }
 *   - it does NOT fire for SESSION_REVOKED or any other 401 shape, and
 *     SESSION_REVOKED does NOT fire the ACCOUNT_DEACTIVATED handler either —
 *     the two codes are never conflated
 *   - it does NOT fire for non-401 errors or successful responses
 *   - the normal ApiError is still thrown afterward either way (additive)
 *   - concurrent 401 ACCOUNT_DEACTIVATED responses across several in-flight
 *     requests all reach the low-level handler (customFetch fires it per
 *     failing response, by design, same as SESSION_REVOKED) — de-duplication
 *     down to "exactly one visible effect" is the app-level handler's job
 *     (AppContext.tsx), covered structurally below via a one-shot guard
 *     identical in shape to what AppContext registers.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  customFetch,
  setAccountDeactivatedHandler,
  setSessionRevokedHandler,
} from "@workspace/api-client-react";

function isApiErrorLike(err: unknown): err is { status: number; data: unknown } {
  return !!err && typeof err === "object" && "status" in err && "data" in err;
}

const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  setAccountDeactivatedHandler(null);
  setSessionRevokedHandler(null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setAccountDeactivatedHandler(null);
  setSessionRevokedHandler(null);
});

test("ACCOUNT_DEACTIVATED: a 401 with code ACCOUNT_DEACTIVATED fires the registered handler exactly once", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Account deactivated.", code: "ACCOUNT_DEACTIVATED" })) as typeof fetch;

  let calls = 0;
  setAccountDeactivatedHandler(() => { calls += 1; });

  await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
  assert.equal(calls, 1, "handler fires exactly once for the one deactivated-account request");
});

test("ACCOUNT_DEACTIVATED: the normal ApiError is still thrown — additive, not a replacement", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Account deactivated.", code: "ACCOUNT_DEACTIVATED" })) as typeof fetch;

  let handlerFired = false;
  setAccountDeactivatedHandler(() => { handlerFired = true; });

  try {
    await customFetch("/api/my/bookings");
    assert.fail("expected customFetch to throw");
  } catch (err) {
    assert.ok(isApiErrorLike(err));
    assert.equal(err.status, 401);
    assert.equal((err.data as { code?: string } | null)?.code, "ACCOUNT_DEACTIVATED");
  }
  assert.equal(handlerFired, true);
});

test("ACCOUNT_DEACTIVATED and SESSION_REVOKED are never conflated: each code fires only its own handler", async () => {
  let deactivatedCalls = 0;
  let revokedCalls = 0;
  setAccountDeactivatedHandler(() => { deactivatedCalls += 1; });
  setSessionRevokedHandler(() => { revokedCalls += 1; });

  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Account deactivated.", code: "ACCOUNT_DEACTIVATED" })) as typeof fetch;
  await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
  assert.equal(deactivatedCalls, 1);
  assert.equal(revokedCalls, 0, "SESSION_REVOKED handler must never fire for ACCOUNT_DEACTIVATED");

  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Session expired.", code: "SESSION_REVOKED" })) as typeof fetch;
  await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
  assert.equal(deactivatedCalls, 1, "ACCOUNT_DEACTIVATED handler must never fire for SESSION_REVOKED");
  assert.equal(revokedCalls, 1);
});

test("unrelated 401s (no code, or a different code) do NOT fire the ACCOUNT_DEACTIVATED handler", async () => {
  const bodies = [
    { error: "Missing authentication credentials" },
    { error: "Invalid or expired token" },
    { error: "Some other business rule failed.", code: "SOME_OTHER_CODE" },
    { error: "Session expired.", code: "SESSION_REVOKED" },
  ];

  for (const body of bodies) {
    let calls = 0;
    setAccountDeactivatedHandler(() => { calls += 1; });
    globalThis.fetch = (async () => jsonResponse(401, body)) as typeof fetch;

    await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
    assert.equal(calls, 0, `handler must not fire for body ${JSON.stringify(body)}`);
  }
});

test("an ACCOUNT_DEACTIVATED-shaped body on a non-401 status does NOT fire the handler", async () => {
  let calls = 0;
  setAccountDeactivatedHandler(() => { calls += 1; });
  globalThis.fetch = (async () => jsonResponse(403, { error: "x", code: "ACCOUNT_DEACTIVATED" })) as typeof fetch;

  await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
  assert.equal(calls, 0);
});

test("a successful (2xx) response never fires the handler", async () => {
  let calls = 0;
  setAccountDeactivatedHandler(() => { calls += 1; });
  globalThis.fetch = (async () => jsonResponse(200, { ok: true })) as typeof fetch;

  const result = await customFetch<{ ok: boolean }>("/api/my/bookings");
  assert.equal(result.ok, true);
  assert.equal(calls, 0);
});

test("no handler registered: an ACCOUNT_DEACTIVATED response still throws normally (no crash from a missing handler)", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Account deactivated.", code: "ACCOUNT_DEACTIVATED" })) as typeof fetch;

  await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
});

test("clearing the handler (passing null) stops it from firing on the next deactivated response", async () => {
  let calls = 0;
  setAccountDeactivatedHandler(() => { calls += 1; });
  setAccountDeactivatedHandler(null);

  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Account deactivated.", code: "ACCOUNT_DEACTIVATED" })) as typeof fetch;

  await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
  assert.equal(calls, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent-failure dedup — mirrors the one-shot guard AppContext.tsx
// registers around setAccountDeactivatedHandler (a boolean flag closed over
// by the effect, since presentCentralAlert/navigation are not naturally
// idempotent the way setUser(null)/router.replace are).
// ─────────────────────────────────────────────────────────────────────────────

test("concurrent 401 ACCOUNT_DEACTIVATED failures across several in-flight requests: a one-shot app-level guard produces exactly one visible effect", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Account deactivated.", code: "ACCOUNT_DEACTIVATED" })) as typeof fetch;

  let alertsShown = 0;
  let navigations = 0;
  let deactivationHandled = false;
  setAccountDeactivatedHandler(() => {
    if (deactivationHandled) return;
    deactivationHandled = true;
    alertsShown += 1;
    navigations += 1;
  });

  const results = await Promise.allSettled([
    customFetch("/api/my/bookings"),
    customFetch("/api/my/packages"),
    customFetch("/api/my/children"),
    customFetch("/api/notifications"),
    customFetch("/api/auth/me"),
  ]);

  assert.ok(results.every((r) => r.status === "rejected"), "every concurrent request rejects with an ApiError");
  assert.equal(alertsShown, 1, "message shown exactly once despite 5 concurrent 401s");
  assert.equal(navigations, 1, "navigation triggered exactly once despite 5 concurrent 401s");
});

// ─────────────────────────────────────────────────────────────────────────────
// New-mobile + old-backend compatibility (Phase B1C, item S).
// Simulates a backend that predates B1B/B1C and never emits ACCOUNT_DEACTIVATED
// in any response shape — proves new mobile code degrades to its pre-existing,
// unmodified 401/SESSION_REVOKED behavior with no crash and no new handler
// ever firing, which is what makes an OTA-first release sequence (mobile ships
// before the backend does) safe.
// ─────────────────────────────────────────────────────────────────────────────

test("old-backend compatibility: a pre-B1B 401 body (no ACCOUNT_DEACTIVATED code ever exists) never fires the new handler, and normal SESSION_REVOKED handling is untouched", async () => {
  let deactivatedCalls = 0;
  let revokedCalls = 0;
  setAccountDeactivatedHandler(() => { deactivatedCalls += 1; });
  setSessionRevokedHandler(() => { revokedCalls += 1; });

  // Old backend's full repertoire of 401 shapes — none of them ever include
  // ACCOUNT_DEACTIVATED because the field/route didn't exist yet.
  const oldBackendBodies = [
    { error: "Missing authentication credentials" },
    { error: "Invalid or expired token" },
    { error: "Invalid token type" },
    { error: "Session expired. Please sign in again.", code: "SESSION_REVOKED" },
  ];

  for (const body of oldBackendBodies) {
    globalThis.fetch = (async () => jsonResponse(401, body)) as typeof fetch;
    await assert.rejects(() => customFetch("/api/my/bookings"), isApiErrorLike);
  }

  assert.equal(deactivatedCalls, 0, "an old backend that never emits this code must never trigger the new handler");
  assert.equal(revokedCalls, 1, "SESSION_REVOKED handling is completely unaffected by the new code existing");
});

test("old-backend compatibility: a successful login response with no code field at all is unaffected", async () => {
  globalThis.fetch = (async () => jsonResponse(200, { accessToken: "jwt", student: { id: 1 } })) as typeof fetch;
  const result = await customFetch<{ accessToken: string }>("/api/auth/login", { method: "POST" });
  assert.equal(result.accessToken, "jwt");
});
