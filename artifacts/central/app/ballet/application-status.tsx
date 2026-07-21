/**
 * app/ballet/application-status.tsx
 *
 * Shows the authenticated parent's most recent ballet application status.
 * Navigated to from:
 *  - assessment.tsx after a successful POST /api/ballet/applications (201)
 *  - assessment.tsx when the server returns 409 DUPLICATE_APPLICATION
 *  - assessment.tsx on mount if an active application already exists
 *
 * Allows cancellation (status-gated) and surfaces what each status means
 * in plain language so parents always know where they stand.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
} from "react-native";

import {
  fetchMyApplications,
  fetchBalletApplicationDetail,
  cancelBalletApplication,
  requestBalletEnrollmentCancellation,
  withdrawBalletEnrollmentCancellationRequest,
  fetchBalletLevels,
  fetchBalletGroups,
  fetchBalletClasses,
  CANCELLABLE_APPLICATION_STATUSES,
  EDITABLE_APPLICATION_STATUSES,
  ACTIVE_APPLICATION_STATUSES,
  type BalletApplication,
  type BalletApplicationDetail,
  type BalletClassSchedule,
  isOfflineError,
} from "@/services/balletAssessmentService";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import OfflineState from "@/components/OfflineState";
import { useCentralAlert } from "@/hooks/useCentralAlert";

const BALLET_COLOR = "#00B6D6";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "18:00" → "6:00 PM", "09:30" → "9:30 AM" */
function formatTime(timeStr: string): string {
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  const hours = parseInt(hoursStr, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${minsStr} ${ampm}`;
}

// ─── Status meta ──────────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
}

function getStatusMeta(status: string, levelName?: string | null, groupName?: string | null, groupSchedules?: BalletClassSchedule[]): StatusMeta {
  const groupPart = groupName ? ` in group "${groupName}"` : "";
  const schedulePart = groupSchedules && groupSchedules.length > 0
    ? ` (meets ${groupSchedules.map((s) => `${DAY_SHORT[s.dayOfWeek] ?? "?"} ${formatTime(s.startTime)}`).join(", ")})`
    : "";

  switch (status) {
    case "pending":
      return {
        label: "Under Review",
        description:
          "Your application and assessment appointment are on file. Our team is reviewing your application and will confirm next steps soon.",
        icon: "time-outline",
        color: "#F59E0B",
      };
    case "needsFollowUp":
      return {
        label: "Follow-up Required",
        description:
          "Our team needs to gather a bit more information. Please expect a call or email from us shortly.",
        icon: "chatbubble-ellipses-outline",
        color: "#F59E0B",
      };
    case "accepted":
      return {
        label: "Accepted!",
        description:
          "Your child has been accepted into our ballet programme. Our team will contact you with enrolment details.",
        icon: "checkmark-circle",
        color: "#22C55E",
      };
    case "assignedToLevel":
      return {
        label: "Level Assigned",
        description: levelName
          ? `Your child has been assessed and assigned to ${levelName}${groupPart}${schedulePart}. Enrolment can now be completed.`
          : "Your child has been assessed and assigned to a ballet level. Enrolment can now be completed.",
        icon: "ribbon-outline",
        color: BALLET_COLOR,
      };
    case "active":
      return {
        label: "Active Student",
        description: levelName
          ? `Your child is currently an active ballet student in ${levelName}${groupPart}${schedulePart} at Central Studio.`
          : "Your child is currently an active ballet student at Central Studio.",
        icon: "star-outline",
        color: BALLET_COLOR,
      };
    case "rejected":
      return {
        label: "Not Accepted",
        description:
          "Unfortunately, we were not able to accept your child at this time. You are welcome to reapply in a future cycle.",
        icon: "close-circle-outline",
        color: "#EF4444",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        description:
          "This application has been cancelled. You may submit a new application at any time.",
        icon: "ban-outline",
        color: "#6B7280",
      };
    case "withdrawn":
      return {
        label: "Enrollment Ended",
        description:
          "This Ballet enrollment has ended. You may submit a new application when you are ready.",
        icon: "exit-outline",
        color: "#6B7280",
      };
    default:
      return {
        label: status,
        description: "Please contact the studio for more information.",
        icon: "information-circle-outline",
        color: "#9CA3AF",
      };
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ApplicationStatusScreen() {
  const insets = useSafeAreaInsets();
  const alert = useCentralAlert();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const requestedApplicationIdParam = Array.isArray(id) ? id[0] : id;
  const requestedApplicationId = Number(requestedApplicationIdParam);

  const [loadState, setLoadState] = useState<"loading" | "success" | "empty" | "offline" | "error">("loading");
  const [application, setApplication] = useState<BalletApplication | null>(null);
  const [applicationDetail, setApplicationDetail] = useState<BalletApplicationDetail | null>(null);
  const [hasExplicitApplicationContext, setHasExplicitApplicationContext] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [requestingCancellation, setRequestingCancellation] = useState(false);
  const [reasonModal, setReasonModal] = useState<null | {
    kind: "cancelApplication" | "requestEnrollmentCancellation";
    requestedTiming?: "immediate" | "endOfPeriod";
    requestRefund?: boolean;
  }>(null);
  const [reasonText, setReasonText] = useState("");
  const trimmedReason = reasonText.trim();
  const reasonError = trimmedReason.length === 0
    ? "Reason is required."
    : trimmedReason.length < 5
      ? "Reason must be at least 5 characters."
      : trimmedReason.length > 500
        ? "Reason must be at most 500 characters."
        : null;

  // Level id → name lookup (mirrors the levelNameById pattern in
  // app/ballet/classes.tsx) so "assignedToLevel"/"active" cards can show the
  // real level name instead of a generic phrase. Best-effort — if this fetch
  // fails, getStatusMeta simply falls back to its generic copy.
  const [levelNameById, setLevelNameById] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    const ctrl = new AbortController();
    fetchBalletLevels(ctrl.signal)
      .then((levels) => {
        if (ctrl.signal.aborted) return;
        setLevelNameById(new Map(levels.map((l) => [l.id, l.name])));
      })
      .catch(() => {
        // Best-effort — keep the generic status copy on failure.
      });
    return () => ctrl.abort();
  }, []);

  // Group id → name lookup, and group id → aggregated (deduped) weekly
  // schedules, built client-side from the two existing public catalogue
  // endpoints (no new endpoint needed — GET /api/ballet/groups has no
  // schedule data, but GET /api/ballet/classes does, keyed by groupId).
  // Best-effort — if either fetch fails, the group/schedule line is simply
  // omitted from the status card.
  const [groupNameById, setGroupNameById] = useState<Map<number, string>>(new Map());
  const [schedulesByGroupId, setSchedulesByGroupId] = useState<Map<number, BalletClassSchedule[]>>(new Map());

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([fetchBalletGroups(ctrl.signal), fetchBalletClasses(ctrl.signal)])
      .then(([groups, classes]) => {
        if (ctrl.signal.aborted) return;
        setGroupNameById(new Map(groups.map((g) => [g.id, g.name])));

        // groupId -> (scheduleId -> schedule), accumulated across the
        // separate classes owned by that group.
        const byGroup = new Map<number, Map<number, BalletClassSchedule>>();
        for (const cls of classes) {
          const schedMap = byGroup.get(cls.groupId) ?? new Map<number, BalletClassSchedule>();
          if (cls.schedule) schedMap.set(cls.schedule.id, cls.schedule);
          byGroup.set(cls.groupId, schedMap);
        }
        const result = new Map<number, BalletClassSchedule[]>();
        for (const [groupId, schedMap] of byGroup) {
          result.set(
            groupId,
            [...schedMap.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
          );
        }
        setSchedulesByGroupId(result);
      })
      .catch(() => {
        // Best-effort — keep the generic status copy on failure.
      });
    return () => ctrl.abort();
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    try {
      const apps = await fetchMyApplications(signal);
      if (signal?.aborted) return;

      if (apps.length === 0) {
        setLoadState("empty");
        return;
      }

      const requested = Number.isInteger(requestedApplicationId) && requestedApplicationId > 0
        ? apps.find((candidate) => candidate.id === requestedApplicationId) ?? null
        : null;
      if (requestedApplicationIdParam != null && requested == null) {
        setApplication(null);
        setApplicationDetail(null);
        setHasExplicitApplicationContext(false);
        setLoadState("error");
        return;
      }
      const onlyApplication = apps.length === 1 ? apps.at(0) ?? null : null;
      const selected = requested ?? onlyApplication ?? apps.at(0) ?? null;
      if (!selected) {
        setLoadState("empty");
        return;
      }
      // Multiple applications may still show the newest read-only history,
      // but destructive actions require an exact route-selected application.
      setHasExplicitApplicationContext(requested != null || onlyApplication != null);
      setApplication(selected);
      try {
        const detail = await fetchBalletApplicationDetail(selected.id, signal);
        if (!signal?.aborted) setApplicationDetail(detail);
      } catch {
        if (!signal?.aborted) setApplicationDetail(null);
      }
      setLoadState("success");
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setLoadState(isOfflineError(e) ? "offline" : "error");
    }
  }, [requestedApplicationId, requestedApplicationIdParam]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // ── Cancel handler ─────────────────────────────────────────────────────────

  function promptCancel() {
    if (!application || !hasExplicitApplicationContext) return;
    alert.show({
      tone: "destructive",
      title: `Cancel ${application.childName}'s Application?`,
      message: `This cancels only ${application.childName}'s Ballet application. You will be able to submit a new application afterwards.`,
      actions: [
        { label: "Keep Application", tone: "neutral" },
        {
          label: "Yes, Cancel",
          tone: "danger",
          onPress: () => openReasonModal({ kind: "cancelApplication" }),
        },
      ],
    });
  }

  function openReasonModal(next: NonNullable<typeof reasonModal>) {
    setReasonText("");
    setReasonModal(next);
  }

  function closeReasonModal() {
    if (cancelling || requestingCancellation) return;
    setReasonModal(null);
    setReasonText("");
  }

  async function submitReasonModal() {
    if (!reasonModal || reasonError) return;
    if (reasonModal.kind === "cancelApplication") {
      await doCancel(trimmedReason);
      return;
    }
    if (!reasonModal.requestedTiming) return;
    await submitCancellationRequest(reasonModal.requestedTiming, reasonModal.requestRefund === true, trimmedReason);
  }

  async function doCancel(reason: string) {
    if (!application || !hasExplicitApplicationContext || cancelling) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCancelling(true);
    try {
      const fresh = await fetchBalletApplicationDetail(application.id);
      if (!CANCELLABLE_APPLICATION_STATUSES.has(fresh.application.status)) {
        await load();
        alert.show({
          tone: "warning",
          title: "Application Changed",
          message: `${application.childName}'s application is no longer eligible for cancellation. Nothing was cancelled.`,
        });
        return;
      }
      await cancelBalletApplication(fresh.application.id, { reason });
      // Refresh to show updated status
      await load();
      closeReasonModal();
    } catch (err) {
      if (isOfflineError(err)) {
        alert.show({ tone: "error", title: "No Connection", message: "Please check your internet connection and try again." });
      } else {
        const msg =
          (err as any)?.data?.error ??
          (err as any)?.message ??
          "Unable to cancel. Please try again.";
        alert.show({ tone: "error", title: "Error", message: msg });
      }
    } finally {
      setCancelling(false);
    }
  }

  function requestCancellationFlow() {
    if (!application || !hasExplicitApplicationContext || !applicationDetail?.activeAssignment || requestingCancellation) return;
    alert.show({
      title: `Cancel ${application.childName}'s Ballet Program?`,
      message: `When should ${application.childName}'s enrollment cancellation take effect?`,
      actions: [
        { label: "Keep Enrollment", tone: "neutral" },
        { label: "End of Period", tone: "primary", onPress: () => confirmCancellationRefund("endOfPeriod") },
        { label: "Immediate", tone: "danger", onPress: () => confirmCancellationRefund("immediate") },
      ],
    });
  }

  function confirmCancellationRefund(requestedTiming: "immediate" | "endOfPeriod") {
    const eligiblePayment = applicationDetail?.currentPayment;
    const canRequestRefund =
      eligiblePayment?.status === "paid" &&
      eligiblePayment.paymentMethod === "inPerson" &&
      Boolean(eligiblePayment.paidAt);

    if (!canRequestRefund) {
      openReasonModal({ kind: "requestEnrollmentCancellation", requestedTiming, requestRefund: false });
      return;
    }

    // Neither option here is a "safe/cancel" choice — both proceed with the
    // cancellation, just with a different refund request — so unlike a
    // standard confirm/cancel pair this alert requires an explicit tap
    // (matches how it behaved on iOS, which has no backdrop-dismiss).
    alert.show({
      title: "Request Cash Refund?",
      message: "This will ask the studio to review a cash refund. You cannot choose or approve the amount from the app.",
      actions: [
        { label: "No Refund", tone: "primary", onPress: () => openReasonModal({ kind: "requestEnrollmentCancellation", requestedTiming, requestRefund: false }) },
        { label: "Request Cash Refund", tone: "primary", onPress: () => openReasonModal({ kind: "requestEnrollmentCancellation", requestedTiming, requestRefund: true }) },
      ],
    });
  }

  async function submitCancellationRequest(requestedTiming: "immediate" | "endOfPeriod", requestRefund: boolean, reason: string) {
    if (!application || !hasExplicitApplicationContext) return;
    const expectedAssignmentId = applicationDetail?.activeAssignment?.id;
    if (!expectedAssignmentId) return;
    setRequestingCancellation(true);
    try {
      const fresh = await fetchBalletApplicationDetail(application.id);
      const assignmentId = fresh.activeAssignment?.id;
      if (
        fresh.application.status !== "active"
        || fresh.activeAssignment?.status !== "active"
        || assignmentId !== expectedAssignmentId
        || fresh.openCancellationRequest != null
      ) {
        await load();
        alert.show({
          tone: "warning",
          title: "Enrollment Changed",
          message: `${application.childName}'s enrollment is no longer eligible for this request. Nothing was cancelled.`,
        });
        return;
      }
      await requestBalletEnrollmentCancellation(assignmentId, {
        requestedTiming,
        requestRefund,
        reason,
      });
      alert.show({ tone: "success", title: "Request Submitted", message: "Your Ballet cancellation request has been sent to the studio." });
      await load();
      closeReasonModal();
    } catch (err) {
      const msg = (err as any)?.data?.error ?? (err as any)?.message ?? "Unable to submit cancellation request.";
      alert.show({ tone: "error", title: isOfflineError(err) ? "No Connection" : "Error", message: msg });
    } finally {
      setRequestingCancellation(false);
    }
  }

  async function withdrawCancellationRequest() {
    const requestId = applicationDetail?.openCancellationRequest?.id;
    if (!requestId || requestingCancellation) return;
    setRequestingCancellation(true);
    try {
      await withdrawBalletEnrollmentCancellationRequest(requestId);
      alert.show({ tone: "success", title: "Request Withdrawn", message: "Your cancellation request has been withdrawn." });
      await load();
    } catch (err) {
      const msg = (err as any)?.data?.error ?? (err as any)?.message ?? "Unable to withdraw cancellation request.";
      alert.show({ tone: "error", title: isOfflineError(err) ? "No Connection" : "Error", message: msg });
    } finally {
      setRequestingCancellation(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const paddingTop = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop }]}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Ballet Application</Text>
        <TouchableOpacity
          onPress={() => router.replace("/(tabs)/" as any)}
          style={styles.iconBtn}
        >
          <Ionicons name="home-outline" size={20} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      {/* Loading */}
      {loadState === "loading" && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BALLET_COLOR} />
          <Text style={styles.loadingText}>Loading your application…</Text>
        </View>
      )}

      {/* Offline */}
      {loadState === "offline" && (
        <OfflineState onRetry={() => load()} />
      )}

      {/* Error */}
      {loadState === "error" && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
          <Text style={styles.errorText}>Failed to load your application.</Text>
          <AppButton title="Retry" variant="ghost" onPress={() => load()} style={{ marginTop: 16 }} />
        </View>
      )}

      {/* No applications */}
      {loadState === "empty" && (
        <View style={styles.centered}>
          <Ionicons name="document-outline" size={48} color="#4B5563" />
          <Text style={[styles.loadingText, { color: "#9CA3AF" }]}>
            No applications found.
          </Text>
          <AppButton
            title="Apply for Ballet Assessment"
            onPress={() => router.replace("/ballet/assessment" as any)}
            style={{ marginTop: 20, backgroundColor: BALLET_COLOR }}
          />
        </View>
      )}

      {/* Application detail */}
      {loadState === "success" && application && (() => {
        const levelName = application.assignedLevelId != null ? levelNameById.get(application.assignedLevelId) : null;
        const groupName = application.assignedGroupId != null ? groupNameById.get(application.assignedGroupId) : null;
        const groupSchedules = application.assignedGroupId != null ? schedulesByGroupId.get(application.assignedGroupId) : undefined;
        const meta = getStatusMeta(application.status, levelName, groupName, groupSchedules);
        const isCancellable = hasExplicitApplicationContext && CANCELLABLE_APPLICATION_STATUSES.has(application.status);
        const isEditable    = EDITABLE_APPLICATION_STATUSES.has(application.status);
        const isTerminal    = !ACTIVE_APPLICATION_STATUSES.has(application.status);
        const activeAssignment = applicationDetail?.activeAssignment;
        const openCancellationRequest = applicationDetail?.openCancellationRequest;
        const canRequestEnrollmentCancellation = hasExplicitApplicationContext && application.status === "active" && activeAssignment?.status === "active" && !openCancellationRequest;
        const canWithdrawCancellationRequest = hasExplicitApplicationContext && openCancellationRequest?.status === "pendingReview";

        return (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Status card */}
            <View style={[styles.statusCard, { borderColor: meta.color + "40" }]}>
              <View style={[styles.statusIcon, { backgroundColor: meta.color + "20" }]}>
                <Ionicons name={meta.icon} size={40} color={meta.color} />
              </View>
              <View style={[styles.statusBadge, { backgroundColor: meta.color + "20" }]}>
                <Text style={[styles.statusBadgeText, { color: meta.color }]}>
                  {meta.label}
                </Text>
              </View>
              <Text style={styles.statusDesc}>{meta.description}</Text>
            </View>

            {/* Application info */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Application Details</Text>

              <InfoRow label="Child" value={application.childName} />
              {application.assessmentDate && (
                <InfoRow label="Assessment Date" value={application.assessmentDate} />
              )}
              <InfoRow
                label="Submitted"
                value={new Date(application.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              />
              <InfoRow label="Application ID" value={`#${application.id}`} />
            </View>

            {/* D3: full monthly attendance section for an active Ballet
                student. attendanceSummary is populated whenever there's an
                active level assignment, whether or not there's a paid
                package for the current billing month — the distinct
                "no active monthly subscription" case is rendered explicitly
                below rather than hiding the section or showing zero hours. */}
            {application.status === "active" && application.attendanceSummary && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Monthly Attendance</Text>
                <InfoRow label="Billing Month" value={application.attendanceSummary.billingMonth} />
                {application.attendanceSummary.hasActiveSubscription ? (
                  <>
                    <InfoRow label="Monthly Hours" value={`${application.attendanceSummary.monthlyHours}h`} />
                    <InfoRow label="Attended" value={`${application.attendanceSummary.attendedHours}h`} />
                    <InfoRow label="Absent" value={`${application.attendanceSummary.absentHours}h`} />
                    <InfoRow label="Consumed" value={`${application.attendanceSummary.consumedHours}h`} />
                    <InfoRow label="Remaining" value={`${application.attendanceSummary.remainingHours}h`} />
                  </>
                ) : (
                  <>
                    <Text style={styles.adminNote}>
                      No active monthly subscription for {application.attendanceSummary.billingMonth}.
                    </Text>
                    <InfoRow label="Attended" value={`${application.attendanceSummary.attendedHours}h`} />
                    <InfoRow label="Absent" value={`${application.attendanceSummary.absentHours}h`} />
                  </>
                )}
              </View>
            )}

            {/* Admin notes (shown if present) */}
            {application.adminNotes ? (
              <View style={[styles.section, { borderColor: BALLET_COLOR + "30" }]}>
                <Text style={[styles.sectionTitle, { color: BALLET_COLOR }]}>
                  Note from Studio
                </Text>
                <Text style={styles.adminNote}>{application.adminNotes}</Text>
              </View>
            ) : null}

            {/* Next steps */}
            {application.status === "pending" && (
              <View style={styles.nextSteps}>
                <Text style={styles.nextStepsTitle}>What happens next?</Text>
                {[
                  "Our team reviews your application",
                  "We contact you to confirm your assessment appointment",
                  "Your child attends the 30-minute assessment session",
                  "You receive the result within 48 hours",
                ].map((s, i) => (
                  <View key={i} style={styles.nextStep}>
                    <View style={[styles.stepNum, { backgroundColor: BALLET_COLOR + "20" }]}>
                      <Text style={[styles.stepNumText, { color: BALLET_COLOR }]}>{i + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{s}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {!hasExplicitApplicationContext && (
                <View style={styles.contextWarning}>
                  <Text style={styles.contextWarningTitle}>Choose the child first</Text>
                  <Text style={styles.contextWarningText}>
                    This account has multiple Ballet applications. Use Manage Enrollment on the Ballet Program page to select the exact child before cancelling.
                  </Text>
                  <AppButton
                    title="Open Ballet Program"
                    variant="ghost"
                    onPress={() => router.replace("/ballet" as any)}
                    fullWidth
                  />
                </View>
              )}
              {isEditable && (
                <AppButton
                  title="Edit Application"
                  variant="ghost"
                  onPress={() =>
                    router.push({
                      pathname: "/ballet/edit-application" as any,
                      params: { id: String(application.id) },
                    })
                  }
                  fullWidth
                  style={{ borderColor: BALLET_COLOR + "60", borderWidth: 1 }}
                />
              )}

              {isCancellable && (
                <AppButton
                  title={cancelling ? "Cancelling…" : "Cancel Application"}
                  variant="ghost"
                  onPress={promptCancel}
                  disabled={cancelling}
                  fullWidth
                  style={{ borderColor: "#EF444440", borderWidth: 1 }}
                />
              )}

              {canRequestEnrollmentCancellation && (
                <AppButton
                  title={requestingCancellation ? "Submitting…" : "Request Ballet Cancellation"}
                  variant="ghost"
                  onPress={requestCancellationFlow}
                  disabled={requestingCancellation}
                  fullWidth
                  style={{ borderColor: "#EF444440", borderWidth: 1 }}
                />
              )}

              {openCancellationRequest && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {openCancellationRequest.status === "approved" ? "Cancellation Scheduled" : "Cancellation Request"}
                  </Text>
                  <InfoRow label="Status" value={openCancellationRequest.status} />
                  <InfoRow label="Timing" value={openCancellationRequest.approvedTiming ?? openCancellationRequest.requestedTiming} />
                  {openCancellationRequest.approvedEffectiveDate ? <InfoRow label="Effective Date" value={openCancellationRequest.approvedEffectiveDate} /> : null}
                  {canWithdrawCancellationRequest && (
                    <AppButton
                      title={requestingCancellation ? "Withdrawing…" : "Withdraw Cancellation Request"}
                      variant="ghost"
                      onPress={withdrawCancellationRequest}
                      disabled={requestingCancellation}
                      fullWidth
                      style={{ borderColor: "#EF444440", borderWidth: 1, marginTop: 12 }}
                    />
                  )}
                </View>
              )}

              {isTerminal && (
                <AppButton
                  title="Submit New Application"
                  onPress={() => router.replace("/ballet/assessment" as any)}
                  fullWidth
                  style={{ backgroundColor: BALLET_COLOR }}
                />
              )}

              <AppButton
                title="Back to Home"
                variant="ghost"
                onPress={() => router.replace("/(tabs)/" as any)}
                fullWidth
              />
            </View>
          </ScrollView>
        );
      })()}

      <Modal visible={reasonModal != null} transparent animationType="fade" onRequestClose={closeReasonModal}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.reasonSheet}>
            <Text style={styles.reasonTitle}>
              {reasonModal?.kind === "cancelApplication"
                ? `Cancel ${application?.childName ?? "Child"}'s Application`
                : `Cancel ${application?.childName ?? "Child"}'s Ballet Program`}
            </Text>
            <Text style={styles.reasonSubtitle}>
              Please tell the studio why you are making this request. This reason is shared with the Ballet admin team.
            </Text>
            <Text style={styles.reasonLabel}>
              Reason <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              value={reasonText}
              onChangeText={(value) => setReasonText(value.slice(0, 500))}
              placeholder="Write your reason…"
              placeholderTextColor="#6B7280"
              multiline
              textAlignVertical="top"
              style={[styles.reasonInput, reasonError && trimmedReason.length > 0 ? styles.reasonInputError : null]}
              editable={!cancelling && !requestingCancellation}
              maxLength={500}
            />
            <View style={styles.reasonMetaRow}>
              <Text style={[styles.reasonError, !reasonError || trimmedReason.length === 0 ? styles.reasonHint : null]}>
                {trimmedReason.length === 0 ? "Minimum 5 characters." : reasonError ?? "Looks good."}
              </Text>
              <Text style={styles.reasonCount}>{reasonText.length}/500</Text>
            </View>
            <View style={styles.reasonActions}>
              <AppButton title="Close" variant="ghost" onPress={closeReasonModal} disabled={cancelling || requestingCancellation} style={{ flex: 1 }} />
              <AppButton
                title={cancelling || requestingCancellation ? "Submitting…" : "Submit"}
                onPress={submitReasonModal}
                disabled={Boolean(reasonError) || cancelling || requestingCancellation}
                style={{ flex: 1, backgroundColor: BALLET_COLOR }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topBarTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: 20, gap: 16, paddingBottom: 60 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: BALLET_COLOR,
    textAlign: "center",
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#EF4444",
    textAlign: "center",
  },

  // Status card
  statusCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.studio.card,
  },
  statusIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusBadgeText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  statusDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 19,
  },

  // Section
  section: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1E2E38",
    padding: 16,
    gap: 10,
    backgroundColor: colors.studio.card,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2E38",
    gap: 12,
  },
  infoLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", flex: 1 },
  infoValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFF", flex: 2, textAlign: "right" },
  adminNote: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#E2E8F0",
    lineHeight: 20,
  },

  // Next steps
  nextSteps: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1E2E38",
    padding: 16,
    gap: 12,
    backgroundColor: "#0A1014",
  },
  nextStepsTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginBottom: 2,
  },
  nextStep: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stepText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    flex: 1,
    lineHeight: 18,
  },

  // Actions
  actions: { gap: 10, marginTop: 4 },
  contextWarning: {
    gap: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,182,214,0.28)",
    backgroundColor: "rgba(0,182,214,0.07)",
    padding: 14,
  },
  contextWarningTitle: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  contextWarningText: { color: "#9CA3AF", fontFamily: "Inter_400Regular", fontSize: 12.5, lineHeight: 18 },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
    padding: 16,
  },
  reasonSheet: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#1E2E38",
    backgroundColor: colors.studio.card,
    padding: 20,
    gap: 12,
  },
  reasonTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  reasonSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    lineHeight: 19,
  },
  reasonLabel: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: "#E5E7EB",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  required: { color: "#EF4444" },
  reasonInput: {
    minHeight: 132,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#243645",
    backgroundColor: "#080C11",
    padding: 14,
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  reasonInputError: {
    borderColor: "#EF4444",
  },
  reasonMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  reasonError: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#EF4444",
  },
  reasonHint: {
    color: "#9CA3AF",
  },
  reasonCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  reasonActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
});
