import { isValidIsoDate } from "./occurrence";

export function assertValidBullMqCustomJobId(jobId: string): string {
  if (jobId.includes(":")) {
    throw new Error("BullMQ custom jobId must not contain ':'");
  }
  return jobId;
}

export function balletAbsenceOccurrenceJobId(
  balletScheduleId: number,
  classDate: string,
): string {
  if (!Number.isSafeInteger(balletScheduleId) || balletScheduleId <= 0) {
    throw new Error("Ballet absence occurrence jobId requires a positive integer Schedule ID");
  }
  if (!isValidIsoDate(classDate)) {
    throw new Error("Ballet absence occurrence jobId requires a canonical ISO class date");
  }
  return assertValidBullMqCustomJobId(`ballet-auto-absence-${balletScheduleId}-${classDate}`);
}

export function balletAbsencePushJobId(notificationId: number): string {
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    throw new Error("Ballet absence push jobId requires a positive integer Notification ID");
  }
  return assertValidBullMqCustomJobId(`ballet-absence-push-${notificationId}`);
}
