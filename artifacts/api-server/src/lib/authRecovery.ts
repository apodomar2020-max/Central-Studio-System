import { Queue, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db, studentsTable } from "@workspace/db";
import { getAdmissionRedis } from "./authAbuseProtection";
import { issueOtp, OtpRateLimitError, OTP_TTL_SECONDS } from "./authHelpers";
import { AuthAdmissionError, reserveRecoveryRequest, type AdmissionContext } from "./nativeAuthAdmission";
import { logger } from "./logger";

export const AUTH_RECOVERY_QUEUE = "auth-password-recovery";
export type RecoveryJob = { studentId: number | null; peer?: string };
let queue: Queue<RecoveryJob> | undefined;

// Admission counts known/unknown recipients identically before lookup. No
// detached promises, no email/OTP/JWT in jobs, and exactly one delivery attempt.
export async function enqueueRecovery(email: string, context: AdmissionContext): Promise<void> {
  await reserveRecoveryRequest(email, context);
  const redis = getAdmissionRedis();
  if (!redis) throw new AuthAdmissionError("unavailable");
  const [student] = await db.select({ id: studentsTable.id }).from(studentsTable).where(eq(studentsTable.email, email));
  queue ??= new Queue<RecoveryJob>(AUTH_RECOVERY_QUEUE, { connection: redis });
  await queue.add("reset", { studentId: student?.id ?? null, ...(context.peer ? { peer: context.peer } : {}) }, {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export async function processRecovery(job: Pick<Job<RecoveryJob>, "data" | "timestamp">): Promise<void> {
  if (Date.now() - job.timestamp > OTP_TTL_SECONDS * 1000 || job.data.studentId === null) return;
  const [student] = await db.select({ id: studentsTable.id, email: studentsTable.email }).from(studentsTable).where(eq(studentsTable.id, job.data.studentId));
  if (!student) return;
  try {
    await issueOtp(student.email, { studentId: student.id, peer: job.data.peer, purpose: "reset" });
  } catch (error) {
    // No provider error object/raw payload in logs. Cooldown is an expected no-op.
    if (!(error instanceof OtpRateLimitError)) logger.warn({ event: "recovery_delivery_unavailable" }, "Password recovery delivery unavailable");
  }
}

export async function closeRecoveryQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
