/**
 * Server-side validation for Website Backgrounds media URLs (Website CMS
 * Wave 1). This is the trust boundary — Admin-side validation is UX only.
 *
 * Modeled on the codebase's one existing "stronger than filename extension"
 * media-URL validator, backgroundMusicUrl.ts (protocol check, live
 * Content-Type verification via fetch), scoped down for this feature's
 * different risk profile:
 *   - backgroundMusicUrl.ts allows ANY https host (background music sources
 *     are arbitrary), so it needs full SSRF protection — DNS resolution +
 *     private/loopback/link-local IP range blocking, manual redirect
 *     re-validation at every hop.
 *   - This validator restricts to a FIXED, small allowlist of 5 known public
 *     CDN hosts (mirrored from the website's next.config.ts remotePatterns —
 *     picsum.photos, images.unsplash.com, res.cloudinary.com,
 *     static.wixstatic.com, lh3.googleusercontent.com), which already closes
 *     off the SSRF concern that motivates backgroundMusicUrl.ts's heavier
 *     DNS/IP-range layer — an attacker cannot point this validator at an
 *     internal/private address through one of these five legitimate public
 *     hostnames. That heavier layer is deliberately NOT duplicated here.
 *     `fetch`'s default redirect-follow is used rather than manual
 *     redirect-chasing for the same reason.
 *
 * What IS kept from the precedent: malformed-URL rejection, protocol
 * restriction, and — the key requirement for Wave 1 — a live Content-Type
 * check so a video URL cannot be saved for an image-only section (or vice
 * versa) merely because its filename extension looks right.
 *
 * KEEP THIS HOST LIST IN SYNC (by hand — the two repos cannot share code)
 * with central-studio-website 2's next.config.ts `images.remotePatterns`.
 */

const ALLOWED_HOSTS = [
  "picsum.photos",
  "images.unsplash.com",
  "res.cloudinary.com",
  "static.wixstatic.com",
  "lh3.googleusercontent.com",
] as const;

const IMAGE_CONTENT_TYPE_RE = /^image\//i;
const VIDEO_CONTENT_TYPE_RE = /^video\//i;
const VALIDATION_TIMEOUT_MS = 6_000;

export type WebsiteBackgroundMediaKind = "image" | "video";

export interface WebsiteBackgroundUrlValidationResult {
  normalizedUrl: string;
  mediaKind: WebsiteBackgroundMediaKind;
  contentType: string;
}

export interface ValidationDeps {
  fetchImpl?: typeof fetch;
}

export class WebsiteBackgroundUrlValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function validateUrlObject(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new WebsiteBackgroundUrlValidationError("Enter a valid image or video URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsiteBackgroundUrlValidationError("Background media links must use http or https.");
  }
  if (url.username || url.password) {
    throw new WebsiteBackgroundUrlValidationError("Background media links cannot include credentials.");
  }
  if (!url.hostname) {
    throw new WebsiteBackgroundUrlValidationError("The URL must include a valid host.");
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) {
    throw new WebsiteBackgroundUrlValidationError(
      `This link's host isn't on the approved media list (${ALLOWED_HOSTS.join(", ")}).`,
    );
  }
  return url;
}

function matchesKind(contentType: string, allowedKind: WebsiteBackgroundMediaKind): boolean {
  return allowedKind === "image" ? IMAGE_CONTENT_TYPE_RE.test(contentType) : VIDEO_CONTENT_TYPE_RE.test(contentType);
}

function describeKind(contentType: string): string {
  if (IMAGE_CONTENT_TYPE_RE.test(contentType)) return "an image";
  if (VIDEO_CONTENT_TYPE_RE.test(contentType)) return "a video";
  return `"${contentType}"`;
}

/**
 * Validate a Website Backgrounds media URL end-to-end: format, protocol,
 * approved host, and — via a live HEAD request — that the URL actually
 * serves the media kind the target section allows. Throws
 * WebsiteBackgroundUrlValidationError with a user-facing message on any
 * failure, including "URL could not be reached" (matches the existing
 * platform behavior for its closest sibling feature, background music,
 * which also rejects unreachable URLs at save time rather than accepting
 * them silently).
 */
export async function validateWebsiteBackgroundUrl(
  input: string,
  allowedKind: WebsiteBackgroundMediaKind,
  deps: ValidationDeps = {},
): Promise<WebsiteBackgroundUrlValidationResult> {
  const url = validateUrlObject(input);
  const fetchImpl = deps.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "CentralStudioWebsiteBackgroundValidator/1.0" },
    });
  } catch {
    throw new WebsiteBackgroundUrlValidationError("The media URL could not be reached.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WebsiteBackgroundUrlValidationError(
      response.status === 401 || response.status === 403
        ? "The media file is private or inaccessible."
        : `The media URL returned an error (HTTP ${response.status}).`,
    );
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!contentType) {
    throw new WebsiteBackgroundUrlValidationError("The media URL did not report a content type — could not verify it's a valid image or video.");
  }
  if (!matchesKind(contentType, allowedKind)) {
    throw new WebsiteBackgroundUrlValidationError(
      `This section only accepts ${allowedKind === "image" ? "images" : "videos"}, but this URL serves ${describeKind(contentType)} (${contentType}).`,
    );
  }

  return {
    normalizedUrl: url.toString(),
    mediaKind: allowedKind,
    contentType,
  };
}

export { ALLOWED_HOSTS as WEBSITE_BACKGROUND_ALLOWED_HOSTS };
