import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import bcrypt from "bcryptjs";
import { generateKeyPair, exportPKCS8 } from "jose";

const url = process.env.DISPOSABLE_IOS_DATABASE_URL ?? "postgresql://abdelrahmanomar@127.0.0.1:5617/central_studio_disposable_ios";
const parsedUrl = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname) || !parsedUrl.pathname.includes("disposable")) throw new Error("Disposable local DB required");
process.env.DATABASE_URL = url;
process.env.STUDENT_JWT_SECRET = "ios-test-jwt-secret";
process.env.IDENTITY_PROVENANCE_PEPPER = "ios-test-provenance-pepper".padEnd(64, "0");
process.env.OTP_PEPPER = "ios-test-otp-pepper".padEnd(64, "0");
let pool: typeof import("@workspace/db").pool;
let server: import("node:http").Server;
let base: string;
let sign: typeof import("../lib/authHelpers").signStudentToken;

before(async () => {
  const express = (await import("express")).default;
  pool = (await import("@workspace/db")).pool;
  sign = (await import("../lib/authHelpers")).signStudentToken;
  const app = express(); app.use(express.json());
  app.use("/api", (await import("../middlewares/auth")).requireAuth, (await import("./accountDeletion")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await pool.end(); });
async function student(tag: string, apple = false) {
  const email = `ios-${tag}-${Date.now()}@example.com`;
  const hash = await bcrypt.hash("Password123", 4);
  const { rows } = await pool.query("INSERT INTO students(name,email,password_hash,email_verified,apple_id) VALUES('IOS Test',$1,$2,true,$3) RETURNING id,token_version", [email, hash, apple ? `apple-${tag}-${Date.now()}` : null]);
  return { id: rows[0].id as number, email, token: sign(rows[0].id, email, true, rows[0].token_version) };
}
async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${base}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}
test("customer direct deletion anonymizes and revokes sessions without admin; historical records survive", async () => {
  const s = await student("direct");
  const oldQr = (await pool.query("SELECT qr_token FROM students WHERE id=$1", [s.id])).rows[0].qr_token;
  await pool.query("INSERT INTO package_orders(student_id,student_name,student_email,package_name,total_credits,remaining_credits,status) VALUES($1,'Historical Name',$2,'History',4,0,'expired')", [s.id, s.email]);
  await pool.query("INSERT INTO notification_devices(student_id,push_token,platform) VALUES($1,$2,'ios')", [s.id, `token-${s.id}`]);
  const proof = await post("/me/account-deletion/reauth", { password: "Password123" }, s.token);
  assert.equal(proof.status, 200);
  const stored = await pool.query("SELECT proof_hash FROM customer_deletion_requests WHERE student_id=$1", [s.id]);
  assert.notEqual(stored.rows[0].proof_hash, proof.body.deletionProof);
  const deleted = await post("/me/account-deletion", { deletionProof: proof.body.deletionProof, confirmation: "DELETE" }, s.token);
  assert.equal(deleted.status, 200); assert.equal(deleted.body.status, "completed", JSON.stringify(deleted.body));
  const row = (await pool.query("SELECT * FROM students WHERE id=$1", [s.id])).rows[0];
  assert.equal(row.account_status, "deleted"); assert.equal(row.password_hash, null); assert.equal(row.deleted_by_admin_id, null);
  assert.equal(row.email, `deleted-student-${s.id}@tombstone.invalid`);
  assert.notEqual(row.qr_token, oldQr);
  assert.equal((await pool.query("SELECT student_name FROM package_orders WHERE student_id=$1", [s.id])).rows[0].student_name, "Historical Name");
  assert.equal((await pool.query("SELECT is_active FROM notification_devices WHERE student_id=$1", [s.id])).rows[0].is_active, false);
  assert.equal((await post("/me/account-deletion/reauth", { password: "Password123" }, s.token)).status, 401);
  assert.equal((await post("/account-deletion/status", { statusToken: deleted.body.statusToken })).body.status, "completed");
});
test("Apple credential absence does not prevent Central deletion and never reports revoked", async () => {
  const s = await student("apple", true);
  const proof = await post("/me/account-deletion/reauth", { password: "Password123" }, s.token);
  const deleted = await post("/me/account-deletion", { deletionProof: proof.body.deletionProof, confirmation: "DELETE" }, s.token);
  assert.equal(deleted.body.status, "completed"); assert.equal(deleted.body.appleRevocation, "manual_required");
  assert.match(deleted.body.appleManualRevocation, /Stop Using/);
});
test("deletion rejects wrong proof, expired proof and client target ids", async () => {
  const s = await student("reject");
  const proof = await post("/me/account-deletion/reauth", { password: "Password123" }, s.token);
  assert.equal((await post("/me/account-deletion", { deletionProof: "x".repeat(32), confirmation: "DELETE" }, s.token)).status, 409);
  assert.equal((await post("/me/account-deletion", { deletionProof: proof.body.deletionProof, confirmation: "DELETE", studentId: 999 }, s.token)).status, 400);
  await pool.query("UPDATE customer_deletion_requests SET proof_expires_at=now()-interval '1 minute' WHERE student_id=$1", [s.id]);
  assert.equal((await post("/me/account-deletion", { deletionProof: proof.body.deletionProof, confirmation: "DELETE" }, s.token)).status, 409);
  assert.equal((await pool.query("SELECT account_status FROM students WHERE id=$1", [s.id])).rows[0].account_status, "active");
});
test("real unresolved credits create durable pending deletion and complete automatically after resolution", async () => {
  const s = await student("pending");
  await pool.query("INSERT INTO package_orders(student_id,student_name,student_email,package_name,total_credits,remaining_credits,status) VALUES($1,'Pending',$2,'Credits',4,4,'active')", [s.id,s.email]);
  const proof = await post("/me/account-deletion/reauth", { password: "Password123" }, s.token);
  const deleted = await post("/me/account-deletion", { deletionProof: proof.body.deletionProof, confirmation: "DELETE" }, s.token);
  assert.equal(deleted.body.status, "pending"); assert.ok(deleted.body.blockers.some((b: {key:string}) => b.key === "ACTIVE_PACKAGE_VALUE"));
  await pool.query("UPDATE package_orders SET status='expired',remaining_credits=0 WHERE student_id=$1", [s.id]);
  await (await import("../lib/customerAccountDeletion")).reconcileCustomerDeletions();
  assert.equal((await post("/account-deletion/status", { statusToken: deleted.body.statusToken })).body.status, "completed");
});

test("encrypted Apple revocation failure does not block deletion and durable retry removes credential", async () => {
  const s = await student("apple-retry", true);
  const subject = (await pool.query("SELECT apple_id FROM students WHERE id=$1", [s.id])).rows[0].apple_id;
  process.env.THIRD_PARTY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION = "ios-test";
  process.env.APPLE_CLIENT_ID = "com.centralstudio.app";
  process.env.APPLE_TEAM_ID = "TESTTEAM"; process.env.APPLE_KEY_ID = "TESTKEY";
  process.env.APPLE_PRIVATE_KEY = await exportPKCS8((await generateKeyPair("ES256", { extractable: true })).privateKey);
  const crypto = await import("../lib/thirdPartyTokenCrypto");
  const apple = await import("../lib/appleAuthorization");
  const secret = "synthetic-refresh-token-not-a-real-credential";
  await apple.persistAppleCredential(subject, crypto.encryptThirdPartyToken(secret, `apple-refresh:${subject}`, crypto.tokenEncryptionKeyringFromEnv()));
  const credential = (await pool.query("SELECT * FROM apple_credentials WHERE subject=$1", [subject])).rows[0];
  assert.equal(JSON.stringify(credential).includes(secret), false);
  const proof = await post("/me/account-deletion/reauth", { password: "Password123" }, s.token);
  assert.equal(typeof proof.body.statusToken, "string");
  const originalFetch = globalThis.fetch;
  let unavailable = true;
  globalThis.fetch = (async (input: any, init: any) => {
    if (String(input) === "https://appleid.apple.com/auth/revoke") {
      assert.equal(new URLSearchParams(init.body).get("token"), secret);
      return new Response(null, { status: unavailable ? 503 : 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const deleted = await post("/me/account-deletion", { deletionProof: proof.body.deletionProof, confirmation: "DELETE" }, s.token);
    assert.equal(deleted.body.status, "completed"); assert.equal(deleted.body.appleRevocation, "pending");
    assert.equal((await post("/account-deletion/status", { statusToken: proof.body.statusToken })).body.status, "completed");
    const pending = (await pool.query("SELECT * FROM apple_credentials WHERE subject=$1", [subject])).rows[0];
    assert.equal(pending.state, "revoke_pending"); assert.equal(pending.attempts, 1);
    await assert.rejects(apple.persistAppleCredential(subject, crypto.encryptThirdPartyToken(secret, `apple-refresh:${subject}`, crypto.tokenEncryptionKeyringFromEnv())));
    unavailable = false;
    await pool.query("UPDATE apple_credentials SET retry_at=now()-interval '1 minute' WHERE subject=$1", [subject]);
    await apple.reconcileAppleRevocations(s.id);
    assert.equal((await pool.query("SELECT * FROM apple_credentials WHERE subject=$1", [subject])).rowCount, 0);
    assert.equal((await (await import("../lib/customerAccountDeletion")).customerDeletionStatus(deleted.body.requestId))?.appleRevocation, "revoked");
  } finally { globalThis.fetch = originalFetch; }
});
