import assert from "node:assert/strict";
import test from "node:test";

/**
 * Focused regression coverage for the Resend → Brevo transactional-email
 * transport swap in authHelpers.ts.
 *
 * Scope: only the HTTP transport (`sendEmail`, reached via the exported
 * `sendOtpEmail`) and the EMAIL_FROM → Brevo `sender` parsing it depends on.
 * OTP generation/storage/expiry/attempts/rate-limiting are NOT exercised here
 * — those functions were not touched by the migration (confirmed by diff:
 * only `getEmailConfig`, the new `parseSenderAddress` helper, and `sendEmail`
 * changed), and re-verifying them would require a live Postgres database,
 * which is disproportionate to a transport-only change. That is the
 * repo-consistent boundary: DB-backed OTP flows already have no automated
 * coverage (per the prior investigation) and adding it is out of scope here.
 *
 * Importing "@workspace/db" (transitively, via authHelpers.ts) requires
 * DATABASE_URL to be set at import time even though no query ever runs in
 * this file — same placeholder pattern as classCapacity.test.ts /
 * backgroundMusic.test.ts.
 */
process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

type CapturedRequest = {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
};

function stubFetch(reply: { ok: boolean; status: number; text?: () => Promise<string> }) {
  const calls: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
    });
    return {
      ok: reply.ok,
      status: reply.status,
      text: reply.text ?? (async () => ""),
    } as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function loadAuthHelpers() {
  return import("./authHelpers");
}

async function loadLogger() {
  return import("./logger");
}

