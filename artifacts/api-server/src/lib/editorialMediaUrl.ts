/**
 * Server-side media-URL validation for the Unified Editorial CMS (Wave 1).
 * This is the trust boundary — Admin-side validation is UX only.
 *
 * ISOLATED BY DESIGN. This module is NEW and scoped entirely to the
 * editorial domain. It deliberately does not edit, wrap, or re-export
 * websiteNewsMediaUrl.ts or websiteBackgroundMediaUrl.ts — the legacy
 * News/Performance/Backgrounds media behavior must show ZERO diff, so a
 * stricter policy here can never change what those existing surfaces
 * accept or reject.
 *
 * Policy, stricter than the legacy validators on every axis:
 *
 *   1. HTTPS ONLY. The legacy News validator allows http: as well; here
 *      plain http is rejected outright (an editorial asset served over
 *      http would be a mixed-content downgrade on a TLS-only site).
 *   2. EXPLICIT HOST ALLOWLIST, re-checked at EVERY redirect hop.
 *   3. MANUAL REDIRECT FOLLOWING, max 3 hops (`redirect: "manual"`), with
 *      the full rule set re-applied to each Location. `fetch`'s automatic
 *      redirect-follow — which both legacy validators use — would let an
 *      allowlisted host 302 the request to anywhere, including an internal
 *      address; that is exactly the hole this module closes.
 *   4. DNS RESOLUTION + PRIVATE-RANGE REJECTION on every hop's host:
 *      RFC1918 (10/8, 172.16/12, 192.168/16), 127.0.0.0/8, 169.254.0.0/16,
 *      0.0.0.0/8, ::1, fc00::/7, fe80::/10, and IPv4-mapped IPv6 forms of
 *      all of the above. A hostname that resolves to ANY such address is
 *      rejected — one bad answer in a multi-record response is enough.
 *   5. ~4s TIMEOUT on any live check (tighter than the legacy 6s).
 *   6. CONTENT-TYPE MUST BE image/* on the final hop.
 *
 * NOT enforced here: mandatory non-empty alt text. Alt text is a
 * publish-time editorial requirement, not a URL property, and is enforced
 * in the lifecycle service (editorialPosts.service.ts) at the
 * draft -> published transition.
 *
 * HOST ALLOWLIST CONSOLIDATION (flagged for a later wave): the list below
 * is intentionally a SEPARATE constant rather than an import of
 * WEBSITE_BACKGROUND_ALLOWED_HOSTS. Importing the shared constant would
 * couple editorial's policy to the legacy one, so that any future edit to
 * the editorial allowlist would silently change what Backgrounds and News
 * accept — the precise coupling this wave is required to avoid. The two
 * lists have the same five entries TODAY and should be consolidated into
 * one shared source once the legacy validators are retired.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

/** Keep in sync BY HAND with the website's next.config.ts `images.remotePatterns`. */
export const EDITORIAL_ALLOWED_MEDIA_HOSTS = [
  "picsum.photos",
  "images.unsplash.com",
  "res.cloudinary.com",
  "static.wixstatic.com",
  "lh3.googleusercontent.com",
] as const;

const IMAGE_CONTENT_TYPE_RE = /^image\//i;
const VALIDATION_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;

/**
 * Test-only escape hatch for the LIVE half of the check (DNS + HEAD).
 *
 * DOUBLE-GUARDED: it requires BOTH `NODE_ENV === "test"` AND an explicit
 * opt-in env var, so a stray environment variable in production can never
 * switch the trust boundary off. It never relaxes the static rules — https,
 * credentials, and the host allowlist are still enforced in full — so a
 * route test exercising "http rejected" / "non-allowlisted host rejected"
 * still exercises the real code path.
 *
 * This exists because the route layer performs live validation on real
 * hosts; without it every route integration test would make outbound
 * network requests and be flaky/offline-dependent.
 */
function liveChecksDisabled(): boolean {
  return process.env["NODE_ENV"] === "test" && process.env["EDITORIAL_MEDIA_SKIP_LIVE_CHECK"] === "1";
}

export class EditorialMediaUrlValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "EditorialMediaUrlValidationError";
  }
}

export interface EditorialMediaValidationDeps {
  fetchImpl?: typeof fetch;
  /** Injectable DNS resolver — returns every address the host resolves to. */
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  /** Skip the live HEAD request + DNS check (shape/protocol/host rules still apply). */
  skipLiveCheck?: boolean;
}

export interface EditorialMediaValidationResult {
  normalizedUrl: string;
  /** null when skipLiveCheck was requested. */
  contentType: string | null;
  /** Every URL visited, starting with the input and ending with the final hop. */
  hops: string[];
}

// ─── Private / non-routable IP detection ────────────────────────────────────

function ipv4IsPrivate(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;                        // 0.0.0.0/8 "this network"
  if (a === 10) return true;                       // RFC1918 10/8
  if (a === 127) return true;                      // loopback 127/8
  if (a === 169 && b === 254) return true;         // link-local 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16/12
  if (a === 192 && b === 168) return true;         // RFC1918 192.168/16
  return false;
}

function ipv6IsPrivate(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0]!; // drop any zone id
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified

  // IPv4-mapped / IPv4-compatible forms (::ffff:10.0.0.1) reuse the v4 rules.
  const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(normalized);
  if (mapped) return ipv4IsPrivate(mapped[1]!);

  const firstGroup = normalized.split(":", 1)[0] ?? "";
  const head = Number.parseInt(firstGroup.padStart(4, "0").slice(0, 4), 16);
  if (Number.isNaN(head)) return true; // unparseable — refuse rather than guess
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** True when the literal IP address is loopback/private/link-local/unspecified. */
export function isPrivateIpAddress(address: string): boolean {
  if (net.isIPv4(address)) return ipv4IsPrivate(address);
  if (net.isIPv6(address)) return ipv6IsPrivate(address);
  return true; // not a recognizable IP — refuse
}

