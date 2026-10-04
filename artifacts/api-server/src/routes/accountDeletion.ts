import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, studentsTable, customerDeletionRequestsTable } from "@workspace/db";
import { requireStudentAuth } from "../middlewares/studentAuth";
import { ipRateLimiter } from "../middlewares/authRateLimit";
import { issueOtp, verifyOtpCode, OtpRateLimitError } from "../lib/authHelpers";
import { createDeletionProof, initiateCustomerDeletion, completeCustomerDeletion, customerDeletionStatus, deletionStatusToken, readDeletionStatusToken, DELETION_DISCLOSURE } from "../lib/customerAccountDeletion";
import { reconcileAppleRevocations } from "../lib/appleAuthorization";
import { verifyProviderToken } from "../lib/socialProviders";

const router: IRouter = Router();
const limiter = ipRateLimiter("account-deletion", { limit: 15, windowSeconds: 15 * 60 });
router.get("/me/account-deletion", requireStudentAuth, async (req, res) => {
  const [request] = await db.select().from(customerDeletionRequestsTable).where(eq(customerDeletionRequestsTable.studentId, req.studentId!));
  const [student] = await db.select({ googleId: studentsTable.googleId, facebookId: studentsTable.facebookId, appleId: studentsTable.appleId }).from(studentsTable).where(eq(studentsTable.id, req.studentId!));
  res.json({ disclosure: DELETION_DISCLOSURE, linkedProviders: [student?.googleId ? "google" : null, student?.facebookId ? "facebook" : null, student?.appleId ? "apple" : null].filter(Boolean),
    request: request && request.status !== "proof" ? await customerDeletionStatus(request.id) : null });
});
router.post("/me/account-deletion/revoke-provider", requireStudentAuth, limiter, async (req, res) => {
  const parsed = z.object({ provider: z.enum(["google", "facebook"]), accessToken: z.string().min(1).max(8192) }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid provider authorization." }); return; }
  const { provider, accessToken } = parsed.data;
  try {
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.studentId!));
    if (!student) throw new Error();
    if (provider === "google") {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(10000) });
      const claims = await response.json() as { aud?: string; sub?: string; user_id?: string };
      if (!response.ok || !(process.env.GOOGLE_CLIENT_ID ?? "").split(",").map(v => v.trim()).includes(claims.aud ?? "") || (claims.sub ?? claims.user_id) !== student.googleId) throw new Error();
      const revoked = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: accessToken }), signal: AbortSignal.timeout(10000) });
      if (!revoked.ok) throw new Error();
    } else {
      const identity = await verifyProviderToken("facebook", accessToken);
      if (identity.providerId !== student.facebookId) throw new Error();
      const revoked = await fetch("https://graph.facebook.com/me/permissions", { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
      const data = await revoked.json() as { success?: boolean };
      if (!revoked.ok || data.success !== true) throw new Error();
    }
    res.json({ status: "revoked" });
  } catch { res.json({ status: "manual_required" }); }
});
router.post("/me/account-deletion/code", requireStudentAuth, limiter, async (req, res) => {
  try { await issueOtp(req.studentEmail!, { studentId: req.studentId!, purpose: "account_delete" }); res.json({ ok: true }); }
  catch (e) { res.status(e instanceof OtpRateLimitError ? 429 : 503).json({ error: "Unable to send a code right now. Please try again later." }); }
});
const Reauth = z.object({ password: z.string().max(256).optional(), code: z.string().regex(/^\d{6}$/).optional() }).strict();
router.post("/me/account-deletion/reauth", requireStudentAuth, limiter, async (req, res) => {
  const parsed = Reauth.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter your password or deletion confirmation code." }); return; }
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.studentId!));
  if (!student) { res.status(401).json({ error: "Please sign in again." }); return; }
  const valid = parsed.data.password && student.passwordHash ? await bcrypt.compare(parsed.data.password, student.passwordHash)
    : parsed.data.code ? (await verifyOtpCode(student.email, parsed.data.code, "account_delete")).status === "ok" : false;
  if (!valid) { res.status(400).json({ error: "Incorrect or expired confirmation. Please try again." }); return; }
  try {
    const deletionProof = await createDeletionProof(student.id, student.tokenVersion);
    const [request] = await db.select().from(customerDeletionRequestsTable).where(eq(customerDeletionRequestsTable.studentId, student.id));
    res.json({ deletionProof, statusToken: deletionStatusToken(request.id), expiresIn: 300 });
  }
  catch { res.status(409).json({ error: "Account changed. Please sign in again." }); }
});
const Delete = z.object({ deletionProof: z.string().min(20).max(128), confirmation: z.literal("DELETE") }).strict();
router.post("/me/account-deletion", requireStudentAuth, limiter, async (req, res) => {
  const parsed = Delete.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Confirm account deletion." }); return; }
  let request;
  try { request = await initiateCustomerDeletion(req.studentId!, parsed.data.deletionProof); }
  catch { res.status(409).json({ error: "Deletion confirmation expired. Please confirm again." }); return; }
  // Account deletion is not held hostage by Apple credential availability or network failure.
  try { await completeCustomerDeletion(request.id); } catch { /* durable worker retry */ }
  try { await reconcileAppleRevocations(req.studentId!); } catch { /* encrypted credential remains retryable */ }
  res.json({ ...(await customerDeletionStatus(request.id)), statusToken: deletionStatusToken(request.id) });
});
router.post("/account-deletion/status", limiter, async (req, res) => {
  const parsed = z.object({ statusToken: z.string().max(2048) }).strict().safeParse(req.body);
  try {
    if (!parsed.success) throw new Error();
    const status = await customerDeletionStatus(readDeletionStatusToken(parsed.data.statusToken));
    if (!status) throw new Error();
    res.json(status);
  } catch { res.status(401).json({ error: "Deletion status unavailable. Your saved request remains active." }); }
});
export default router;
