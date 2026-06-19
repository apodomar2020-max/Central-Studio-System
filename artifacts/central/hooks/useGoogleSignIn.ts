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
import { continueAfterAuth } from "@/services/authProfile";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? "";
const GOOGLE_NATIVE_REDIRECT_URI = "com.centralstudio.app:/oauthredirect";

export function useGoogleSignIn() {
  const { setUser } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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

    if (response.type === "success") {
      const idToken =
        response.params?.id_token ?? response.authentication?.idToken ?? null;
      if (idToken) {
        void exchange(idToken);
      } else {
        setError("Google did not return an ID token. Please try again.");
        setLoading(false);
      }
    } else if (response.type === "error") {
      setError(response.error?.message ?? "Google sign-in failed. Please try again.");
      setLoading(false);
    } else if (response.type === "cancel" || response.type === "dismiss") {
      // User backed out — not an error.
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  async function exchange(idToken: string) {
    if (exchangingRef.current) return;
    exchangingRef.current = true;
    try {
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
        setError(data?.error ?? "Google sign-in failed. Please try again.");
        return;
      }

      await continueAfterAuth(data.accessToken, setUser);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
      exchangingRef.current = false;
    }
  }

  async function signIn() {
    setError("");
    setLoading(true);
    try {
      await promptAsync();
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setLoading(false);
    }
  }

  return { signIn, loading, error, ready: !!request };
}
