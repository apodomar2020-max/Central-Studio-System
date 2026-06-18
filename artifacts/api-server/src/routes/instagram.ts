import { Router } from "express";

const router = Router();

interface InstagramReel {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

// Simple in-memory cache — survives restarts poorly but avoids hammering the API.
// On Railway the server is long-lived so this is good enough.
let reelsCache: { data: InstagramReel[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

router.get("/api/instagram/reels", async (req, res) => {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token  = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !token) {
    return res.status(503).json({ error: "Instagram not configured" });
  }

  // Return cached data if still fresh
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
    const igData = await igRes.json();

    if (!igRes.ok || igData.error) {
      console.error("[instagram] API error:", igData.error ?? igRes.status);
      // Serve stale cache rather than an error if we have one
      if (reelsCache) return res.json({ reels: reelsCache.data });
      return res.status(502).json({ error: "Failed to fetch from Instagram" });
    }

    // Keep only Reels/Videos, cap at 12
    const reels: InstagramReel[] = (igData.data ?? [])
      .filter((m: InstagramReel) => m.media_type === "REEL" || m.media_type === "VIDEO")
      .slice(0, 12);

    reelsCache = { data: reels, fetchedAt: Date.now() };
    return res.json({ reels });
  } catch (err) {
    console.error("[instagram] fetch error:", err);
    if (reelsCache) return res.json({ reels: reelsCache.data });
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