test("Brevo request: endpoint, api-key header, recipient/replyTo/subject/content mapping", async () => {
  const originalEnv = { ...process.env };
  process.env["BREVO_API_KEY"] = "test-brevo-key";
  process.env["EMAIL_FROM"] = "Central Studio <no-reply@centralstudioco.com>";
  process.env["EMAIL_REPLY_TO"] = "support@centralstudioco.com";
  process.env["NODE_ENV"] = "test";

  const fetchStub = stubFetch({ ok: true, status: 201 });
  try {
    const { sendOtpEmail } = await loadAuthHelpers();
    await sendOtpEmail("student@example.com", "123456", "verify");

    assert.equal(fetchStub.calls.length, 1);
    const call = fetchStub.calls[0]!;
    assert.equal(call.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(call.method, "POST");
    assert.equal(call.headers["api-key"], "test-brevo-key");
    assert.equal(call.headers["Content-Type"], "application/json");
    // Brevo's documented auth header is "api-key", not "Authorization: Bearer …" (Resend's shape).
    assert.equal(call.headers["Authorization"], undefined);

    const body = call.body!;
    assert.deepEqual(body["sender"], { name: "Central Studio", email: "no-reply@centralstudioco.com" });
    assert.deepEqual(body["to"], [{ email: "student@example.com" }]);
    assert.deepEqual(body["replyTo"], { email: "support@centralstudioco.com" });
    assert.equal(typeof body["subject"], "string");
    assert.ok((body["subject"] as string).length > 0);
    assert.equal(typeof body["htmlContent"], "string");
    assert.equal(typeof body["textContent"], "string");
    assert.ok((body["textContent"] as string).includes("123456"), "OTP code must reach the email body");
    // Resend's field names must not leak through.
    assert.equal(body["html"], undefined);
    assert.equal(body["text"], undefined);
    assert.equal(body["from"], undefined);
    assert.equal(body["reply_to"], undefined);
  } finally {
    fetchStub.restore();
    process.env = originalEnv;
  }
});

test("EMAIL_FROM parsing: display-name form produces a name + email sender", async () => {
  const originalEnv = { ...process.env };
  process.env["BREVO_API_KEY"] = "test-brevo-key";
  process.env["EMAIL_FROM"] = "Central Studio <no-reply@centralstudioco.com>";
  delete process.env["EMAIL_REPLY_TO"];
  process.env["NODE_ENV"] = "test";

  const fetchStub = stubFetch({ ok: true, status: 201 });
  try {
    const { sendOtpEmail } = await loadAuthHelpers();
    await sendOtpEmail("display-name@example.com", "654321", "reset");
    const body = fetchStub.calls[0]!.body!;
    assert.deepEqual(body["sender"], { name: "Central Studio", email: "no-reply@centralstudioco.com" });
    assert.equal(body["replyTo"], undefined, "replyTo must be omitted when EMAIL_REPLY_TO is unset");
  } finally {
    fetchStub.restore();
    process.env = originalEnv;
  }
});

test("EMAIL_FROM parsing: bare-email form produces a sender with no display name", async () => {
  const originalEnv = { ...process.env };
  process.env["BREVO_API_KEY"] = "test-brevo-key";
  process.env["EMAIL_FROM"] = "no-reply@centralstudioco.com";
  delete process.env["EMAIL_REPLY_TO"];
  process.env["NODE_ENV"] = "test";

  const fetchStub = stubFetch({ ok: true, status: 201 });
  try {
    const { sendOtpEmail } = await loadAuthHelpers();
    await sendOtpEmail("bare-email@example.com", "111222", "verify");
    const body = fetchStub.calls[0]!.body!;
    assert.deepEqual(body["sender"], { email: "no-reply@centralstudioco.com" });
  } finally {
    fetchStub.restore();
    process.env = originalEnv;
  }
});

test("MAIL_FROM fallback: still used when EMAIL_FROM is unset", async () => {
  const originalEnv = { ...process.env };
  process.env["BREVO_API_KEY"] = "test-brevo-key";
  delete process.env["EMAIL_FROM"];
  process.env["MAIL_FROM"] = "Central Studio <no-reply@centralstudioco.com>";
  process.env["NODE_ENV"] = "test";

  const fetchStub = stubFetch({ ok: true, status: 201 });
  try {
    const { sendOtpEmail } = await loadAuthHelpers();
    await sendOtpEmail("fallback@example.com", "333444", "verify");
    const body = fetchStub.calls[0]!.body!;
    assert.deepEqual(body["sender"], { name: "Central Studio", email: "no-reply@centralstudioco.com" });
  } finally {
    fetchStub.restore();
    process.env = originalEnv;
  }
});

test("Brevo non-2xx maps to the existing EmailDeliveryError, without logging the response body or the API key", async () => {
  const originalEnv = { ...process.env };
  process.env["BREVO_API_KEY"] = "super-secret-brevo-key";
  process.env["EMAIL_FROM"] = "Central Studio <no-reply@centralstudioco.com>";
  process.env["NODE_ENV"] = "test";

  const sensitiveBody = JSON.stringify({
    message: "invalid parameter",
    code: "invalid_parameter",
    // Simulates a provider echoing request content back in an error body.
    apiKeyEcho: "super-secret-brevo-key",
  });
  const fetchStub = stubFetch({ ok: false, status: 400, text: async () => sensitiveBody });

  const { sendOtpEmail, EmailDeliveryError } = await loadAuthHelpers();
  const { logger } = await loadLogger();
  const originalLoggerError = logger.error.bind(logger);
  const loggedArgs: unknown[] = [];
  logger.error = ((...args: unknown[]) => {
    loggedArgs.push(args);
  }) as typeof logger.error;

  try {
    await assert.rejects(
      () => sendOtpEmail("student-error@example.com", "555666", "verify"),
      EmailDeliveryError,
    );
    const serializedLogs = JSON.stringify(loggedArgs);
    assert.ok(
      !serializedLogs.includes("super-secret-brevo-key"),
      "logs must never contain the Brevo API key",
    );
    assert.ok(
      !serializedLogs.includes("invalid parameter"),
      "logs must never contain the raw provider response body",
    );
    assert.ok(serializedLogs.includes("400"), "the status code should still be logged for diagnosis");
  } finally {
    logger.error = originalLoggerError;
    fetchStub.restore();
    process.env = originalEnv;
  }
});

test("missing BREVO_API_KEY in production fails closed with EmailProviderConfigurationError and no network call", async () => {
  const originalEnv = { ...process.env };
  delete process.env["BREVO_API_KEY"];
  process.env["EMAIL_FROM"] = "Central Studio <no-reply@centralstudioco.com>";
  process.env["NODE_ENV"] = "production";

  const fetchStub = stubFetch({ ok: true, status: 200 });
  try {
    const { sendOtpEmail, isEmailProviderConfigured, EmailProviderConfigurationError } = await loadAuthHelpers();
    assert.equal(isEmailProviderConfigured(), false);
    await assert.rejects(
      () => sendOtpEmail("student-prod@example.com", "777888", "verify"),
      EmailProviderConfigurationError,
    );
    assert.equal(fetchStub.calls.length, 0, "must not call the provider when unconfigured in production");
  } finally {
    fetchStub.restore();
    process.env = originalEnv;
  }
});

test("missing BREVO_API_KEY outside production no-ops (existing DEV MODE behavior) without a network call", async () => {
  const originalEnv = { ...process.env };
  delete process.env["BREVO_API_KEY"];
  process.env["EMAIL_FROM"] = "Central Studio <no-reply@centralstudioco.com>";
  process.env["NODE_ENV"] = "development";

  const fetchStub = stubFetch({ ok: true, status: 200 });
  try {
    const { sendOtpEmail } = await loadAuthHelpers();
    await sendOtpEmail("student-dev@example.com", "999000", "verify"); // must resolve, not throw
    assert.equal(fetchStub.calls.length, 0, "must not call the provider in dev mode when unconfigured");
  } finally {
    fetchStub.restore();
    process.env = originalEnv;
  }
});
