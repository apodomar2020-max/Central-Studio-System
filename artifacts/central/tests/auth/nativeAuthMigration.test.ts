import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve("artifacts/central");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("registration uses native admission, preserves generic login continuation and social sign-in", () => {
  const source = read("app/auth/register.tsx");
  assert.match(source, /\/api\/auth\/native\/register/);
  assert.match(source, /JSON.stringify\(\{ name, email: trimmedEmail, accountType: "student", password \}\)/);
  assert.match(source, /\/api\/auth\/login/);
  assert.match(source, /continueAfterAuth\(loginData.accessToken/);
  assert.match(source, /response.status === 429/);
  for (const name of ["useAppleSignIn", "useGoogleSignIn", "useFacebookSignIn"]) assert.match(source, new RegExp(name));
  assert.doesNotMatch(source, /BotChallenge|botToken|BOT_VERIFICATION|challengeReset/);
});

test("email send and resend use one authenticated identity-free native request", () => {
  const source = read("app/verify-email.tsx");
  assert.match(source, /customFetch\("\/api\/auth\/native\/send-email-otp", \{\s*method: "POST",\s*\}\)/);
  assert.match(source, /if \(!user\?\.id\)/);
  assert.match(source, /sendInFlight.current = true/);
  assert.match(source, /sendInFlight.current = false/);
  assert.match(source, /setResendCountdown\(60\)/);
  assert.match(source, /if \(retryAfter > 0\) setResendCountdown\(retryAfter\)/);
  assert.match(source, /sent \? "Resend verification email" : "Send code"/);
  assert.doesNotMatch(source, /BotChallenge|botToken|BOT_VERIFICATION|challengeReset|auth: "omit"/);
});

test("reset resend retains success countdown and error cooldown without challenge gating", () => {
  const source = read("app/auth/otp-verification.tsx");
  assert.match(source, /if \(resendCountdown > 0 \|\| resendPending\) return/);
  assert.match(source, /setResendCountdown\(RESEND_COOLDOWN_SECONDS\)/);
  assert.match(source, /setCode\(""\)/);
  assert.match(source, /nativeAuthError\(err\)/);
  assert.match(source, /if \(retryAfter > 0\) setResendCountdown\(retryAfter\)/);
});

test("no production mobile source retains Turnstile, diagnostics or WebView imports", () => {
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".expo", "tests", ".git"].includes(entry.name)) continue;
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(tsx?|jsx?)$/.test(file) && !/\.test\./.test(file)) {
        let source = readFileSync(file, "utf8");
        if (file === resolve(root, "app/privacy-policy.tsx")) {
          // Approved legal prose describes website protection, not a mobile SDK.
          // Only this exact publication may be excluded; all executable source
          // and every other string remain subject to the original guard.
          source = source.replace(/(const FALLBACK_PAGE = \{[\s\S]*?content: )`([\s\S]*?)`/, (_match, prefix, body) => {
            const plainText = body.replace(/\\u0020/g, " ");
            assert.equal(createHash("sha256").update(plainText).digest("hex"), "80986d773ce8fbd20ac512b8737e5ee5d8bc18031a4b7cd910f838c35c134b06");
            return prefix + "`Approved policy prose`";
          });
        }
        assert.doesNotMatch(source, /BotChallenge|react-native-webview|TURNSTILE_IOS|Turnstile|turnstile|about:srcdoc/, file);
      }
    }
  }
  visit(root);
  assert.equal(existsSync(resolve(root, "components/BotChallenge.tsx")), false);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["react-native-webview"], undefined);
});
