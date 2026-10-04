import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { validateAppleIdentity } from "./appleIdentity";

test("Apple signature, audience, issuer, nonce, expiry and subject are enforced", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "test", alg: "RS256" }] });
  const make = (claims: Record<string, unknown> = {}) => new SignJWT({ nonce: "nonce", sub: "apple-sub", email: "relay@privaterelay.appleid.com", email_verified: "true", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://appleid.apple.com")
    .setAudience("com.centralstudio.app").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const token = await make();
  assert.equal((await validateAppleIdentity(token, "com.centralstudio.app", "nonce", keys)).sub, "apple-sub");
  await assert.rejects(validateAppleIdentity(token, "wrong", "nonce", keys));
  await assert.rejects(validateAppleIdentity(token, "com.centralstudio.app", "wrong", keys));
  await assert.rejects(validateAppleIdentity(await make({ sub: "" }), "com.centralstudio.app", "nonce", keys));
  const expired = await new SignJWT({ sub: "s", nonce: "nonce" }).setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://appleid.apple.com").setAudience("com.centralstudio.app").setIssuedAt().setExpirationTime(1).sign(privateKey);
  await assert.rejects(validateAppleIdentity(expired, "com.centralstudio.app", "nonce", keys));
  const wrongIssuer = await new SignJWT({ sub: "s" }).setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://attacker.invalid").setAudience("com.centralstudio.app").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  await assert.rejects(validateAppleIdentity(wrongIssuer, "com.centralstudio.app", undefined, keys));
  await assert.rejects(validateAppleIdentity(token.slice(0, -5) + "xxxxx", "com.centralstudio.app", "nonce", keys));
});
