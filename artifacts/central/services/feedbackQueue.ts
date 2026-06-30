import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { isOfflineError } from "@/services/connectivity";
import { submitFeedback, type RequiredFeedbackItem, type SubmitFeedbackInput } from "@/services/feedbackService";

const QUEUE_KEY_PREFIX = "feedback_queue_v1";

export interface QueuedFeedback extends SubmitFeedbackInput {
  queuedAt: string;
  display: RequiredFeedbackItem;
}

function queueKey(studentKey: string): string {
  return `${QUEUE_KEY_PREFIX}:${studentKey}`;
}

export function createClientSubmissionId(): string {
  return Crypto.randomUUID();
}

export async function loadQueuedFeedback(studentKey: string): Promise<QueuedFeedback[]> {
  const raw = await AsyncStorage.getItem(queueKey(studentKey));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(studentKey: string, items: QueuedFeedback[]): Promise<void> {
  await AsyncStorage.setItem(queueKey(studentKey), JSON.stringify(items));
}

export async function enqueueFeedback(studentKey: string, item: QueuedFeedback): Promise<void> {
  const current = await loadQueuedFeedback(studentKey);
  const withoutDuplicates = current.filter(
    (q) => q.attendanceId !== item.attendanceId && q.clientSubmissionId !== item.clientSubmissionId,
  );
  await saveQueue(studentKey, [...withoutDuplicates, item]);
}

export async function removeQueuedFeedback(studentKey: string, clientSubmissionId: string): Promise<void> {
  const current = await loadQueuedFeedback(studentKey);
  await saveQueue(studentKey, current.filter((q) => q.clientSubmissionId !== clientSubmissionId));
}

export async function flushFeedbackQueue(studentKey: string): Promise<{ uploaded: number; offline: boolean }> {
  const current = await loadQueuedFeedback(studentKey);
  let uploaded = 0;
  let offline = false;
  const remaining: QueuedFeedback[] = [];

  for (const item of current) {
    try {
      await submitFeedback(item);
      uploaded += 1;
    } catch (error) {
      if (isOfflineError(error)) {
        offline = true;
        remaining.push(item);
      } else {
        remaining.push(item);
      }
    }
  }

  await saveQueue(studentKey, remaining);
  return { uploaded, offline };
}
