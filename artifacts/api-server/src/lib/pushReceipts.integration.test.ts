import assert from "node:assert/strict";
import { before, after, test } from "node:test";
const url = process.env.DISPOSABLE_IOS_DATABASE_URL ?? "postgresql://abdelrahmanomar@127.0.0.1:5617/central_studio_disposable_ios";
const parsed = new URL(url);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.includes("disposable")) throw new Error("Disposable local DB required");
process.env.DATABASE_URL = url;
let pool: typeof import("@workspace/db").pool;
before(async () => { pool = (await import("@workspace/db")).pool; });
after(async () => { await pool.end(); });
async function student(tag: string) {
  const email = `ios-${tag}-${Date.now()}@example.com`;
  const { rows } = await pool.query("INSERT INTO students(name,email,email_verified) VALUES('Push Test',$1,true) RETURNING id", [email]);
  return { id: rows[0].id as number };
}
test("receipt failures retire only attempted registrations; retry leases survive restart and expire", async () => {
  const s = await student("push-receipts");
  const { pushTokenHash } = await import("./pushReceiptProtocol");
  const { reconcilePushReceipts } = await import("./pushReceipts");
  const attemptedAt = new Date(Date.now() - 60000).toISOString();
  const add = async (tag: string, rotated = false, attempts = 0) => {
    const original = `old-${tag}-${s.id}`;
    const { rows: devices } = await pool.query("INSERT INTO notification_devices(student_id,push_token,platform,last_seen_at) VALUES($1,$2,'ios',$3) RETURNING id", [s.id, rotated ? `new-${tag}-${s.id}` : original, attemptedAt]);
    const { rows: logs } = await pool.query("INSERT INTO notification_delivery_logs(student_id,device_id,status,provider_message_id,attempted_token_hash,attempted_at,receipt_status,receipt_attempts,receipt_next_check_at) VALUES($1,$2,'sent',$3,$4,$5,'pending',$6,now()-interval '1 minute') RETURNING id", [s.id, devices[0].id, tag, pushTokenHash(original), attemptedAt, attempts]);
    return { deviceId: devices[0].id, logId: logs[0].id };
  };
  const stale = await add("stale"); const rotated = await add("rotated", true);
  const missing = await add("missing"); const expired = await add("expired", false, 10);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    if (String(input) === "https://exp.host/--/api/v2/push/getReceipts") {
      assert.equal(String(init.body).includes("old-"), false);
      return Response.json({ data: { stale: { status: "error", details: { error: "DeviceNotRegistered" } }, rotated: { status: "error", details: { error: "DeviceNotRegistered" } } } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    await reconcilePushReceipts();
    assert.equal((await pool.query("SELECT is_active FROM notification_devices WHERE id=$1", [stale.deviceId])).rows[0].is_active, false);
    assert.equal((await pool.query("SELECT is_active FROM notification_devices WHERE id=$1", [rotated.deviceId])).rows[0].is_active, true);
    assert.equal((await pool.query("SELECT receipt_status FROM notification_delivery_logs WHERE id=$1", [expired.logId])).rows[0].receipt_status, "unavailable");
    assert.equal((await pool.query("SELECT receipt_attempts FROM notification_delivery_logs WHERE id=$1", [missing.logId])).rows[0].receipt_attempts, 1);
    await reconcilePushReceipts(); // lease prevents duplicate reconciliation
    assert.equal((await pool.query("SELECT receipt_attempts FROM notification_delivery_logs WHERE id=$1", [missing.logId])).rows[0].receipt_attempts, 1);
    await pool.query("UPDATE notification_delivery_logs SET receipt_next_check_at=now()-interval '1 minute' WHERE id=$1", [missing.logId]);
    await reconcilePushReceipts(); // persisted state resumes after lease expiration
    assert.equal((await pool.query("SELECT receipt_attempts FROM notification_delivery_logs WHERE id=$1", [missing.logId])).rows[0].receipt_attempts, 2);
  } finally { globalThis.fetch = originalFetch; }
});
