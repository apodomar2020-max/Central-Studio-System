/**
 * useFacebookSignIn — backend-controlled Facebook authentication.
 *
 * Flow:
 *   promptAsync() → Facebook returns an access token → POST /api/auth/facebook →
 *   backend validates the token with Facebook, fetches the profile, creates/links
 *   the student, and returns a Central Studio JWT. We store the JWT (existing
 *   `studentToken` storage), update auth state, and navigate into the app. The
 *   app never trusts Facebook directly — the backend is the single source of truth.
 *
 * Exposes loading / error and treats user cancellation as a no-op (no error).
 * If Facebook does not release an email, the backend responds { requiresEmail }
 * — surfaced here as a clear message (full email-collection UI is a follow-up).
 */
import { useEffect, useRef, useState } from "react";
import * as Facebook from "expo-auth-session/providers/facebook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";

import { useAppContext, User } from "@/contexts/AppContext";
import { FACEBOOK_APP_ID } from "@/constants/facebook";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? "";

export function useFacebookSignIn() {
  const { setUser } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const exchangingRef = useRef(false);

  const [request, response, promptAsync] = Facebook.useAuthRequest({
    clientId: FACEBOOK_APP_ID,
    scopes: ["public_profile", "email"],
  });

  useEffect(() => {
    if (!response) return;

    if (response.type === "success") {
      const accessToken =
        response.authentication?.accessToken ?? response.params?.access_token ?? null;
      if (accessToken) {
        void exchange(accessToken);
      } else {
        setError("Facebook did not return an access token. Please try again.");
        setLoading(false);
      }
    } else if (response.type === "error") {
      setError(response.error?.message ?? "Facebook sign-in failed. Please try again.");
      setLoading(false);
    } else if (response.type === "cancel" || response.type === "dismiss") {
      // User backed out — not an error.
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  async function exchange(accessToken: string) {
    if (exchangingRef.current) return;
    exchangingRef.current = true;
    try {
      const res = await fetch(`${API_URL}/api/auth/facebook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ accessToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Facebook sign-in failed. Please try again.");
        return;
      }

      // Facebook withheld the email — the account can't be activated without one.
      if (data.requiresEmail) {
        setError(
          "Facebook didn't share an email. Please sign up with your email address instead.",
        );
        return;
      }

      if (data.accessToken) {
        await AsyncStorage.setItem("studentToken", data.accessToken);
      }

      const s = data.student ?? {};
      const user: User = {
        id: String(s.id),
        fullName: s.name ?? "",
        phone: s.phone ?? "",
        email: s.email ?? "",
        emailVerified: s.emailVerified ?? false,
        role: "student",
        qrToken: s.qrToken ?? undefined,
        avatarUrl: s.avatarUrl ?? undefined,
      };
      await setUser(user);

      // requiresOtp is true when the email still needs verification.
      if (data.requiresOtp) {
        router.replace("/verify-email" as never);
      } else {
        router.replace("/(tabs)/" as never);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
      exchangingRef.current = false;
    }
  }

  async function signIn() {
    if (!FACEBOOK_APP_ID) {
      // Fail loud: the button stays pressable so a misconfigured build surfaces
      // this message instead of looking like a dead, unresponsive control.
      setError("Facebook login is not configured for this build.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await promptAsync();
    } catch {
      setError("Could not start Facebook sign-in. Please try again.");
      setLoading(false);
    }
  }

  return { signIn, loading, error, ready: !!request && !!FACEBOOK_APP_ID };
}
