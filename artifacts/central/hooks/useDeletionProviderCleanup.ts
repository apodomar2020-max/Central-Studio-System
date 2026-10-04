import { useEffect, useRef } from "react";
import * as Google from "expo-auth-session/providers/google";
import { AccessToken, LoginManager } from "react-native-fbsdk-next";
import { customFetch } from "@workspace/api-client-react";
import { GOOGLE_CLIENT_IDS } from "@/constants/google";

export function useDeletionProviderCleanup() {
  const waiter = useRef<((token: string | null) => void) | null>(null);
  const [request, response, prompt] = Google.useAuthRequest({ androidClientId: GOOGLE_CLIENT_IDS.android,
    iosClientId: GOOGLE_CLIENT_IDS.ios, webClientId: GOOGLE_CLIENT_IDS.web, scopes: ["openid", "email"], selectAccount: true,
  }, { native: "com.centralstudio.app:/oauthredirect" });
  useEffect(() => {
    if (!response || !waiter.current) return;
    const resolve = waiter.current;
    if (response.type === "success") {
      const token = response.authentication?.accessToken ?? response.params.access_token;
      if (!token) return; // Wait for the provider hook's automatic code exchange.
      waiter.current = null; resolve(token);
    } else { waiter.current = null; resolve(null); }
  }, [response]);
  useEffect(() => () => { waiter.current?.(null); waiter.current = null; }, []);
  async function cleanup(providers: string[]) {
    const manual: string[] = [];
    for (const provider of ["facebook", "google"] as const) {
      if (!providers.includes(provider)) continue;
      try {
        let token: string | null = null;
        if (provider === "facebook") token = (await AccessToken.getCurrentAccessToken())?.accessToken ?? null;
        else if (request) {
          token = await new Promise<string | null>(resolve => {
            const timeout = setTimeout(() => { waiter.current = null; resolve(null); }, 90000);
            waiter.current = value => { clearTimeout(timeout); resolve(value); };
            void prompt().then(result => { if (result.type !== "success") waiter.current?.(null); }).catch(() => waiter.current?.(null));
          });
        }
        const result = token ? await customFetch<{ status: string }>("/api/me/account-deletion/revoke-provider", {
          method: "POST", body: JSON.stringify({ provider, accessToken: token }),
        }) : null;
        if (result?.status !== "revoked") manual.push(provider);
      } catch { manual.push(provider); }
      finally { if (provider === "facebook") { try { LoginManager.logOut(); } catch {} } }
    }
    return manual;
  }
  return cleanup;
}
