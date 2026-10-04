import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";

const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"), {
  timeoutDuration: 5000,
  cooldownDuration: 30000,
});

export async function validateAppleIdentity(token: string, audience: string, nonce?: string, keys: JWTVerifyGetKey = appleKeys): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: "https://appleid.apple.com", audience, algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5,
  });
  if (!payload.sub?.trim() || (nonce !== undefined && payload.nonce !== nonce)) throw new Error("Invalid Apple identity.");
  if (typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5) throw new Error("Invalid Apple identity.");
  return payload;
}
