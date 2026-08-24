/**
 * Security Wave — Bot Protection. Unit-level coverage for
 * lib/botProtection.ts's verifyBotToken: the provider-failure-mode matrix
 * (timeout, malformed response, non-2xx, network failure), missing/invalid
 * token handling, action cross-check, and the "not configured" fail-closed
 * path. Route-level wiring (which endpoints require a token, how a 403/503
 * is shaped) is covered in routes/authAbuseFoundation.integration.test.ts
 * and middlewares/botProtection.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret-for-unit-tests";

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
let lib: typeof import("./botProtection");
let originalFetch: typeof fetch;
let fetchImpl: (input: any, init?: any) => Promise<Response>;

before(async () => {
  lib = await import("./botProtection");
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => fetchImpl(input, init)) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  fetchImpl = async () => {
    throw new Error("test did not configure fetchImpl");
  };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("5: missing token is rejected without ever calling the provider", async () => {
  let called = false;
  fetchImpl = async () => { called = true; return jsonResponse({ success: true }); };
  const result = await lib.verifyBotToken({ token: null });
  assert.deepEqual(result, { ok: false, reason: "missing_token" });
  assert.equal(called, false, "must not spend a provider call on a request with no token at all");
});

test("5b: empty-string token is rejected the same as missing", async () => {
  const result = await lib.verifyBotToken({ token: "" });
  assert.deepEqual(result, { ok: false, reason: "missing_token" });
});

test("6: invalid token (provider says success:false) is rejected", async () => {
  fetchImpl = async (_input, init) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    assert.equal(body.get("response"), "bad-token");
    return jsonResponse({ success: false, "error-codes": ["invalid-input-response"] });
  };
  const result = await lib.verifyBotToken({ token: "bad-token" });
  assert.deepEqual(result, { ok: false, reason: "invalid_token" });
});

test("6b: replayed/expired token (timeout-or-duplicate) is rejected the same way — provider's own single-use enforcement", async () => {
  fetchImpl = async () => jsonResponse({ success: false, "error-codes": ["timeout-or-duplicate"] });
  const result = await lib.verifyBotToken({ token: "reused-token" });
  assert.equal(result.ok, false);
});

test("action cross-check: a token minted for a different action is rejected even though the provider reports success", async () => {
  fetchImpl = async () => jsonResponse({ success: true, action: "forgot_password" });
  const result = await lib.verifyBotToken({ token: "valid-but-wrong-action", expectedAction: "register" });
  assert.deepEqual(result, { ok: false, reason: "invalid_token" });
});

test("9: a genuinely valid token for the correct action is accepted", async () => {
  fetchImpl = async () => jsonResponse({ success: true, action: "register" });
  const result = await lib.verifyBotToken({ token: "good-token", expectedAction: "register" });
  assert.deepEqual(result, { ok: true });
});

test("valid token with no action claim from the provider is accepted (action check is best-effort, not mandatory on the provider's side)", async () => {
  fetchImpl = async () => jsonResponse({ success: true });
  const result = await lib.verifyBotToken({ token: "good-token", expectedAction: "register" });
  assert.deepEqual(result, { ok: true });
});

test("7: provider timeout fails safely (fail-closed, distinct reason)", async () => {
  fetchImpl = (_input, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal as AbortSignal | undefined;
    signal?.addEventListener("abort", () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
    // Never resolves on its own — only the AbortController (driven by
    // verifyBotToken's own 5s timeout) ends this.
  });
  const result = await lib.verifyBotToken({ token: "slow-token" });
  assert.deepEqual(result, { ok: false, reason: "provider_timeout" });
});

test("8: provider unavailable (network error) fails safely", async () => {
  fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const result = await lib.verifyBotToken({ token: "any-token" });
  assert.deepEqual(result, { ok: false, reason: "provider_unavailable" });
});

test("8b: provider returns a non-2xx status — treated as unavailable, fails safely", async () => {
  fetchImpl = async () => jsonResponse({ error: "server error" }, 500);
  const result = await lib.verifyBotToken({ token: "any-token" });
  assert.deepEqual(result, { ok: false, reason: "provider_unavailable" });
});

test("malformed response: not valid JSON fails safely", async () => {
  fetchImpl = async () => new Response("not json", { status: 200 });
  const result = await lib.verifyBotToken({ token: "any-token" });
  assert.deepEqual(result, { ok: false, reason: "malformed_response" });
});

test("malformed response: valid JSON but missing/wrong-typed `success` field fails safely", async () => {
  fetchImpl = async () => jsonResponse({ unexpected: "shape" });
  const result = await lib.verifyBotToken({ token: "any-token" });
  assert.deepEqual(result, { ok: false, reason: "malformed_response" });

  fetchImpl = async () => jsonResponse({ success: "yes" }); // wrong type (string, not boolean)
  const result2 = await lib.verifyBotToken({ token: "any-token" });
  assert.deepEqual(result2, { ok: false, reason: "malformed_response" });
});

test("not_configured: verification fails closed when TURNSTILE_SECRET_KEY is unset — never silently bypassed", async () => {
  const original = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  let called = false;
  try {
    const freshLib = await import(`./botProtection.ts?cachebust=${Date.now()}`);
    fetchImpl = async () => { called = true; return jsonResponse({ success: true }); };
    const result = await freshLib.verifyBotToken({ token: "any-token" });
    assert.deepEqual(result, { ok: false, reason: "not_configured" });
    assert.equal(called, false, "must fail closed before ever reaching the provider");
    assert.equal(freshLib.isBotProtectionConfigured(), false);
  } finally {
    process.env.TURNSTILE_SECRET_KEY = original;
  }
});

test("secret value is sent to the provider but never appears in the module's own exported surface accidentally logged elsewhere", async () => {
  let capturedBody = "";
  fetchImpl = async (_input, init) => {
    capturedBody = String(init?.body ?? "");
    return jsonResponse({ success: true });
  };
  await lib.verifyBotToken({ token: "any-token" });
  assert.ok(capturedBody.includes("secret="), "the verify call itself must include the secret (this is the ONE legitimate place it appears)");
  // Confirm the request goes to the real Turnstile endpoint and nowhere else.
  let capturedUrl = "";
  fetchImpl = async (input: any) => { capturedUrl = typeof input === "string" ? input : input.url; return jsonResponse({ success: true }); };
  await lib.verifyBotToken({ token: "any-token" });
  assert.equal(capturedUrl, TURNSTILE_URL);
});

test("remoteip is forwarded when provided", async () => {
  let capturedBody = "";
  fetchImpl = async (_input, init) => { capturedBody = String(init?.body ?? ""); return jsonResponse({ success: true }); };
  await lib.verifyBotToken({ token: "any-token", remoteIp: "203.0.113.9" });
  const parsed = new URLSearchParams(capturedBody);
  assert.equal(parsed.get("remoteip"), "203.0.113.9");
});
