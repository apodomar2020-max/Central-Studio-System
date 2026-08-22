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
 *   - Facebook : implemented (validates the access token via /debug_token with
 *                an app token, then reads the minimal profile via /me).
 *   - Apple    : NOT implemented — throws ProviderNotConfiguredError (fail
 *                closed). Do not implement it before Security-01B2 lands, or
 *                it will inherit the linking rules wholesale.
 *
 * ─── Email trust (Security-01B1, CS-SEC-C-01) ────────────────────────────────
 *
 * `emailVerified: boolean` was replaced by the three-valued `emailTrust`
 * because a boolean cannot distinguish "the provider cryptographically
 * attests this address" from "the provider handed us a string". Facebook's
 * Graph API exposes no email_verified signal at all, so the previous
 * `emailVerified: !!profile.email` manufactured an attestation that the
 * provider never made — and the route layer then used it to authorise
 * linking a provider identity onto a pre-existing account.
 *
 * The tier is the ONLY input the route layer may use to decide whether a
 * provider identity is allowed to attach to an account that already exists.
 * See routes/socialAuth.ts for the linking rules that consume it.
 */

export type ProviderName = "google" | "apple" | "facebook";

/**
 * How much the backend may trust the email attached to a provider identity.
 *
 *   provider_attested — the provider makes an explicit, machine-readable
 *                       claim that this subject owns this address
 *                       (Google OIDC `email_verified === true`). Strong
 *                       enough to locate and link a pre-existing account.
 *
 *   provider_asserted — the provider returned an address but makes NO
 *                       verification claim about it (every Facebook email —
 *                       Graph exposes no such field; Google with
 *                       `email_verified` falsy). Sufficient to seed a NEW
 *                       account (which then starts unverified and goes
 *                       through OTP), never sufficient to attach to an
 *                       account that already exists.
 *
 *   none              — the provider released no address at all.
 */
export type EmailTrust = "provider_attested" | "provider_asserted" | "none";

export interface ProviderIdentity {
  provider: ProviderName;
  /** Stable, provider-issued subject id (Google `sub`, Apple `sub`, FB `id`). */
  providerId: string;
  /** Email the provider released, or null (e.g. Apple "Hide My Email" with no relay). */
  email: string | null;
  /**
   * Strength of the provider's claim over `email`. Never derived from, or
   * conflated with, any value stored on the student row — see
   * routes/socialAuth.ts (CS-SEC-C-01).
   */
  emailTrust: EmailTrust;
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

  // Google's tokeninfo returns email_verified as a JSON boolean or the string
  // "true" depending on the token/endpoint; both forms mean attested.
  const attested = info.email_verified === true || info.email_verified === "true";
  const email = info.email ? info.email.toLowerCase() : null;

  return {
    provider: "google",
    providerId: info.sub,
    email,
    // No email claim at all (token minted without the `email` scope) => "none".
    // Present but not attested => "provider_asserted": usable to seed a new
    // account, never to attach to an existing one.
    emailTrust: !email ? "none" : attested ? "provider_attested" : "provider_asserted",
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

// ─── Facebook ─────────────────────────────────────────────────────────────────

interface FbDebugToken {
  data?: { app_id?: string; is_valid?: boolean; user_id?: string };
}
interface FbProfile {
  id?: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string; is_silhouette?: boolean } };
}

async function verifyFacebook(accessToken: string): Promise<ProviderIdentity> {
  const appId = process.env["FACEBOOK_APP_ID"];
  const appSecret = process.env["FACEBOOK_APP_SECRET"];
  if (!appId || !appSecret) {
    throw new ProviderNotConfiguredError("facebook", ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
  }

  // 1. Validate the token server-side and confirm it was issued for THIS app.
  //    The app access token is `APP_ID|APP_SECRET` (never sent to the client).
  const appToken = `${appId}|${appSecret}`;
  let debug: FbDebugToken;
  try {
    const r = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}` +
        `&access_token=${encodeURIComponent(appToken)}`,
    );
    if (!r.ok) throw new ProviderTokenInvalidError();
    debug = (await r.json()) as FbDebugToken;
  } catch (err) {
    if (err instanceof ProviderTokenInvalidError) throw err;
    throw new ProviderTokenInvalidError("Could not validate Facebook token.");
  }

  // Rejects invalid/expired tokens and tokens minted for a different Facebook app.
  if (!debug.data?.is_valid || debug.data.app_id !== appId || !debug.data.user_id) {
    throw new ProviderTokenInvalidError("Facebook token is invalid or not for this app.");
  }

  // 2. Fetch the minimal profile. picture.type(large) yields a usable avatar URL.
  let profile: FbProfile;
  try {
    const r = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)` +
        `&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!r.ok) throw new ProviderTokenInvalidError();
    profile = (await r.json()) as FbProfile;
  } catch (err) {
    if (err instanceof ProviderTokenInvalidError) throw err;
    throw new ProviderTokenInvalidError("Could not fetch Facebook profile.");
  }

  if (!profile.id) throw new ProviderTokenInvalidError("Facebook profile is missing an id.");

  // Skip the default silhouette placeholder so we never store a non-avatar.
  const avatarUrl = profile.picture?.data?.is_silhouette
    ? null
    : profile.picture?.data?.url ?? null;

  const email = profile.email ? profile.email.toLowerCase() : null;

  return {
    provider: "facebook",
    providerId: profile.id,
    email,
    // Facebook's Graph API exposes NO email_verified field on /me, so there is
    // no provider-side attestation to read — the strongest honest tier is
    // "provider_asserted". This is deliberately NOT "provider_attested":
    // equating "an address came back" with "this subject owns that address"
    // is what made CS-SEC-C-01 exploitable. A Facebook email can therefore
    // seed a brand-new account (unverified, OTP follows) but can never attach
    // this identity to an account that already exists.
    emailTrust: email ? "provider_asserted" : "none",
    name: profile.name ?? null,
    avatarUrl,
  };
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
