/**
 * Google OAuth client IDs.
 *
 * These are PUBLIC identifiers (safe to ship in the app bundle) — they are not
 * secrets. The backend is the trust boundary: it re-validates every Google ID
 * token server-side (POST /api/auth/google) before issuing a Central Studio JWT.
 *
 * Override per-environment via EXPO_PUBLIC_GOOGLE_* env vars if needed.
 *
 * Platform notes:
 *   - The Android client requires the app's SHA-1 + package (com.centralstudio.app)
 *     to be registered in Google Cloud Console.
 *   - With expo-auth-session's id_token flow, the returned token's audience is
 *     typically the WEB client id — the backend's GOOGLE_CLIENT_ID must include it.
 */
export const GOOGLE_CLIENT_IDS = {
  android:
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ??
    "158773571940-2u9dn3uvcgcbq40n1e3uaqkj7dq84toq.apps.googleusercontent.com",
  ios:
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
    "158773571940-ii4h9vlokdiv3ekaa9vtiah372cb2csg.apps.googleusercontent.com",
  web:
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
    "158773571940-ooqba2bd9a1ps0i7gvmsa8689pko84d8.apps.googleusercontent.com",
} as const;
