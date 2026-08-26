import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, instagramToken } from "@workspace/db";
import { logger } from "../lib/logger";
import { ipRateLimiter } from "../middlewares/authRateLimit";
import {
  decryptThirdPartyToken,
  encryptThirdPartyToken,
  TokenDecryptionError,
  TokenEncryptionConfigurationError,
  tokenEncryptionKeyringFromEnv,
} from "../lib/thirdPartyTokenCrypto";

const router = Router();

interface InstagramReel {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

interface InstagramTokenResponse {
  access_token?: string;
  expires_in?: number;
}

const TOKEN_CONTEXT = "instagram_access_token";
const CACHE_TTL_MS = 60 * 60 * 1000;
const REFRESH_AFTER_DAYS = 30;

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// This public route can trigger a third-party Graph API request on a cold or
// expired cache. Reuse the distributed limiter, but keep ordinary catalog GETs
// unlimited. The in-process cache remains the primary traffic reducer.
const instagramReelsLimiter = ipRateLimiter("instagram-reels", {
  limit: positiveIntegerEnv("INSTAGRAM_REELS_IP_LIMIT", 60),
  windowSeconds: 60,
  message: "Too many requests. Please try again later.",
});

let reelsCache: { data: InstagramReel[]; fetchedAt: number } | null = null;
let tokenInMemory: string | null = null;
let tokenRefreshedAt: Date | null = null;
let tokenProviderRevision: string | null = null;

function encryptedValues(token: string) {
  const envelope = encryptThirdPartyToken(token, TOKEN_CONTEXT, tokenEncryptionKeyringFromEnv());
  return {
    accessToken: null,
    accessTokenCiphertext: envelope.ciphertext,
    accessTokenIv: envelope.iv,
    accessTokenAuthTag: envelope.authTag,
    encryptionKeyVersion: envelope.keyVersion,
  };
}

async function saveToken(token: string, providerTokenRevision: string | null = tokenProviderRevision): Promise<void> {
  const now = new Date();
  const envelope = encryptedValues(token);
  await db
    .insert(instagramToken)
    .values({ id: 1, ...envelope, providerTokenRevision, refreshedAt: now })
    .onConflictDoUpdate({
      target: instagramToken.id,
      set: { ...envelope, providerTokenRevision, refreshedAt: now },
    });
  tokenInMemory = token;
  tokenRefreshedAt = now;
  tokenProviderRevision = providerTokenRevision;
}

async function getToken(): Promise<string | null> {
  if (tokenInMemory) return tokenInMemory;

  // Validate the API-only key before reading legacy plaintext. A missing or
  // malformed key fails closed and never causes plaintext to be returned.
  const keyring = tokenEncryptionKeyringFromEnv();
  const [row] = await db.select().from(instagramToken).limit(1);
  const envToken = process.env["INSTAGRAM_ACCESS_TOKEN"]?.trim();
  const envRevision = process.env["INSTAGRAM_ACCESS_TOKEN_REVISION"]?.trim();
  if (envRevision && !/^[A-Za-z0-9._-]{1,64}$/.test(envRevision)) {
    throw new TokenEncryptionConfigurationError();
  }
  if (row) {
    // A new non-secret revision label is the explicit rotation signal. The
    // replacement arrives via Railway secret storage and is encrypted before
    // it reaches Postgres; no plaintext SQL update or provider token log is
    // needed. Without a new revision, the env bootstrap never overrides DB.
    if (envToken && envRevision && row.providerTokenRevision !== envRevision) {
      await saveToken(envToken, envRevision);
      logger.info({ event: "instagram_provider_token_rotated" }, "Instagram provider token replaced through encrypted storage");
      return tokenInMemory;
    }

    // During a rolling deployment an older instance may have refreshed the
    // legacy plaintext column. Prefer and immediately migrate that value so
    // the newest token wins, then erase the plaintext in the same DB update.
    if (row.accessToken) {
      const envelope = encryptThirdPartyToken(row.accessToken, TOKEN_CONTEXT, keyring);
      await db
        .update(instagramToken)
        .set({
          accessToken: null,
          accessTokenCiphertext: envelope.ciphertext,
          accessTokenIv: envelope.iv,
          accessTokenAuthTag: envelope.authTag,
          encryptionKeyVersion: envelope.keyVersion,
        })
        .where(eq(instagramToken.id, row.id));
      tokenInMemory = row.accessToken;
      tokenRefreshedAt = row.refreshedAt;
      tokenProviderRevision = row.providerTokenRevision;
      logger.info({ event: "instagram_token_plaintext_migrated" }, "Instagram token migrated to encrypted storage");
      return tokenInMemory;
    }

    if (
      row.accessTokenCiphertext
      && row.accessTokenIv
      && row.accessTokenAuthTag
      && row.encryptionKeyVersion
    ) {
      const decrypted = decryptThirdPartyToken({
        ciphertext: row.accessTokenCiphertext,
        iv: row.accessTokenIv,
        authTag: row.accessTokenAuthTag,
        keyVersion: row.encryptionKeyVersion,
      }, TOKEN_CONTEXT, keyring);
      if (row.encryptionKeyVersion !== keyring.currentVersion) {
        const envelope = encryptThirdPartyToken(decrypted, TOKEN_CONTEXT, keyring);
        await db
          .update(instagramToken)
          .set({
            accessToken: null,
            accessTokenCiphertext: envelope.ciphertext,
            accessTokenIv: envelope.iv,
            accessTokenAuthTag: envelope.authTag,
            encryptionKeyVersion: envelope.keyVersion,
          })
          .where(eq(instagramToken.id, row.id));
        logger.info({ event: "instagram_token_key_rewrapped" }, "Instagram token rewrapped with current encryption key");
      }
      tokenInMemory = decrypted;
      tokenRefreshedAt = row.refreshedAt;
      tokenProviderRevision = row.providerTokenRevision;
      return tokenInMemory;
    }

    throw new TokenDecryptionError();
  }

  // A provider token may be supplied once as a Railway secret to bootstrap a
  // fresh database. It is encrypted before any database write.
  if (envToken) {
    await saveToken(envToken, envRevision ?? null);
    logger.info({ event: "instagram_token_bootstrapped" }, "Instagram token bootstrapped into encrypted storage");
    return tokenInMemory;
  }

  return null;
}

async function refreshTokenIfNeeded(): Promise<void> {
  if (!tokenInMemory || !tokenRefreshedAt) return;
  const daysSince = (Date.now() - tokenRefreshedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < REFRESH_AFTER_DAYS) return;

  try {
    const endpoint = new URL("https://graph.instagram.com/refresh_access_token");
    endpoint.searchParams.set("grant_type", "ig_refresh_token");
    endpoint.searchParams.set("access_token", tokenInMemory);
    const response = await fetch(endpoint);
    const data = await response.json().catch(() => ({})) as InstagramTokenResponse;
    if (!response.ok || typeof data.access_token !== "string" || data.access_token.length === 0) {
      logger.warn(
        { event: "instagram_token_refresh_failed", providerStatus: response.status },
        "Instagram token refresh was rejected",
      );
      return;
    }
    await saveToken(data.access_token);
    logger.info({ event: "instagram_token_refreshed" }, "Instagram token refreshed and encrypted");
  } catch {
    // Fetch errors can include request URLs. The access token is a query
    // parameter on Meta's refresh endpoint, so log only a safe reason code.
    logger.warn({ event: "instagram_token_refresh_failed", reason: "network_or_storage" }, "Instagram token refresh failed");
  }
}

router.get("/instagram/reels", instagramReelsLimiter, async (_req, res) => {
  const userId = process.env["INSTAGRAM_USER_ID"]?.trim();
  let token: string | null;
  try {
    token = await getToken();
  } catch (error) {
    const reason = error instanceof TokenEncryptionConfigurationError
      ? "encryption_configuration"
      : error instanceof TokenDecryptionError
        ? "encrypted_token_invalid"
        : "storage_unavailable";
    logger.error({ event: "instagram_token_unavailable", reason }, "Instagram token unavailable");
    return res.status(503).json({ error: "Instagram not configured" });
  }

  if (!userId || !token) {
    return res.status(503).json({ error: "Instagram not configured" });
  }

  res.setHeader("Cache-Control", "public, max-age=300, stale-if-error=3600");
  if (reelsCache && Date.now() - reelsCache.fetchedAt < CACHE_TTL_MS) {
    return res.json({ reels: reelsCache.data });
  }

  try {
    const endpoint = new URL(`https://graph.instagram.com/v19.0/${encodeURIComponent(userId)}/media`);
    endpoint.searchParams.set("fields", "id,media_type,media_url,thumbnail_url,permalink,timestamp");
    endpoint.searchParams.set("limit", "24");
    endpoint.searchParams.set("access_token", token);

    const response = await fetch(endpoint);
    const data = await response.json().catch(() => ({})) as { data?: InstagramReel[] };
    if (!response.ok || !Array.isArray(data.data)) {
      logger.warn(
        { event: "instagram_reels_fetch_failed", providerStatus: response.status },
        "Instagram reels request was rejected",
      );
      if (reelsCache) return res.json({ reels: reelsCache.data });
      return res.status(502).json({ error: "Failed to fetch from Instagram" });
    }

    const reels = data.data
      .filter((media) => media.media_type === "REEL" || media.media_type === "VIDEO")
      .slice(0, 12);
    reelsCache = { data: reels, fetchedAt: Date.now() };
    void refreshTokenIfNeeded();
    return res.json({ reels });
  } catch {
    // Do not attach the fetch error: it may include Meta request URL details.
    logger.warn({ event: "instagram_reels_fetch_failed", reason: "network" }, "Instagram reels request failed");
    if (reelsCache) return res.json({ reels: reelsCache.data });
    return res.status(502).json({ error: "Failed to fetch from Instagram" });
  }
});

export default router;
