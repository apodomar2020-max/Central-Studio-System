import { and, eq, asc, sql } from "drizzle-orm";
import { db, studentsTable, notificationDevicesTable, studentDeletionWorkflowsTable, customerDeletionRequestsTable,
  emailOtpsTable, socialLinkChallengesTable, studentDanceInterestsTable } from "@workspace/db";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { STUDENT_JWT_SECRET } from "../middlewares/auth";
import { getActivePreparation, DELETION_PREPARATION_POLICY_VERSION } from "./studentDeletionPreparation";
import { applyStudentPermanentDelete } from "./studentDeletionPermanentDelete";
import { markAppleRevocation, reconcileAppleRevocations, APPLE_MANUAL_REVOCATION } from "./appleAuthorization";
import { logger } from "./logger";

export const deletionProofHash = (proof: string) => createHash("sha256").update(proof).digest("hex");
export const DELETION_DISCLOSURE = {
  deleted: ["Account authentication credentials and linked sign-in identifiers", "Student profile name, email, phone and optional profile information", "Local account caches and saved feedback"],
  retained: ["Protected booking, attendance, payment, package, credit and Ballet records", "Historical transaction contact snapshots and existing ownership evidence", "Child profiles and associated historical information under the existing retention policy"],
  pending: "Open bookings, balances, refunds, Ballet commitments or unresolved ownership may require resolution. Your request is saved and checked automatically; the studio can resolve remaining operational conditions.",
};

export function deletionStatusToken(id: string) {
  return jwt.sign({ purpose: "account-deletion-status", requestId: id }, STUDENT_JWT_SECRET, { expiresIn: "30d" });
}
export function readDeletionStatusToken(token: string): string {
  const claims = jwt.verify(token, STUDENT_JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
  if (claims.purpose !== "account-deletion-status" || typeof claims.requestId !== "string") throw new Error("Invalid status token");
  return claims.requestId;
}
export async function createDeletionProof(studentId: number, tokenVersion: number) {
  const proof = randomBytes(32).toString("base64url");
  await db.transaction(async tx => {
    const [student] = await tx.select().from(studentsTable).where(eq(studentsTable.id, studentId)).for("update");
    if (!student || student.accountStatus !== "active" || student.tokenVersion !== tokenVersion) throw new Error("Account changed");
    const [existing] = await tx.select().from(customerDeletionRequestsTable).where(eq(customerDeletionRequestsTable.studentId, studentId));
    if (existing && existing.status !== "proof") throw new Error("Deletion already requested");
    const fields = { proofHash: deletionProofHash(proof), proofExpiresAt: new Date(Date.now() + 300000).toISOString(), tokenVersion, updatedAt: new Date().toISOString() };
    await tx.insert(customerDeletionRequestsTable).values({ studentId, ...fields }).onConflictDoUpdate({ target: customerDeletionRequestsTable.studentId, set: fields });
  });
  return proof;
}

export async function initiateCustomerDeletion(studentId: number, proof: string) {
  return db.transaction(async tx => {
    const [student] = await tx.select().from(studentsTable).where(eq(studentsTable.id, studentId)).for("update");
    const [request] = await tx.select().from(customerDeletionRequestsTable).where(eq(customerDeletionRequestsTable.studentId, studentId)).for("update");
    if (!student || !request) throw new Error("Deletion confirmation expired. Please confirm again.");
    if (request.status !== "proof") return request;
    if (student.accountStatus !== "active" || request.tokenVersion !== student.tokenVersion || request.proofHash !== deletionProofHash(proof)
      || !request.proofExpiresAt || new Date(request.proofExpiresAt).getTime() <= Date.now()) throw new Error("Deletion confirmation expired. Please confirm again.");
    const now = new Date().toISOString();
    await tx.update(studentsTable).set({ accountStatus: "deactivated", deactivatedAt: now, deactivatedByAdminId: null,
      tokenVersion: sql`${studentsTable.tokenVersion} + 1` }).where(eq(studentsTable.id, studentId));
    await tx.update(notificationDevicesTable).set({ isActive: false, unregisterSecretHash: null }).where(eq(notificationDevicesTable.studentId, studentId));
    await tx.delete(emailOtpsTable).where(eq(emailOtpsTable.studentId, studentId));
    await tx.delete(socialLinkChallengesTable).where(eq(socialLinkChallengesTable.studentId, studentId));
    const prep = await getActivePreparation(tx, studentId);
    const workflow = prep ?? (await tx.insert(studentDeletionWorkflowsTable).values({ studentId, status: "PREPARING", startedByAdminId: null,
      policyVersion: DELETION_PREPARATION_POLICY_VERSION }).returning())[0]!;
    const canRevoke = student.appleId ? await markAppleRevocation(tx, studentId) : false;
    const [updated] = await tx.update(customerDeletionRequestsTable).set({ status: "pending", proofHash: null, proofExpiresAt: null,
      workflowId: workflow.id, requestedAt: now, updatedAt: now,
      appleRevocation: student.appleId ? canRevoke ? "pending" : "manual_required" : "not_applicable" }).where(eq(customerDeletionRequestsTable.id, request.id)).returning();
    return updated!;
  });
}

export async function completeCustomerDeletion(requestId: string) {
  const [request] = await db.select().from(customerDeletionRequestsTable).where(eq(customerDeletionRequestsTable.id, requestId));
  if (!request || request.status !== "pending" || !request.workflowId) return;
  const outcome = await applyStudentPermanentDelete({ studentId: request.studentId, workflowId: request.workflowId, adminId: null });
  if (outcome.kind === "deleted" || outcome.kind === "alreadyDeleted") {
    await db.transaction(async tx => {
      await tx.delete(studentDanceInterestsTable).where(eq(studentDanceInterestsTable.studentId, request.studentId));
      await tx.delete(emailOtpsTable).where(eq(emailOtpsTable.studentId, request.studentId));
      await tx.update(customerDeletionRequestsTable).set({ status: "completed", completedAt: new Date().toISOString(), blockers: [], updatedAt: new Date().toISOString() })
        .where(eq(customerDeletionRequestsTable.id, request.id));
    });
  } else {
    await db.update(customerDeletionRequestsTable).set({ blockers: outcome.blockers ?? [{ key: outcome.reason, label: "Ownership preparation requires studio resolution" }], updatedAt: new Date().toISOString() })
      .where(eq(customerDeletionRequestsTable.id, request.id));
  }
}

export async function reconcileCustomerDeletions() {
  const requests = await db.select({ id: customerDeletionRequestsTable.id }).from(customerDeletionRequestsTable)
    .where(eq(customerDeletionRequestsTable.status, "pending")).orderBy(asc(customerDeletionRequestsTable.updatedAt)).limit(25);
  for (const request of requests) { try { await completeCustomerDeletion(request.id); } catch { logger.warn({ requestId: request.id }, "Customer deletion reconciliation failed; durable request will retry"); } }
  await reconcileAppleRevocations();
}
export async function customerDeletionStatus(id: string) {
  const [request] = await db.select().from(customerDeletionRequestsTable).where(eq(customerDeletionRequestsTable.id, id));
  if (!request || request.status === "proof") return null;
  return { requestId: request.id, status: request.status, blockers: request.blockers, appleRevocation: request.appleRevocation,
    appleManualRevocation: request.appleRevocation === "pending" || request.appleRevocation === "manual_required" ? APPLE_MANUAL_REVOCATION : null,
    requestedAt: request.requestedAt, completedAt: request.completedAt, disclosure: DELETION_DISCLOSURE };
}
