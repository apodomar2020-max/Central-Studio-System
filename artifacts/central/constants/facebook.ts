/**
 * Facebook OAuth configuration.
 *
 * The App ID is a PUBLIC identifier (safe in the bundle). The App Secret and
 * Client Token are NEVER shipped in the app — token validation happens entirely
 * on the backend (POST /api/auth/facebook), which is the trust boundary.
 *
 * Provide the App ID via EXPO_PUBLIC_FACEBOOK_APP_ID (never hardcoded). When it
 * is unset the Facebook button stays disabled.
 *
 * Redirect: expo-auth-session uses the app scheme `central://` — that redirect
 * URI must be allow-listed in the Facebook app's "Valid OAuth Redirect URIs".
 */
export const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "";
