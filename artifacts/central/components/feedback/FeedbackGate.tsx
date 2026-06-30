import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import FeedbackModal from "@/components/feedback/FeedbackModal";
import { useAppContext } from "@/contexts/AppContext";
import { isOfflineError } from "@/services/connectivity";
import { fetchRequiredFeedback, submitFeedback, type RequiredFeedbackItem } from "@/services/feedbackService";
import {
  createClientSubmissionId,
  enqueueFeedback,
  flushFeedbackQueue,
  loadQueuedFeedback,
  type QueuedFeedback,
} from "@/services/feedbackQueue";

export default function FeedbackGate() {
  const { user } = useAppContext();
  const [required, setRequired] = useState<RequiredFeedbackItem[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const mountedRef = useRef(true);

  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionIndex, setSessionIndex] = useState(0);

  useEffect(() => {
    if (required.length === 0) {
      setSessionTotal(0);
      setSessionIndex(0);
    } else if (sessionTotal === 0) {
      setSessionTotal(required.length);
      setSessionIndex(1);
    }
  }, [required.length, sessionTotal]);

  const studentKey = useMemo(() => {
    if (!user) return null;
    return `${user.id}:${user.email.trim().toLowerCase()}`;
  }, [user]);

  const refresh = useCallback(async () => {
    if (!studentKey || !user) {
      setRequired([]);
      return;
    }
    setIsChecking(true);
    try {
      await flushFeedbackQueue(studentKey);
      const [remoteRequired, queued] = await Promise.all([
        fetchRequiredFeedback(),
        loadQueuedFeedback(studentKey),
      ]);
      const queuedAttendanceIds = new Set(queued.map((item) => item.attendanceId));
      if (mountedRef.current) {
        setRequired(remoteRequired.filter((item) => !queuedAttendanceIds.has(item.attendanceId)));
      }
    } catch (error) {
      if (!isOfflineError(error) && mountedRef.current) {
        setRequired((current) => current);
      }
    } finally {
      if (mountedRef.current) setIsChecking(false);
    }
  }, [studentKey, user]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  const current = required[0];

  async function handleSubmit(input: { rating: number; comment: string; tags: string[] }): Promise<"submitted" | "queued"> {
    if (!current || !studentKey) return "submitted";

    const payload: QueuedFeedback = {
      attendanceId: current.attendanceId,
      rating: input.rating,
      comment: input.comment || null,
      tags: input.tags,
      clientSubmissionId: createClientSubmissionId(),
      submittedAt: new Date().toISOString(),
      queuedAt: new Date().toISOString(),
      display: current,
    };

    try {
      await submitFeedback(payload);
      return "submitted";
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      await enqueueFeedback(studentKey, payload);
      return "queued";
    }
  }

  function completeCurrent() {
    setRequired((items) => items.slice(1));
    setSessionIndex((idx) => idx + 1);
    setTimeout(() => {
      refresh();
    }, 250);
  }

  if (!user || !current || isChecking && required.length === 0) return null;

  return (
    <FeedbackModal
      visible={Boolean(current)}
      item={current}
      queueIndex={sessionIndex}
      queueTotal={sessionTotal}
      onSubmit={handleSubmit}
      onComplete={completeCurrent}
    />
  );
}
