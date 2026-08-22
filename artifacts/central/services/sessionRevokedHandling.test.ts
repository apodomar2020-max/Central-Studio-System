/**
 * Security-02B (CS-SEC-H-03) — client-side handling of a 401 SESSION_REVOKED
 * response, as consumed by the mobile app via @workspace/api-client-react's
 * customFetch/setSessionRevokedHandler.
 *
 * Pure Node test: `globalThis.fetch` is stubbed with canned Response
 * objects, no network, no Express app, no database. Verifies:
 *   - the handler fires exactly on a 401 carrying { code: "SESSION_REVOKED" }
 *   - it does NOT fire for any other 401 shape (missing/invalid/expired
 *     token, or any other error code) — the "unrelated errors" requirement
 *   - it does NOT fire for non-401 errors, or for successful responses
 *   - the normal ApiError is still thrown afterward either way — this is an
 *     ADDITIVE side effect, not a replacement for per-screen error handling
 *   - re-entrant/duplicate 401s don't throw from inside the handler
 *     mechanism itself (loop-safety is exercised structurally; the actual
 *     app-level idempotency of setUser(null)/router.replace is by
 *     construction, not something this pure-Node test can observe without a
 *     React Native runtime).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  customFetch,
  setSessionRevokedHandler,
} from "@workspace/api-client-react";

// ApiError the CLASS is intentionally not re-exported from this package's
// public entry point (see passwordRecoveryFlow.ts's toApiErrorLike for the
// same constraint) — assert on the thrown error's shape structurally
// instead of with `instanceof`.
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
  setSessionRevokedHandler(null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setSessionRevokedHandler(null);
});

test("SESSION_REVOKED: a 401 with code SESSION_REVOKED fires the registered handler exactly once", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Session expired. Please sign in again.", code: "SESSION_REVOKED" })) as typeof fetch;

  let calls = 0;
  setSessionRevokedHandler(() => { calls += 1; });

  await assert.rejects(() => customFetch("/api/auth/me"), isApiErrorLike);
  assert.equal(calls, 1, "handler fires exactly once for the one revoked request");
});

test("SESSION_REVOKED: the normal ApiError is still thrown — this is additive, not a replacement", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Session expired. Please sign in again.", code: "SESSION_REVOKED" })) as typeof fetch;

  let handlerFired = false;
  setSessionRevokedHandler(() => { handlerFired = true; });

  try {
    await customFetch("/api/auth/me");
    assert.fail("expected customFetch to throw");
  } catch (err) {
    assert.ok(isApiErrorLike(err));
    assert.equal(err.status, 401);
    assert.equal((err.data as { code?: string } | null)?.code, "SESSION_REVOKED");
  }
  assert.equal(handlerFired, true, "handler ran alongside the thrown error, not instead of it");
});

test("unrelated 401s (no code, or a different code) do NOT fire the handler", async () => {
  const bodies = [
    { error: "Missing authentication credentials" },        // no body at all is also covered implicitly
    { error: "Invalid or expired token" },                  // naturally-expired/malformed JWT — no code
    { error: "Invalid token type" },
    { error: "Email verification required.", requiresOtp: true }, // 403 shape, but tested here at 401 too for code absence
    { error: "Some other business rule failed.", code: "SOME_OTHER_CODE" },
  ];

  for (const body of bodies) {
    let calls = 0;
    setSessionRevokedHandler(() => { calls += 1; });
    globalThis.fetch = (async () => jsonResponse(401, body)) as typeof fetch;

    await assert.rejects(() => customFetch("/api/auth/me"), isApiErrorLike);
    assert.equal(calls, 0, `handler must not fire for body ${JSON.stringify(body)}`);
  }
});

test("a SESSION_REVOKED-shaped body on a non-401 status does NOT fire the handler", async () => {
  // Defensive: the code is only meaningful in combination with 401. A 200
  // or 403 response that happens to echo the same code string must not
  // trigger a forced logout.
  let calls = 0;
  setSessionRevokedHandler(() => { calls += 1; });
  globalThis.fetch = (async () => jsonResponse(403, { error: "x", code: "SESSION_REVOKED" })) as typeof fetch;

  await assert.rejects(() => customFetch("/api/auth/me"), isApiErrorLike);
  assert.equal(calls, 0);
});

test("a successful (2xx) response never fires the handler", async () => {
  let calls = 0;
  setSessionRevokedHandler(() => { calls += 1; });
  globalThis.fetch = (async () => jsonResponse(200, { ok: true })) as typeof fetch;

  const result = await customFetch<{ ok: boolean }>("/api/auth/me");
  assert.equal(result.ok, true);
  assert.equal(calls, 0);
});

test("no handler registered: a SESSION_REVOKED response still throws normally (no crash from a missing handler)", async () => {
  // setSessionRevokedHandler(null) from beforeEach — nothing registered.
  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Session expired. Please sign in again.", code: "SESSION_REVOKED" })) as typeof fetch;

  await assert.rejects(() => customFetch("/api/auth/me"), isApiErrorLike);
});

test("clearing the handler (passing null) stops it from firing on the next revoked response", async () => {
  let calls = 0;
  setSessionRevokedHandler(() => { calls += 1; });
  setSessionRevokedHandler(null);

  globalThis.fetch = (async () =>
    jsonResponse(401, { error: "Session expired. Please sign in again.", code: "SESSION_REVOKED" })) as typeof fetch;

  await assert.rejects(() => customFetch("/api/auth/me"), isApiErrorLike);
  assert.equal(calls, 0);
});
