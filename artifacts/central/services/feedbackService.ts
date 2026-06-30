import { customFetch } from "@workspace/api-client-react";

export interface RequiredFeedbackItem {
  attendanceId: number;
  checkedInAt: string;
  dueAt: string;
  studentName: string;
  childName: string | null;
  classId: number | null;
  scheduleId: number | null;
  bookingId: number | null;
  classTitle: string;
  instructorName: string;
  instructorPhotoUrl: string | null;
  danceTypeName: string | null;
  scheduleLabel: string | null;
  location: string | null;
  alreadySubmitted: boolean;
}

export interface SubmitFeedbackInput {
  attendanceId: number;
  rating: number;
  comment?: string | null;
  tags?: string[];
  clientSubmissionId: string;
  submittedAt?: string | null;
}

export interface SubmitFeedbackResult {
  id: number;
  attendanceId: number;
  rating: number;
  reviewStatus: string;
  submittedAt: string | null;
  receivedAt: string;
}

export async function fetchRequiredFeedback(): Promise<RequiredFeedbackItem[]> {
  const res = await customFetch<{ data: RequiredFeedbackItem[] }>("/api/my/feedback/required");
  return res.data;
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  return customFetch<SubmitFeedbackResult>("/api/my/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
