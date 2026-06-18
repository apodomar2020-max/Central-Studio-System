/**
 * Social identity-provider verification.
 *
 * Each provider validates a client-supplied token SERVER-SIDE and returns a
 * normalized ProviderIdentity. The client-sent email is never trusted — only
 * what the provider itself asserts after token validation.
 *
 * Status:
 *   - Google   : implemented (validates the ID token via Google's tokeninfo
 *                endpoint and checks the audience against GOOGLE_CLIENT_ID).
 *   - Apple    : placeholder — throws ProviderNotConfiguredError until wired.
 *   - Facebook : placeholder — throws ProviderNotConfiguredError until wired.
 *
 * To add Apple/Facebook later, replace the placeholder bodies with real
 * validation (Apple: verify the identity token against Apple's JWKS and check
 * aud === APPLE_CLIENT_ID; Facebook: GET /debug_token with an app token, then
 * GET /me?fields=id,email). The route layer needs no changes.
 */

export type ProviderName = "google" | "apple" | "facebook";

export interface ProviderIdentity {
  provider: ProviderName;
  /** Stable, provider-issued subject id (Google `sub`, Apple `sub`, FB `id`). */
  providerId: string;
  /** Email the provider released, or null (e.g. Apple "Hide My Email" with no relay). */
  email: string | null;
  /** Whether the provider asserts the email is verified/owned by this subject. */
  emailVerified: boolean;
  /** Display name if the provider released one. */
  name: string | null;
  /** Profile picture URL the provider released, or null. */
  avatarUrl: string | null;
}

/** The provider's credentials/config are missing — surfaced to the client as 501. */
export class ProviderNotConfiguredError extends Error {
  requiredEnv: string[];
  constructor(provider: ProviderName, requiredEnv: string[]) {
    super(`${provider} sign-in is not configured on the server.`);
    this.name = "ProviderNotConfiguredError";
    this.requiredEnv = requiredEnv;
  }
}

/** The supplied token failed validation — surfaced to the client as 401. */
export class ProviderTokenInvalidError extends Error {
  constructor(message = "Invalid or expired provider token.") {
    super(message);
    this.name = "ProviderTokenInvalidError";
  }
}

// ─── Google ───────────────────────────────────────────────────────────────────

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
}

async function verifyGoogle(idToken: string): Promise<ProviderIdentity> {
  // Accept one or more allowed audiences (web + iOS + android client ids),
  // comma-separated in GOOGLE_CLIENT_ID.
  const configured = process.env["GOOGLE_CLIENT_ID"];
  if (!configured) {
    throw new ProviderNotConfiguredError("google", ["GOOGLE_CLIENT_ID"]);
  }
  const allowedAudiences = configured.split(",").map((s) => s.trim()).filter(Boolean);

  let info: GoogleTokenInfo;
  try {
    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!resp.ok) throw new ProviderTokenInvalidError();
    info = (await resp.json()) as GoogleTokenInfo;
  } catch (err) {
    if (err instanceof ProviderTokenInvalidError) throw err;
    throw new ProviderTokenInvalidError("Could not validate Google token.");
  }

  if (!info.sub || !info.aud || !allowedAudiences.includes(info.aud)) {
    throw new ProviderTokenInvalidError("Google token audience mismatch.");
  }

  const emailVerified = info.email_verified === true || info.email_verified === "true";

  return {
    provider: "google",
    providerId: info.sub,
    email: info.email ? info.email.toLowerCase() : null,
    emailVerified,
    name: info.name ?? null,
    avatarUrl: info.picture ?? null,
  };
}

// ─── Apple (placeholder) ──────────────────────────────────────────────────────

async function verifyApple(_identityToken: string): Promise<ProviderIdentity> {
  // TODO: verify _identityToken against Apple JWKS (https://appleid.apple.com/auth/keys),
  // check iss === https://appleid.apple.com and aud === APPLE_CLIENT_ID, then map
  // sub/email/email_verified. Apple may omit email after first sign-in or when the
  // user hides it — the route handles the email-collection + OTP fallback.
  throw new ProviderNotConfiguredError("apple", ["APPLE_CLIENT_ID"]);
}

// ─── Facebook (placeholder) ───────────────────────────────────────────────────

async function verifyFacebook(_accessToken: string): Promise<ProviderIdentity> {
  // TODO: GET https://graph.facebook.com/debug_token?input_token=_accessToken
  // &access_token=<APP_ID>|<APP_SECRET> to validate, then
  // GET https://graph.facebook.com/me?fields=id,email,name to read the identity.
  throw new ProviderNotConfiguredError("facebook", ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
}

/** Validate a provider token and return the normalized identity. */
export function verifyProviderToken(provider: ProviderName, token: string): Promise<ProviderIdentity> {
  switch (provider) {
    case "google":
      return verifyGoogle(token);
    case "apple":
      return verifyApple(token);
    case "facebook":
      return verifyFacebook(token);
  }
}
