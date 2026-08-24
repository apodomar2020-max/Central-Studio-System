/**
 * Security Wave — Bot Protection. Express middleware wrapping
 * lib/botProtection.ts's verifyBotToken. Placed AFTER the IP-scoped Redis
 * limiter and BEFORE the account-scoped limiter on each protected route
 * (see routes/auth.ts) — the IP limiter bounds worst-case outbound
 * verification-call volume against Cloudflare before we ever make one; the
 * account limiter then still applies to whatever gets a valid token, so
 * challenge-passing does not grant unlimited attempts against one account.
 */
import type { NextFunction, Request, Response } from "express";
import { verifyBotToken } from "../lib/botProtection";

const GENERIC_REJECTED = {
  error: "We couldn't verify this request. Please try again.",
  code: "BOT_VERIFICATION_FAILED",
} as const;
const GENERIC_UNAVAILABLE = {
  error: "This action is temporarily unavailable. Please try again shortly.",
  code: "BOT_VERIFICATION_UNAVAILABLE",
} as const;

/** Reasons where the PROVIDER itself is the problem, not the token — fail closed with 503, not 403. */
const UNAVAILABLE_REASONS = new Set(["not_configured", "provider_timeout", "provider_unavailable"]);

export function requireBotToken(action: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = (req.body as { botToken?: unknown } | undefined)?.botToken;
    const result = await verifyBotToken({
      token: typeof token === "string" ? token : null,
      remoteIp: req.ip,
      expectedAction: action,
    });
    if (result.ok) {
      next();
      return;
    }
    if (UNAVAILABLE_REASONS.has(result.reason)) {
      res.status(503).json(GENERIC_UNAVAILABLE);
      return;
    }
    res.status(403).json(GENERIC_REJECTED);
  };
}
