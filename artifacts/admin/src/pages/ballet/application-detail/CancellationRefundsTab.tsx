import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, XCircle, Banknote } from "lucide-react";
import {
  BALLET_CANCELLATION_INITIATOR_LABELS,
  type BalletCancellationInitiatorType,
} from "@workspace/api-zod";
import type { ApplicationDetailTabPanelsProps } from "./types";
import { GridRow, Section } from "./shared";

export function CancellationRefundsTab(props: ApplicationDetailTabPanelsProps) {
  const { app, canCancel, dangerAction, openCancellationRequest, setDangerDialog, setCancelTiming, cancellationRequests, refunds, navigate } = props;
  const safeRequests = cancellationRequests ?? [];
  const safeRefunds = refunds ?? [];
  return (
<TabsContent value="cancellation" className="space-y-4">
  {/* Danger Zone stays visually distinct from the informational grid below
      — destructive/permission-aware actions must never blend in with
      read-only summary cards. Unchanged workflow, unchanged styling. */}
  {canCancel && (
    <Card className="border-red-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4" /> Danger Zone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {dangerAction.kind === "cancelApplication" && (
          <>
            <p className="text-sm text-muted-foreground">
              Cancel this pre-activation application. Any assigned level becomes <em>withdrawn</em> (never deleted); attendance and history are preserved.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setDangerDialog("cancelApplication"); }}
            >
              Cancel Application
            </Button>
          </>
        )}
        {dangerAction.kind === "cancelProgram" && (
          <>
            <p className="text-sm text-muted-foreground">
              Cancel this active enrollment. This creates a cancellation request in the shared workflow (never edits the enrollment rows directly) and writes an audit log.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setCancelTiming("immediate"); setDangerDialog("cancelProgram"); }}
            >
              Cancel Program
            </Button>
          </>
        )}
        {dangerAction.kind === "viewCancellationRequest" && (
          <>
            <p className="text-sm text-muted-foreground">
              An open cancellation request already exists for this enrollment ({openCancellationRequest?.status}). Manage it from the Cancellation Requests workflow.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/ballet/cancellation-requests")}>
              Manage Cancellation Request
            </Button>
          </>
        )}
        {dangerAction.kind === "none" && (
          <p className="text-sm text-muted-foreground italic">
            No cancellation action is available for an application in status “{app.status}”.
          </p>
        )}
      </CardContent>
    </Card>
  )}

  {/* Cancellation Requests + Refunds — the two workflow record types are
      already separate arrays (cancellationRequests, refunds); split them
      into complementary side-by-side summaries instead of one interleaved
      list. No data is duplicated — each record still appears exactly once. */}
  <GridRow>
    <Section title="Cancellation Requests" icon={<XCircle />}>
      {safeRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No cancellation requests.</p>
      ) : (
        <div className="space-y-3">
          {safeRequests.map((request: any) => (
            <div key={`cancel-${request.id}`} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Cancellation #{request.id}</span>
                <Badge variant="outline">{request.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Requested {request.requestedTiming}
                {request.approvedTiming ? ` · approved ${request.approvedTiming}` : ""}
                {request.approvedEffectiveDate ? ` · effective ${request.approvedEffectiveDate}` : ""}
                {request.requestRefund ? " · refund requested" : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Initiated by: {request.initiatedByType === "admin"
                  ? (request.initiatedByAdminName ?? "Admin")
                  : (BALLET_CANCELLATION_INITIATOR_LABELS[(request.initiatedByType as BalletCancellationInitiatorType) ?? "parent"] ?? "Parent")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{request.reason}</p>
            </div>
          ))}
        </div>
      )}
    </Section>

    <Section title="Refunds" icon={<Banknote />}>
      {safeRefunds.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No refund records.</p>
      ) : (
        <div className="space-y-3">
          {safeRefunds.map((refund: any) => (
            <div key={`refund-${refund.id}`} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Refund #{refund.id} · Payment #{refund.paymentId}</span>
                <Badge variant="outline">{refund.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {refund.refundMethod === "cash" ? "Cash refund" : refund.refundMethod}
                {refund.approvedAmountEgp ? ` · approved ${refund.approvedAmountEgp} EGP` : ""}
                {refund.refundedAmountEgp ? ` · refunded ${refund.refundedAmountEgp} EGP` : ""}
                {refund.transactionReference ? ` · ref ${refund.transactionReference}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{refund.requestedReason}</p>
            </div>
          ))}
        </div>
      )}
    </Section>
  </GridRow>
</TabsContent>
  );
}
