import { Router } from "express";
import { db, instagramToken } from "@workspace/db";

const router = Router();

interface InstagramReel {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

// ─── Reels cache ─────────────────────────────────────────────────────────────
let reelsCache: { data: InstagramReel[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Token management ─────────────────────────────────────────────────────────
// Long-lived tokens are valid 60 days. We refresh every 30 days so there is
// always 30+ days of headroom even if Railway restarts between refreshes.
// The refreshed token is stored in Postgres so it survives restarts.

let tokenInMemory: string | null = null;
let tokenRefreshedAt: Date | null = null;
const REFRESH_AFTER_DAYS = 30;

async function getToken(): Promise<string | null> {
  // Return in-memory token if already loaded this process
  if (tokenInMemory) return tokenInMemory;

  // Try to load from DB (survives restarts)
  try {
    const rows = await db.select().from(instagramToken).limit(1);
    if (rows.length > 0) {
      tokenInMemory   = rows[0].accessToken;
      tokenRefreshedAt = rows[0].refreshedAt;
      console.log("[instagram] Loaded token from DB, refreshed at", tokenRefreshedAt);
      return tokenInMemory;
    }
  } catch (err) {
    console.warn("[instagram] Could not load token from DB:", err);
  }

  // Fallback: bootstrap from env var and persist to DB for future restarts
  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (envToken) {
    console.log("[instagram] Bootstrapping token from env var into DB");
    await saveToken(envToken);
    return envToken;
  }

  return null;
}

async function saveToken(token: string): Promise<void> {
  try {
    await db
      .insert(instagramToken)
      .values({ id: 1, accessToken: token, refreshedAt: new Date() })
      .onConflictDoUpdate({
        target: instagramToken.id,
        set: { accessToken: token, refreshedAt: new Date() },
      });
    tokenInMemory    = token;
    tokenRefreshedAt = new Date();
  } catch (err) {
    console.error("[instagram] Failed to save token to DB:", err);
  }
}

async function refreshTokenIfNeeded(): Promise<void> {
  if (!tokenInMemory || !tokenRefreshedAt) return;

  const daysSince = (Date.now() - tokenRefreshedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < REFRESH_AFTER_DAYS) return;

  console.log(`[instagram] Token is ${Math.floor(daysSince)} days old — refreshing…`);
  try {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token` +
      `?grant_type=ig_refresh_token&access_token=${tokenInMemory}`
    );
    const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: any };
    if (data.access_token) {
      await saveToken(data.access_token);
      const validDays = Math.round((data.expires_in ?? 5184000) / 86400);
      console.log(`[instagram] Token refreshed. Valid for ${validDays} more days.`);
    } else {
      console.error("[instagram] Token refresh failed:", data.error ?? data);
    }
  } catch (err) {
    console.error("[instagram] Token refresh error:", err);
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────
router.get("/instagram/reels", async (req, res) => {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token  = await getToken();

  if (!userId || !token) {
    return res.status(503).json({ error: "Instagram not configured" });
  }

  // Serve from cache if still fresh
  if (reelsCache && Date.now() - reelsCache.fetchedAt < CACHE_TTL_MS) {
    return res.json({ reels: reelsCache.data });
  }

  try {
    const url =
      `https://graph.instagram.com/v19.0/${userId}/media` +
      `?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp` +
      `&limit=24` +
      `&access_token=${token}`;

    const igRes  = await fetch(url);
    const igData = (await igRes.json()) as { data?: InstagramReel[]; error?: any };

    if (!igRes.ok || igData.error) {
      console.error("[instagram] API error:", igData.error ?? igRes.status);
      if (reelsCache) return res.json({ reels: reelsCache.data });
      return res.status(502).json({ error: "Failed to fetch from Instagram" });
    }

    const reels: InstagramReel[] = (igData.data ?? [])
      .filter((m: InstagramReel) => m.media_type === "REEL" || m.media_type === "VIDEO")
      .slice(0, 12);

    reelsCache = { data: reels, fetchedAt: Date.now() };

    // Refresh token in background if it's >30 days old — doesn't delay response
    refreshTokenIfNeeded().catch(console.error);

    return res.json({ reels });
  } catch (err) {
    console.error("[instagram] fetch error:", err);
    if (reelsCache) return res.json({ reels: reelsCache.data });
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
