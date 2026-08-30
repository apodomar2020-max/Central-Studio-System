/**
 * useFacebookSignIn — backend-controlled Facebook authentication.
 *
 * Flow:
 *   LoginManager.logInWithPermissions() → AccessToken.getCurrentAccessToken() →
 *   POST /api/auth/facebook → backend validates the token with Facebook, fetches
 *   the profile, creates/links the student, and returns a Central Studio JWT. We
 *   store the JWT (existing `studentToken` storage), update auth state, and
 *   navigate into the app. The app never trusts Facebook directly — the backend
 *   is the single source of truth.
 *
 * Uses the native Facebook SDK (react-native-fbsdk-next) instead of the
 * expo-auth-session web flow: Meta no longer allows custom-scheme redirect URIs
 * in "Valid OAuth Redirect URIs", so the web OAuth dialog cannot complete on a
 * native build. The native SDK validates via the app's platform config + client
 * token and needs no redirect allow-list entry.
 *
 * Exposes loading / error and treats user cancellation as a no-op (no error).
 * If Facebook does not release an email, the backend responds { requiresEmail }
 * — surfaced here as a clear message (full email-collection UI is a follow-up).
 */
import { useEffect, useRef, useState } from "react";

import { useAppContext } from "@/contexts/AppContext";
import { FACEBOOK_APP_ID } from "@/constants/facebook";
import { isFacebookSdkAvailable, loadFacebookSdk } from "@/services/facebookSdk";
import { continueAfterAuth, type AuthSource } from "@/services/authProfile";
import { setOAuthFlowState } from "@/services/oauthFlowState";
import { deriveAuthErrorMessage } from "@/services/accountDeactivation";
import type { SocialLinkChallenge } from "./useGoogleSignIn";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export function useFacebookSignIn(source: AuthSource = "social-login") {
  const { setUser } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linkChallenge, setLinkChallenge] = useState<SocialLinkChallenge | null>(null);
  // Resolved once per mount, never at module scope — see services/facebookSdk.ts.
  const sdkAvailable = isFacebookSdkAvailable();
  const authInFlightRef = useRef(false);
  const exchangingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (authInFlightRef.current || exchangingRef.current) {
        setOAuthFlowState("idle");
      }
    };
  }, []);

  // Send the Facebook access token to the backend, which validates it and
  // returns a Central Studio JWT, then hand off to the shared post-auth flow.
  async function exchange(accessToken: string) {
    if (exchangingRef.current) return;
    exchangingRef.current = true;
    setOAuthFlowState("exchanging");
    try {
      if (__DEV__) {
        console.log("[AUTH_NAV] facebook exchange start", { source });
      }
      const res = await fetch(`${API_URL}/api/auth/facebook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accessToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (__DEV__) {
          console.log("[AUTH_NAV] facebook exchange failure", { source, status: res.status });
        }
        // Security-01B2: this Facebook identity's email matches an existing
        // account, but Facebook never attests ownership — no token, no link.
        // Hand the opaque challenge to the caller so it can show the OTP
        // ownership-verification modal.
        if (data?.requiresLinkVerification && typeof data?.linkChallengeId === "string") {
          setLinkChallenge({ challengeId: data.linkChallengeId, provider: "facebook", expiresIn: data.expiresIn ?? 600 });
          return;
        }
        // Student Account Lifecycle (Phase B1C): a deactivated account
        // rejecting a fresh social-login attempt — no session to tear down,
        // no partial auth state to persist, no auto-retry.
        setError(deriveAuthErrorMessage(data, "Facebook sign-in failed. Please try again."));
        return;
      }

      // Facebook withheld the email — the account can't be activated without one.
      if (data.requiresEmail) {
        if (__DEV__) {
          console.log("[AUTH_NAV] facebook exchange requires email", { source });
        }
        setError(
          "Facebook didn't share an email. Please sign up with your email address instead.",
        );
        return;
      }

      // Persist the JWT, load the canonical profile from /auth/me, set auth
      // state, and route (verify-email → complete-profile → home). Shared with
      // Google and email/password login so all providers behave identically.
      if (__DEV__) {
        console.log("[AUTH_NAV] facebook exchange success", { source });
        console.log("[AUTH_NAV] facebook continueAfterAuth", { source });
      }
      setOAuthFlowState("resolving");
      await continueAfterAuth(data.accessToken, setUser, { source });
    } catch {
      if (__DEV__) {
        console.log("[AUTH_NAV] facebook exchange exception", { source });
      }
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
      authInFlightRef.current = false;
      exchangingRef.current = false;
      setOAuthFlowState("idle");
    }
  }

  async function signIn() {
    if (authInFlightRef.current || loading) {
      if (__DEV__) {
        console.log("[AUTH_NAV] facebook auth ignored in-flight", { source });
      }
      return;
    }
    // Expo Go (and any runtime without the native SDK) cannot do Facebook
    // login at all. The button is already disabled via `ready` below, so
    // this is only reachable if something calls signIn() directly — fail
    // clearly instead of throwing on a missing native module.
    const sdk = loadFacebookSdk();
    if (!sdk) {
      setError(
        __DEV__
          ? "Facebook sign-in needs a development or preview build — it isn't available in Expo Go."
          : "Facebook sign-in isn't available right now. Please use your email and password.",
      );
      return;
    }
    if (!FACEBOOK_APP_ID) {
      // Fail loud: the button stays pressable so a misconfigured build surfaces
      // this message instead of looking like a dead, unresponsive control.
      setError("Facebook login is not configured for this build.");
      return;
    }
    authInFlightRef.current = true;
    setOAuthFlowState("starting");
    if (__DEV__) {
      console.log("[AUTH_NAV] facebook auth start", { source });
    }
    setError("");
    setLinkChallenge(null);
    setLoading(true);
    try {
      // Native Facebook login (FB app if installed, else in-app browser).
      setOAuthFlowState("pending");
      const result = await sdk.LoginManager.logInWithPermissions(["public_profile", "email"]);
      if (__DEV__) {
        console.log("[AUTH_NAV] facebook response", {
          source,
          type: result.isCancelled ? "cancel" : "success",
        });
      }

      if (result.isCancelled) {
        // User backed out — not an error.
        setLoading(false);
        authInFlightRef.current = false;
        setOAuthFlowState("idle");
        return;
      }

      const tokenData = await sdk.AccessToken.getCurrentAccessToken();
      if (!tokenData?.accessToken) {
        if (__DEV__) {
          console.log("[AUTH_NAV] facebook response missing access token", { source });
        }
        setError("Facebook did not return an access token. Please try again.");
        setLoading(false);
        authInFlightRef.current = false;
        setOAuthFlowState("idle");
        return;
      }

      await exchange(tokenData.accessToken);
    } catch {
      authInFlightRef.current = false;
      setOAuthFlowState("idle");
      setError("Could not start Facebook sign-in. Please try again.");
      setLoading(false);
    }
  }

  // Ready only when the App ID is configured AND this runtime actually has
  // the native SDK. `available` is surfaced separately so the auth screens
  // can explain WHY the button is disabled under Expo Go without having to
  // know anything about native modules themselves.
  return {
    signIn,
    loading: loading || authInFlightRef.current,
    error,
    available: sdkAvailable,
    ready: !!FACEBOOK_APP_ID && sdkAvailable,
    linkChallenge,
    clearLinkChallenge: () => setLinkChallenge(null),
  };
}
