import { useRef, useState } from "react";
import { Platform } from "react-native";
import * as Apple from "expo-apple-authentication";
import { useAppContext } from "@/contexts/AppContext";
import { continueAfterAuth, type AuthSource } from "@/services/authProfile";
import { setOAuthFlowState } from "@/services/oauthFlowState";
import type { SocialLinkChallenge } from "./useGoogleSignIn";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
export function useAppleSignIn(source: AuthSource = "social-login") {
  const { setUser } = useAppContext();
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linkChallenge, setLinkChallenge] = useState<SocialLinkChallenge | null>(null);
  async function signIn() {
    if (busy.current || Platform.OS !== "ios") return;
    busy.current = true; setLoading(true); setError(""); setLinkChallenge(null); setOAuthFlowState("pending");
    try {
      const response = await fetch(`${API}/api/auth/apple/challenge`, { method: "POST" });
      if (!response.ok) throw new Error("Apple sign-in is temporarily unavailable.");
      const challenge = await response.json();
      const credential = await Apple.signInAsync({ nonce: challenge.nonce,
        requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL] });
      if (!credential.identityToken || !credential.authorizationCode) throw new Error("Apple did not complete authorization. Please try again.");
      setOAuthFlowState("exchanging");
      const exchange = await fetch(`${API}/api/auth/apple`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: credential.identityToken, authorizationCode: credential.authorizationCode,
          challengeId: challenge.challengeId, displayName: credential.fullName ? Apple.formatFullName(credential.fullName) : undefined }) });
      const data = await exchange.json();
      if (data.requiresLinkVerification) {
        setLinkChallenge({ challengeId: data.linkChallengeId, provider: "apple", expiresIn: data.expiresIn ?? 600 }); return;
      }
      if (!exchange.ok) throw new Error(data.error ?? "Apple sign-in failed.");
      if (data.requiresEmail) throw new Error("Apple did not share an email. Use email sign-in, or allow Apple to share an email and try again.");
      await continueAfterAuth(data.accessToken, setUser, { source });
    } catch (e) {
      if ((e as { code?: string }).code !== "ERR_REQUEST_CANCELED") setError(e instanceof Error ? e.message : "Apple sign-in failed. Please try again.");
    } finally { busy.current = false; setLoading(false); setOAuthFlowState("idle"); }
  }
  return { signIn, loading, error, linkChallenge, clearLinkChallenge: () => setLinkChallenge(null) };
}
