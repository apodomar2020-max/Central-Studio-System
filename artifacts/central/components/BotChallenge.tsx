/**
 * Security Wave — Bot Protection + Register Enumeration Closure.
 *
 * Renders a Cloudflare Turnstile challenge inside a WebView loading a tiny,
 * self-contained inline HTML page (Turnstile's own script, loaded from
 * Cloudflare's CDN — the ONLY network resource this page needs). On success
 * the widget's callback posts the opaque challenge token back to React
 * Native via `window.ReactNativeWebView.postMessage`; this component hands
 * that token to its caller and nothing else — it is never persisted
 * (no AsyncStorage), never logged, and lives only in this component's own
 * in-memory state for as long as the screen is mounted.
 *
 * PUBLIC SITE KEY ONLY. `EXPO_PUBLIC_TURNSTILE_SITE_KEY` is, by Cloudflare's
 * own design, safe to ship in a client bundle — it identifies the site, not
 * a secret. The verification SECRET never leaves the API server (see
 * artifacts/api-server/src/lib/botProtection.ts).
 *
 * Shown only when the caller actually needs a token for a protected action
 * (register, forgot-password, OTP send/resend) — never on ordinary
 * authenticated screens.
 */
import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import WebView from "react-native-webview";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** One tiny static HTML document — Turnstile's script is the only external resource. */
function challengeHtml(siteKey: string, action: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    html, body { margin: 0; padding: 0; background: transparent; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  </style>
</head>
<body>
  <div class="cf-turnstile"
       data-sitekey="${siteKey}"
       data-action="${action}"
       data-callback="onToken"
       data-error-callback="onError"
       data-expired-callback="onExpired"
       data-theme="dark">
  </div>
  <script>
    function onToken(token) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "token", token }));
    }
    function onError() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error" }));
    }
    function onExpired() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "expired" }));
    }
  </script>
</body>
</html>`;
}

export type BotChallengeStatus = "loading" | "ready" | "error" | "expired";

export function isBotProtectionConfiguredOnClient(): boolean {
  return SITE_KEY.length > 0;
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
    // Fails loudly in dev rather than silently rendering nothing — a
    // missing site key means the protected action cannot be completed at
    // all, and that should be obvious immediately, not a confusing 503
    // from the server after the user fills in the whole form.
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Verification is not configured. Please try again later.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        key={resetKey}
        originWhitelist={["*"]}
        source={{ html: challengeHtml(SITE_KEY, action) }}
        onMessage={handleMessage}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        // No cookies/local storage need to persist across sessions for a
        // one-shot challenge widget.
        thirdPartyCookiesEnabled={false}
        onError={() => setStatus("error")}
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
