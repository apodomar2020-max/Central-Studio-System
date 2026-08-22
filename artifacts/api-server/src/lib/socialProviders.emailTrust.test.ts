/**
 * Security-01B1 — email-trust tier mapping, against the REAL socialProviders
 * module (no mock.module here; that suite lives in
 * routes/socialAuth.linking.integration.test.ts).
 *
 * This is the other half of the CS-SEC-C-01 fix: routes/socialAuth.ts decides
 * whether a provider identity may attach to a pre-existing account using
 * `emailTrust` and nothing else, so the correctness of that decision rests
 * entirely on the mapping asserted below.
 *
 * `globalThis.fetch` is stubbed for every case — no network call is made and
 * no real provider token is used.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import {
  verifyProviderToken,
  ProviderNotConfiguredError,
  ProviderTokenInvalidError,
} from "./socialProviders";

const realFetch = globalThis.fetch;

/** Queue of canned responses, consumed in order by the stubbed fetch. */
let responses: Array<{ ok: boolean; body: unknown }> = [];
let requestedUrls: string[] = [];

beforeEach(() => {
  responses = [];
  requestedUrls = [];
  globalThis.fetch = (async (input: unknown) => {
    requestedUrls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${String(input)}`);
    return { ok: next.ok, json: async () => next.body } as Response;
  }) as typeof fetch;

  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.FACEBOOK_APP_ID = "test-fb-app-id";
  process.env.FACEBOOK_APP_SECRET = "test-fb-app-secret";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── Google ──────────────────────────────────────────────────────────────────
describe("google email trust", () => {
  const base = { aud: "test-google-client-id", sub: "google-sub-1", name: "G User" };

  test("email + email_verified true (boolean) => provider_attested", async () => {
    responses = [{ ok: true, body: { ...base, email: "A@Example.com", email_verified: true } }];
    const id = await verifyProviderToken("google", "tok");
    assert.equal(id.emailTrust, "provider_attested");
    assert.equal(id.email, "a@example.com", "normalized to lowercase");
  });

  test('email + email_verified "true" (string) => provider_attested', async () => {
    responses = [{ ok: true, body: { ...base, email: "a@example.com", email_verified: "true" } }];
    assert.equal((await verifyProviderToken("google", "tok")).emailTrust, "provider_attested");
  });

  // V3: this is the case that previously still linked to a pre-existing account.
  test("email present but email_verified false => provider_asserted", async () => {
    responses = [{ ok: true, body: { ...base, email: "a@example.com", email_verified: false } }];
    const id = await verifyProviderToken("google", "tok");
    assert.equal(id.emailTrust, "provider_asserted");
    assert.equal(id.email, "a@example.com");
  });

  test("email present, email_verified absent => provider_asserted (fails closed)", async () => {
    responses = [{ ok: true, body: { ...base, email: "a@example.com" } }];
    assert.equal((await verifyProviderToken("google", "tok")).emailTrust, "provider_asserted");
  });

  test('email_verified "false" string is NOT treated as attested', async () => {
    responses = [{ ok: true, body: { ...base, email: "a@example.com", email_verified: "false" } }];
    assert.equal((await verifyProviderToken("google", "tok")).emailTrust, "provider_asserted");
  });

  // V2: token minted without the `email` scope carries no email claim.
  test("no email claim at all => none", async () => {
    responses = [{ ok: true, body: { ...base, email_verified: true } }];
    const id = await verifyProviderToken("google", "tok");
    assert.equal(id.emailTrust, "none");
    assert.equal(id.email, null);
  });

  test("audience mismatch is rejected before any trust is computed", async () => {
    responses = [{ ok: true, body: { ...base, aud: "someone-elses-client-id", email: "a@example.com", email_verified: true } }];
    await assert.rejects(() => verifyProviderToken("google", "tok"), ProviderTokenInvalidError);
  });

  test("missing GOOGLE_CLIENT_ID fails closed without a network call", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await assert.rejects(() => verifyProviderToken("google", "tok"), ProviderNotConfiguredError);
    assert.equal(requestedUrls.length, 0);
  });
});

// ─── Facebook ────────────────────────────────────────────────────────────────
describe("facebook email trust", () => {
  const debugOk = { ok: true, body: { data: { app_id: "test-fb-app-id", is_valid: true, user_id: "fb-1" } } };

  // The core of invariant 8: Graph exposes no verification signal, so a
  // returned address can never be more than asserted.
  test("email present => provider_asserted, never provider_attested", async () => {
    responses = [debugOk, { ok: true, body: { id: "fb-1", name: "F User", email: "B@Example.com" } }];
    const id = await verifyProviderToken("facebook", "tok");
    assert.equal(id.emailTrust, "provider_asserted");
    assert.equal(id.email, "b@example.com");
  });

  // V1: the user declined the `email` permission at the consent dialog.
  test("no email returned => none", async () => {
    responses = [debugOk, { ok: true, body: { id: "fb-1", name: "F User" } }];
    const id = await verifyProviderToken("facebook", "tok");
    assert.equal(id.emailTrust, "none");
    assert.equal(id.email, null);
  });

  test("token minted for a DIFFERENT facebook app is rejected", async () => {
    responses = [{ ok: true, body: { data: { app_id: "other-app", is_valid: true, user_id: "fb-1" } } }];
    await assert.rejects(() => verifyProviderToken("facebook", "tok"), ProviderTokenInvalidError);
  });

  test("invalid token is rejected", async () => {
    responses = [{ ok: true, body: { data: { app_id: "test-fb-app-id", is_valid: false, user_id: "fb-1" } } }];
    await assert.rejects(() => verifyProviderToken("facebook", "tok"), ProviderTokenInvalidError);
  });

  test("missing app credentials fail closed without a network call", async () => {
    delete process.env.FACEBOOK_APP_SECRET;
    await assert.rejects(() => verifyProviderToken("facebook", "tok"), ProviderNotConfiguredError);
    assert.equal(requestedUrls.length, 0);
  });

  test("the app secret is never sent to Facebook as the input_token", async () => {
    responses = [debugOk, { ok: true, body: { id: "fb-1", email: "b@example.com" } }];
    await verifyProviderToken("facebook", "tok");
    const debugUrl = requestedUrls[0];
    assert.match(debugUrl, /input_token=tok/);
    assert.match(debugUrl, /access_token=test-fb-app-id%7Ctest-fb-app-secret/);
  });
});

// ─── Apple ───────────────────────────────────────────────────────────────────
describe("apple stays fail-closed", () => {
  test("always throws ProviderNotConfiguredError and makes no network call", async () => {
    process.env.APPLE_CLIENT_ID = "should-be-ignored";
    await assert.rejects(
      () => verifyProviderToken("apple", "any-token"),
      (err: unknown) => {
        assert.ok(err instanceof ProviderNotConfiguredError);
        assert.deepEqual((err as ProviderNotConfiguredError).requiredEnv, ["APPLE_CLIENT_ID"]);
        return true;
      },
    );
    assert.equal(requestedUrls.length, 0, "no JWKS fetch, no token introspection, nothing");
    delete process.env.APPLE_CLIENT_ID;
  });
});
