import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Star } from "lucide-react";
import { Link, useParams } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";
const REVIEW_STATUSES = ["pending", "in_review", "resolved", "dismissed"] as const;

interface FeedbackDetail {
  id: number;
  attendanceId: number;
  studentId: number | null;
  studentEmailSnapshot: string;
  studentNameSnapshot: string;
  childNameSnapshot: string | null;
  bookingId: number | null;
  classId: number | null;
  classTitleSnapshot: string | null;
  scheduleId: number | null;
  scheduleSnapshot: Record<string, unknown> | null;
  instructorId: number | null;
  instructorNameSnapshot: string | null;
  danceTypeNameSnapshot: string | null;
  rating: number;
  comment: string | null;
  commentHidden: boolean;
  tags: string[];
  reviewStatus: string;
  reviewedBy: number | null;
  reviewedAt: string | null;
  clientSubmissionId: string;
  submittedAt: string | null;
  receivedAt: string;
}

function makeHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[#00B6D7]">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`h-5 w-5 ${i < rating ? "fill-current" : "opacity-25"}`} />
      ))}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-white">{value || "-"}</div>
    </div>
  );
}

export default function FeedbackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const feedbackId = Number(id);
  const { token, can } = useAdminAuth();
  const canReview = can("feedback", "review");
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["feedback-detail", feedbackId],
    enabled: Number.isInteger(feedbackId) && feedbackId > 0,
    queryFn: async (): Promise<FeedbackDetail> => {
      const res = await fetch(`${API_BASE}/api/feedback/${feedbackId}`, { headers: makeHeaders(token) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load feedback");
      }
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (reviewStatus: string) => {
      const res = await fetch(`${API_BASE}/api/feedback/${feedbackId}/review`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify({ reviewStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to update review status");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback-detail", feedbackId] });
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
    },
  });

  const detail = query.data;
  const scheduleLabel = typeof detail?.scheduleSnapshot?.["label"] === "string" ? detail.scheduleSnapshot["label"] : null;

  if (query.isLoading) return <div className="py-10 text-center text-muted-foreground">Loading feedback...</div>;
  if (query.isError || !detail) return <div className="py-10 text-center text-destructive">{query.error?.message ?? "Feedback not found"}</div>;

  return (
    <div className="admin2-final-page admin2-record-review space-y-6">
      <Link href="/feedback">
        <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Back to Feedback</Button>
      </Link>

      <PageHeader
        title={`Feedback #${detail.id}`}
        description="Internal class feedback detail."
        mode="studio"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Submission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/20 p-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rating</div>
                <div className="mt-2"><Stars rating={detail.rating} /></div>
              </div>
              <Badge variant="outline">{detail.reviewStatus.replace("_", " ")}</Badge>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comment</div>
              <div className="mt-2 rounded-xl border border-border bg-muted/20 p-4 text-sm leading-6 text-white">
                {detail.commentHidden ? "Hidden. This account does not have feedback.viewComments." : detail.comment || "No comment provided."}
              </div>
            </div>

            {detail.tags.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canReview ? (
              <Select value={detail.reviewStatus} onValueChange={(v) => reviewMutation.mutate(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REVIEW_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{status.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline">{detail.reviewStatus.replace("_", " ")}</Badge>
            )}
            {reviewMutation.isError && <p className="text-sm text-destructive">{reviewMutation.error.message}</p>}
            <DetailRow label="Reviewed By" value={detail.reviewedBy ?? "-"} />
            <DetailRow label="Reviewed At" value={formatDate(detail.reviewedAt)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Context Snapshot</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <DetailRow label="Student" value={`${detail.studentNameSnapshot} (${detail.studentEmailSnapshot})`} />
          <DetailRow label="Child" value={detail.childNameSnapshot} />
          <DetailRow label="Trainer" value={detail.instructorNameSnapshot} />
          <DetailRow label="Class" value={detail.classTitleSnapshot} />
          <DetailRow label="Dance Style" value={detail.danceTypeNameSnapshot} />
          <DetailRow label="Schedule" value={scheduleLabel} />
          <DetailRow label="Attendance ID" value={detail.attendanceId} />
          <DetailRow label="Booking ID" value={detail.bookingId} />
          <DetailRow label="Submitted At" value={formatDate(detail.submittedAt)} />
          <DetailRow label="Received At" value={formatDate(detail.receivedAt)} />
          <DetailRow label="Client Submission ID" value={<span className="break-all">{detail.clientSubmissionId}</span>} />
        </CardContent>
      </Card>
    </div>
  );
}
import "./admin2-final.css";
