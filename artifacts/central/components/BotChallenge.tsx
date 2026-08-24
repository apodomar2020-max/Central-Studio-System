/**
 * Security Wave — Bot Protection + Register Enumeration Closure.
 *
 * Renders a Cloudflare Turnstile challenge inside a WebView loading a REAL
 * HTTPS page — Cloudflare's native-mobile guidance expects Turnstile to run
 * on an authorized, controlled hostname, not inline/local HTML
 * (`source={{ html: ... }}`), `about:blank`, or a data/file URI. The page
 * lives on the existing Central Studio website
 * (https://central-studio-website.vercel.app/turnstile-challenge — see
 * app/turnstile-challenge/route.ts in that repo) and is added to that
 * project's Turnstile-authorized hostnames in the Cloudflare dashboard.
 *
 * The page contains no Student/account data — it receives only the public
 * Turnstile site key (its own server-side env var) and an `action` query
 * param, and posts the resulting token back to React Native via
 * `window.ReactNativeWebView.postMessage`. This component hands that token
 * to its caller and nothing else — never persisted (no AsyncStorage),
 * never logged, in-memory only for as long as the screen is mounted.
 *
 * NO SITE KEY IN THE MOBILE BUNDLE AT ALL. The public Turnstile site key
 * lives only on the challenge page (its own server-side env var on the
 * website deployment) — this component only needs that page's URL. The
 * verification SECRET never leaves the API server (see
 * artifacts/api-server/src/lib/botProtection.ts).
 *
 * Shown only when the caller actually needs a token for a protected action
 * (register, forgot-password, OTP send/resend) — never on ordinary
 * authenticated screens.
 */
import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import WebView from "react-native-webview";

const CHALLENGE_PAGE_BASE_URL =
  process.env.EXPO_PUBLIC_TURNSTILE_CHALLENGE_URL ?? "https://central-studio-website.vercel.app/turnstile-challenge";

export type BotChallengeStatus = "loading" | "ready" | "error" | "expired";

export function isBotProtectionConfiguredOnClient(): boolean {
  // The site key itself lives server-side on the challenge page now — the
  // only thing this component needs is a challenge-page URL, which always
  // has a default. "Configured" here just means the page URL is non-empty,
  // which it always will be; kept as a named check so callers/tests don't
  // need to know that detail changed.
  return CHALLENGE_PAGE_BASE_URL.length > 0;
}

/**
 * Renders the challenge and calls `onToken` exactly once with a fresh
 * token whenever the widget succeeds. Callers should treat the token as
 * single-use (the server enforces this) — request a fresh render (bump
 * `resetKey`) after a failed submission rather than resubmitting the same
 * token.
 */
export default function BotChallenge({
  action,
  onToken,
  resetKey,
}: {
  action: string;
  onToken: (token: string) => void;
  /** Change this value to force the widget to remount and issue a fresh challenge. */
  resetKey?: string | number;
}) {
  const [status, setStatus] = useState<BotChallengeStatus>("loading");
  const webviewRef = useRef<WebView>(null);

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const payload = JSON.parse(event.nativeEvent.data) as { type: string; token?: string };
        if (payload.type === "token" && payload.token) {
          setStatus("ready");
          onToken(payload.token);
        } else if (payload.type === "expired") {
          setStatus("expired");
        } else if (payload.type === "error") {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    },
    [onToken],
  );

  if (!isBotProtectionConfiguredOnClient()) {
    // Fails loudly in dev rather than silently rendering nothing — no
    // challenge-page URL means the protected action cannot be completed at
    // all, and that should be obvious immediately, not a confusing 503
    // from the server after the user fills in the whole form.
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Verification is not configured. Please try again later.</Text>
      </View>
    );
  }

  const challengeUrl = `${CHALLENGE_PAGE_BASE_URL}?action=${encodeURIComponent(action)}`;

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        key={resetKey}
        source={{ uri: challengeUrl }}
        onMessage={handleMessage}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        // Cloudflare's own challenge-completion flow needs a normal,
        // consistent User-Agent to reason about — no override here.
        thirdPartyCookiesEnabled={false}
        onError={() => setStatus("error")}
        onHttpError={() => setStatus("error")}
      />
      {status === "expired" && (
        <TouchableOpacity onPress={() => setStatus("loading")} style={styles.retryRow}>
          <Text style={styles.retryText}>Verification expired — tap to retry</Text>
        </TouchableOpacity>
      )}
      {status === "error" && (
        <Text style={styles.errorText}>Couldn&apos;t load verification. Check your connection and try again.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", minHeight: 76, alignItems: "center", justifyContent: "center" },
  webview: { width: 300, height: 76, backgroundColor: "transparent" },
  retryRow: { paddingVertical: 8 },
  retryText: { color: "#5AD6E8", fontSize: 13, textAlign: "center" },
  errorBox: { padding: 12, alignItems: "center" },
  errorText: { color: "#FF6B6B", fontSize: 12, textAlign: "center" },
});
