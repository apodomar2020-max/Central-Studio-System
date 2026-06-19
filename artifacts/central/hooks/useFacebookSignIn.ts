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
import { useRef, useState } from "react";
import { LoginManager, AccessToken } from "react-native-fbsdk-next";
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

  // Send the Facebook access token to the backend, which validates it and
  // returns a Central Studio JWT. (Unchanged from the previous implementation.)
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
      // Native Facebook login (FB app if installed, else in-app browser).
      const result = await LoginManager.logInWithPermissions(["public_profile", "email"]);

      if (result.isCancelled) {
        // User backed out — not an error.
        setLoading(false);
        return;
      }

      const tokenData = await AccessToken.getCurrentAccessToken();
      if (!tokenData?.accessToken) {
        setError("Facebook did not return an access token. Please try again.");
        setLoading(false);
        return;
      }

      await exchange(tokenData.accessToken);
    } catch {
      setError("Could not start Facebook sign-in. Please try again.");
      setLoading(false);
    }
  }

  // No async request to prepare anymore — the button is ready as long as the
  // App ID is configured for this build.
  return { signIn, loading, error, ready: !!FACEBOOK_APP_ID };
}
