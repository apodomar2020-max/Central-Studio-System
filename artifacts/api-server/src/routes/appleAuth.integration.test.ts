import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { generateKeyPair, exportPKCS8, exportJWK, SignJWT } from "jose";
const url = process.env.DISPOSABLE_IOS_DATABASE_URL ?? "postgresql://abdelrahmanomar@127.0.0.1:5617/central_studio_disposable_ios";
const parsed = new URL(url);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.includes("disposable")) throw new Error("Disposable local DB required");
process.env.DATABASE_URL = url;
process.env.STUDENT_JWT_SECRET = "ios-test-jwt-secret";
process.env.IDENTITY_PROVENANCE_PEPPER = "ios-test-provenance-pepper".padEnd(64, "0");
process.env.OTP_PEPPER = "ios-test-otp-pepper".padEnd(64, "0");
process.env.AUTH_ABUSE_PEPPER = "ios-test-abuse-pepper".padEnd(64, "0");
process.env.APPLE_CLIENT_ID = "com.centralstudio.app";
process.env.APPLE_TEAM_ID = "TESTTEAM"; process.env.APPLE_KEY_ID = "TESTKEY";
process.env.THIRD_PARTY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION = "ios-test";
process.env.BREVO_API_KEY = "synthetic-test-only"; process.env.EMAIL_FROM = "test@example.com";
let pool: typeof import("@workspace/db").pool;
let server: import("node:http").Server; let base: string;
let signingKey: CryptoKey; let signedToken = ""; let otp = "";
const originalFetch = globalThis.fetch;
before(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true }); signingKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "ios-test", alg: "RS256", use: "sig" };
  process.env.APPLE_PRIVATE_KEY = await exportPKCS8((await generateKeyPair("ES256", { extractable: true })).privateKey);
  globalThis.fetch = (async (input: any, init: any) => {
    const target = String(input);
    if (target === "https://appleid.apple.com/auth/keys") return Response.json({ keys: [jwk] });
    if (target === "https://appleid.apple.com/auth/token") return Response.json({ id_token: signedToken, refresh_token: "synthetic-refresh-only" });
    if (target === "https://api.brevo.com/v3/smtp/email") {
      otp = JSON.parse(init.body).textContent.match(/\b\d{6}\b/)?.[0] ?? "";
      return Response.json({ messageId: "synthetic" });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  const express = (await import("express")).default;
  pool = (await import("@workspace/db")).pool;
  const app = express(); app.use(express.json()); app.use("/api", (await import("./socialAuth")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
after(async () => { globalThis.fetch = originalFetch; await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await pool.end(); });
async function post(path: string, body: unknown) {
  const response = await fetch(`${base}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}
async function authorization(subject: string, email?: string) {
  const challenge = (await post("/auth/apple/challenge", {})).body;
  signedToken = await new SignJWT({ nonce: challenge.nonce, ...(email ? { email, email_verified: true, is_private_email: true } : {}) })
    .setProtectedHeader({ alg: "RS256", kid: "ios-test" }).setIssuer("https://appleid.apple.com").setAudience("com.centralstudio.app")
    .setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(signingKey);
  return { idToken: signedToken, authorizationCode: "synthetic-code", challengeId: challenge.challengeId, email: "untrusted@example.com", displayName: "Apple Test" };
}
test("Apple relay registration, repeat no-email login, replay rejection and OTP-only email collision", async () => {
  const subject = `ios-apple-${Date.now()}`; const email = `ios-${Date.now()}@privaterelay.appleid.com`;
  const firstBody = await authorization(subject, email);
  const first = await post("/auth/apple", firstBody);
  assert.equal(first.status, 200); assert.equal(typeof first.body.accessToken, "string");
  const { rows } = await pool.query("SELECT id,email,apple_id FROM students WHERE apple_id=$1", [subject]);
  assert.equal(rows[0].email, email);
  const credential = (await pool.query("SELECT * FROM apple_credentials WHERE subject=$1", [subject])).rows[0];
  assert.equal(credential.student_id, rows[0].id); assert.equal(JSON.stringify(credential).includes("synthetic-refresh-only"), false);
  assert.equal((await post("/auth/apple", firstBody)).status, 503);
  const repeated = await post("/auth/apple", await authorization(subject));
  assert.equal(repeated.status, 200); assert.equal(typeof repeated.body.accessToken, "string");
  const collisionEmail = `ios-collision-${Date.now()}@example.com`;
  const target = (await pool.query("INSERT INTO students(name,email,email_verified) VALUES('Existing',$1,true) RETURNING id", [collisionEmail])).rows[0];
  const secondSubject = `${subject}-collision`;
  const collision = await post("/auth/apple", await authorization(secondSubject, collisionEmail));
  assert.equal(collision.status, 409); assert.equal(collision.body.requiresLinkVerification, true); assert.equal(collision.body.accessToken, undefined);
  assert.equal((await pool.query("SELECT apple_id FROM students WHERE id=$1", [target.id])).rows[0].apple_id, null);
  assert.match(otp, /^\d{6}$/);
  const linked = await post("/auth/social-link/verify", { challengeId: collision.body.linkChallengeId, code: otp });
  assert.equal(linked.status, 200); assert.equal(typeof linked.body.accessToken, "string");
  assert.equal((await pool.query("SELECT apple_id FROM students WHERE id=$1", [target.id])).rows[0].apple_id, secondSubject);
});