// ─── Per-hop static rules ───────────────────────────────────────────────────

/**
 * Apply every non-network rule to one URL: parseable, https only, no
 * embedded credentials, host present and on the allowlist. Applied to the
 * input AND to every redirect target.
 */
export function assertEditorialUrlShape(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new EditorialMediaUrlValidationError("Enter a valid image URL.");
  }
  if (url.protocol !== "https:") {
    throw new EditorialMediaUrlValidationError("Editorial image links must use https.");
  }
  if (url.username || url.password) {
    throw new EditorialMediaUrlValidationError("Image links cannot include credentials.");
  }
  if (!url.hostname) {
    throw new EditorialMediaUrlValidationError("The URL must include a valid host.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // A bare IP literal can never be on a hostname allowlist, but reject it
  // explicitly so the error names the real reason.
  if (net.isIP(host)) {
    throw new EditorialMediaUrlValidationError("Image links must use an approved hostname, not a raw IP address.");
  }
  if (!(EDITORIAL_ALLOWED_MEDIA_HOSTS as readonly string[]).includes(host)) {
    throw new EditorialMediaUrlValidationError(
      `This link's host isn't on the approved image list (${EDITORIAL_ALLOWED_MEDIA_HOSTS.join(", ")}).`,
    );
  }
  return url;
}

async function assertHostResolvesPublicly(
  hostname: string,
  lookupImpl: NonNullable<EditorialMediaValidationDeps["lookupImpl"]>,
): Promise<void> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupImpl(hostname);
  } catch {
    throw new EditorialMediaUrlValidationError("The image URL's host could not be resolved.");
  }
  if (addresses.length === 0) {
    throw new EditorialMediaUrlValidationError("The image URL's host could not be resolved.");
  }
  for (const { address } of addresses) {
    if (isPrivateIpAddress(address)) {
      throw new EditorialMediaUrlValidationError(
        "The image URL's host resolves to a private or internal address and cannot be used.",
      );
    }
  }
}

const defaultLookup: NonNullable<EditorialMediaValidationDeps["lookupImpl"]> = async (hostname) => {
  const result = await lookup(hostname, { all: true, verbatim: true });
  return result.map((entry) => ({ address: entry.address, family: entry.family }));
};

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Validate one editorial image URL end-to-end. Throws
 * EditorialMediaUrlValidationError (never a bare Error) on any failure, so
 * callers can map it to a 400 with a user-facing message.
 */
export async function validateEditorialMediaUrl(
  input: string,
  deps: EditorialMediaValidationDeps = {},
): Promise<EditorialMediaValidationResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookupImpl = deps.lookupImpl ?? defaultLookup;

  let current = assertEditorialUrlShape(input);
  const hops: string[] = [current.toString()];

  if (deps.skipLiveCheck ?? liveChecksDisabled()) {
    return { normalizedUrl: current.toString(), contentType: null, hops };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertHostResolvesPublicly(current.hostname.toLowerCase(), lookupImpl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "HEAD",
        // MANUAL, never "follow": every hop must be re-validated by this
        // module, not silently chased by the fetch implementation.
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "CentralStudioEditorialMediaValidator/1.0" },
      });
    } catch {
      throw new EditorialMediaUrlValidationError("The image URL could not be reached.");
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new EditorialMediaUrlValidationError("The image URL redirected without a destination.");
      }
      if (hop === MAX_REDIRECTS) {
        throw new EditorialMediaUrlValidationError(
          `The image URL redirected more than ${MAX_REDIRECTS} times.`,
        );
      }
      // Resolve relative Locations against the current hop, then re-apply
      // the FULL rule set (https, credentials, allowlisted host) to it.
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        throw new EditorialMediaUrlValidationError("The image URL redirected to an invalid destination.");
      }
      current = assertEditorialUrlShape(next);
      hops.push(current.toString());
      continue;
    }

    if (!response.ok) {
      throw new EditorialMediaUrlValidationError(
        response.status === 401 || response.status === 403
          ? "The image file is private or inaccessible."
          : `The image URL returned an error (HTTP ${response.status}).`,
      );
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!contentType) {
      throw new EditorialMediaUrlValidationError(
        "The image URL did not report a content type — could not verify it's a valid image.",
      );
    }
    if (!IMAGE_CONTENT_TYPE_RE.test(contentType)) {
      throw new EditorialMediaUrlValidationError(
        `This field only accepts images, but this URL serves "${contentType}".`,
      );
    }

    return { normalizedUrl: current.toString(), contentType, hops };
  }

  /* c8 ignore next */
  throw new EditorialMediaUrlValidationError(`The image URL redirected more than ${MAX_REDIRECTS} times.`);
}

/**
 * Validate a batch of URLs, returning the first failure as a message rather
 * than throwing — the shape route handlers want. Duplicates are validated
 * once.
 */
export async function validateEditorialMediaUrls(
  urls: readonly string[],
  deps: EditorialMediaValidationDeps = {},
): Promise<{ error: string } | null> {
  for (const url of [...new Set(urls)]) {
    try {
      await validateEditorialMediaUrl(url, deps);
    } catch (err) {
      if (err instanceof EditorialMediaUrlValidationError) {
        return { error: `${url}: ${err.message}` };
      }
      throw err;
    }
  }
  return null;
}
