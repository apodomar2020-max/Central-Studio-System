/**
 * Server-side validation for Website News image URLs (Website CMS Wave 2).
 * This is the trust boundary — Admin-side validation is UX only.
 *
 * Reuses the exact host allowlist proven in Wave 1's
 * websiteBackgroundMediaUrl.ts (WEBSITE_BACKGROUND_ALLOWED_HOSTS — mirrors
 * the website's next.config.ts `images.remotePatterns`), since News assets
 * are drawn from the same public CDN hosts (verified against the 6
 * migrated posts' actual asset hosts — all images.unsplash.com today).
 *
 * UNLIKE Wave 1's validator, this one is IMAGE-ONLY: News has no video
 * fields (hero image, author avatar, gallery images, section images are
 * all images), so there is no `allowedKind` parameter and no video
 * Content-Type branch — using the heavier dual-kind validator here would
 * blindly copy video-specific rules that don't apply to News.
 *
 * What is kept: malformed-URL rejection, protocol restriction, approved
 * host, and a live HEAD request Content-Type check so a non-image URL
 * (e.g. a PDF or HTML page) cannot be saved into an image field merely
 * because its filename extension looks right.
 */
import { WEBSITE_BACKGROUND_ALLOWED_HOSTS } from "./websiteBackgroundMediaUrl";

const ALLOWED_HOSTS = WEBSITE_BACKGROUND_ALLOWED_HOSTS;
const IMAGE_CONTENT_TYPE_RE = /^image\//i;
const VALIDATION_TIMEOUT_MS = 6_000;

export interface WebsiteNewsImageUrlValidationResult {
  normalizedUrl: string;
  contentType: string;
}

export interface ValidationDeps {
  fetchImpl?: typeof fetch;
}

export class WebsiteNewsImageUrlValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function validateUrlObject(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new WebsiteNewsImageUrlValidationError("Enter a valid image URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsiteNewsImageUrlValidationError("Image links must use http or https.");
  }
  if (url.username || url.password) {
    throw new WebsiteNewsImageUrlValidationError("Image links cannot include credentials.");
  }
  if (!url.hostname) {
    throw new WebsiteNewsImageUrlValidationError("The URL must include a valid host.");
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) {
    throw new WebsiteNewsImageUrlValidationError(
      `This link's host isn't on the approved image list (${ALLOWED_HOSTS.join(", ")}).`,
    );
  }
  return url;
}

/**
 * Validate a Website News image URL end-to-end: format, protocol, approved
 * host, and — via a live HEAD request — that the URL actually serves an
 * image. Throws WebsiteNewsImageUrlValidationError with a user-facing
 * message on any failure, matching the Wave 1 backgrounds validator's
 * "reject unreachable URLs at save time" behavior.
 */
export async function validateWebsiteNewsImageUrl(
  input: string,
  deps: ValidationDeps = {},
): Promise<WebsiteNewsImageUrlValidationResult> {
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
      headers: { "User-Agent": "CentralStudioWebsiteNewsValidator/1.0" },
    });
  } catch {
    throw new WebsiteNewsImageUrlValidationError("The image URL could not be reached.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WebsiteNewsImageUrlValidationError(
      response.status === 401 || response.status === 403
        ? "The image file is private or inaccessible."
        : `The image URL returned an error (HTTP ${response.status}).`,
    );
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!contentType) {
    throw new WebsiteNewsImageUrlValidationError(
      "The image URL did not report a content type — could not verify it's a valid image.",
    );
  }
  if (!IMAGE_CONTENT_TYPE_RE.test(contentType)) {
    throw new WebsiteNewsImageUrlValidationError(
      `This field only accepts images, but this URL serves "${contentType}".`,
    );
  }

  return {
    normalizedUrl: url.toString(),
    contentType,
  };
}
