/**
 * Security Wave — Bot Protection. Server-side verification of a Cloudflare
 * Turnstile challenge token (https://developers.cloudflare.com/turnstile/).
 *
 * WHY TURNSTILE: no mandatory native/EAS dependency (renders in a plain
 * WebView on mobile, a plain <div> on web), a generous free tier, and a
 * simple stateless server-side verify call — no SDK required on either
 * side, just one POST to Cloudflare's siteverify endpoint.
 *
 * AUTHORITATIVE ON THE SERVER. The client only ever submits the opaque
 * challenge token it received from the widget; every accept/reject
 * decision is made here, against Cloudflare's own response — a client that
 * claims "challenge passed" without a token proves nothing.
 *
 * FAIL-CLOSED. If TURNSTILE_SECRET_KEY is not configured, or Cloudflare's
 * endpoint times out / is unreachable / returns something unparseable,
 * verification returns a distinct, non-"ok" result — callers must treat
 * every non-"ok" result as "reject", never silently allow through. This is
 * additive to (never a replacement for) the existing Redis-backed IP/
 * account throttling — see middlewares/authRateLimit.ts.
 */
import { logger } from "./logger";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

export const TURNSTILE_SECRET_KEY = process.env["TURNSTILE_SECRET_KEY"]?.trim() || null;

if (!TURNSTILE_SECRET_KEY) {
  if (process.env["NODE_ENV"] === "production") {
    logger.error(
      "TURNSTILE_SECRET_KEY is not set in production — bot-protected endpoints " +
        "(register, forgot-password, OTP send/resend) will fail closed (503) " +
        "until this is configured.",
    );
  } else {
    logger.warn(
      "TURNSTILE_SECRET_KEY is not set — bot-protected endpoints will fail closed " +
        "(503) in this environment. Tests inject their own secret + mock the " +
        "outbound verify call; local manual testing needs a real key or Cloudflare's " +
        "published always-pass test keys (see Turnstile docs).",
    );
  }
}

export type BotVerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_token" | "not_configured" | "invalid_token" | "provider_timeout" | "provider_unavailable" | "malformed_response" };

// Cloudflare's error-codes vocabulary ("timeout-or-duplicate", "invalid-input-response",
// etc.) all collapse to one outward reason: the TOKEN was rejected, not the
// provider. "timeout-or-duplicate" specifically covers both an expired
// challenge and a replayed (already-consumed) token — Cloudflare's own
// single-use enforcement, satisfying the replay-prevention requirement
// without this module needing to track token usage itself.
function classifyTurnstileErrorCodes(_codes: unknown): BotVerifyResult {
  return { ok: false, reason: "invalid_token" };
}

/**
 * Verifies one Turnstile response token. `expectedHostname` and
 * `expectedAction`, when provided, are cross-checked against Cloudflare's
 * own echoed values (never trusted from the client) — Turnstile widgets
 * accept an `action` attribute for exactly this purpose.
 */
export async function verifyBotToken(params: {
  token: string | null | undefined;
  remoteIp?: string;
  expectedAction?: string;
}): Promise<BotVerifyResult> {
  const { token, remoteIp, expectedAction } = params;

  if (!token || typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing_token" };
  }
  if (!TURNSTILE_SECRET_KEY) {
    return { ok: false, reason: "not_configured" };
  }

  const body = new URLSearchParams();
  body.set("secret", TURNSTILE_SECRET_KEY);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    logger.warn(
      { reason: isTimeout ? "provider_timeout" : "provider_unavailable" },
      "Turnstile verification request failed",
    );
    return { ok: false, reason: isTimeout ? "provider_timeout" : "provider_unavailable" };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    logger.warn({ status: res.status }, "Turnstile verification endpoint returned a non-2xx status");
    return { ok: false, reason: "provider_unavailable" };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    logger.warn("Turnstile verification response was not valid JSON");
    return { ok: false, reason: "malformed_response" };
  }

  if (typeof payload !== "object" || payload === null || typeof (payload as { success?: unknown }).success !== "boolean") {
    logger.warn("Turnstile verification response had an unexpected shape");
    return { ok: false, reason: "malformed_response" };
  }

  const result = payload as { success: boolean; action?: string; hostname?: string; "error-codes"?: unknown };

  if (!result.success) {
    logger.info({ errorCodes: result["error-codes"] }, "Turnstile verification rejected the token");
    return classifyTurnstileErrorCodes(result["error-codes"]);
  }

  // Cross-check the action, when the caller told us what to expect —
  // Turnstile echoes back the `action` the widget was configured with, so
  // a token minted for a DIFFERENT protected action cannot be replayed here.
  if (expectedAction && result.action && result.action !== expectedAction) {
    logger.info({ expectedAction, actualAction: result.action }, "Turnstile token action mismatch");
    return { ok: false, reason: "invalid_token" };
  }

  return { ok: true };
}

export function isBotProtectionConfigured(): boolean {
  return TURNSTILE_SECRET_KEY !== null;
}
