/**
 * useGoogleSignIn — backend-controlled Google authentication.
 *
 * Flow:
 *   promptAsync() → Google returns an ID token → POST /api/auth/google → backend
 *   verifies the token, creates/links the student, and returns a Central Studio
 *   JWT. We store the JWT (existing `studentToken` storage), update auth state,
 *   and navigate into the app. The app never trusts Google directly — the backend
 *   is the single source of truth.
 *
 * Exposes loading / error and treats user cancellation as a no-op (no error).
 */
import { useEffect, useRef, useState } from "react";
import * as Google from "expo-auth-session/providers/google";

import { useAppContext } from "@/contexts/AppContext";
import { GOOGLE_CLIENT_IDS } from "@/constants/google";
import { continueAfterAuth, type AuthSource } from "@/services/authProfile";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? "";
const GOOGLE_NATIVE_REDIRECT_URI = "com.centralstudio.app:/oauthredirect";

export function useGoogleSignIn(source: AuthSource = "social-login") {
  const { setUser } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const authInFlightRef = useRef(false);
  const exchangingRef = useRef(false);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId: GOOGLE_CLIENT_IDS.android,
    iosClientId: GOOGLE_CLIENT_IDS.ios,
    webClientId: GOOGLE_CLIENT_IDS.web,
  }, {
    native: GOOGLE_NATIVE_REDIRECT_URI,
  });

  useEffect(() => {
    if (!response) return;

    if (__DEV__) {
      console.log("[AUTH_NAV] google response", { type: response.type, source });
    }

    if (response.type === "success") {
      const idToken =
        response.params?.id_token ?? response.authentication?.idToken ?? null;
      if (idToken) {
        void exchange(idToken);
      } else {
        if (__DEV__) {
          console.log("[AUTH_NAV] google response missing id token", { source });
        }
        setError("Google did not return an ID token. Please try again.");
        setLoading(false);
        authInFlightRef.current = false;
      }
    } else if (response.type === "error") {
      if (__DEV__) {
        console.log("[AUTH_NAV] google response error", { source });
      }
      setError(response.error?.message ?? "Google sign-in failed. Please try again.");
      setLoading(false);
      authInFlightRef.current = false;
    } else if (response.type === "cancel" || response.type === "dismiss") {
      // User backed out — not an error.
      setLoading(false);
      authInFlightRef.current = false;
    } else if (response.type === "locked") {
      if (__DEV__) {
        console.log("[AUTH_NAV] google response locked", { source });
      }
      setLoading(false);
      authInFlightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  async function exchange(idToken: string) {
    if (exchangingRef.current) return;
    exchangingRef.current = true;
    try {
      if (__DEV__) {
        console.log("[AUTH_NAV] google exchange start", { source });
      }
      const res = await fetch(`${API_URL}/api/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (__DEV__) {
          console.log("[AUTH_NAV] google exchange failure", { source, status: res.status });
        }
        setError(data?.error ?? "Google sign-in failed. Please try again.");
        return;
      }

      if (__DEV__) {
        console.log("[AUTH_NAV] google exchange success", { source });
        console.log("[AUTH_NAV] google continueAfterAuth", { source });
      }
      await continueAfterAuth(data.accessToken, setUser, { source });
    } catch {
      if (__DEV__) {
        console.log("[AUTH_NAV] google exchange exception", { source });
      }
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
      authInFlightRef.current = false;
      exchangingRef.current = false;
    }
  }

  async function signIn() {
    if (authInFlightRef.current || loading) {
      if (__DEV__) {
        console.log("[AUTH_NAV] google auth ignored in-flight", { source });
      }
      return;
    }
    authInFlightRef.current = true;
    if (__DEV__) {
      console.log("[AUTH_NAV] google auth start", { source, ready: !!request });
    }
    setError("");
    setLoading(true);
    try {
      await promptAsync();
    } catch {
      authInFlightRef.current = false;
      setError("Could not start Google sign-in. Please try again.");
      setLoading(false);
    }
  }

  return { signIn, loading: loading || authInFlightRef.current, error, ready: !!request };
}
