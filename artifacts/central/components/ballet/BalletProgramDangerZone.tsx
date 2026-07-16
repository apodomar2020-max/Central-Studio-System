/**
 * BalletProgramDangerZone
 *
 * A self-contained, full-width destructive cancellation action rendered at the
 * bottom of the Ballet program content. It reuses the exact same
 * Cancellation-Requests + Refunds workflow the application-status screen uses —
 * it never introduces a second cancellation architecture.
 *
 * Authoritative-state first: before it shows or executes any destructive
 * action it refetches the parent's current application status, current
 * assignment status, current open cancellation request, and refund eligibility
 * (on screen focus + after every mutation). It never renders an unconditional
 * Cancel button from stale local state — the visible action is derived from
 * server state via the shared resolveBalletDangerAction() rule.
 *
 * 409/422 conflicts (e.g. status changed under us, or a duplicate request) are
 * handled by refetching server state and showing a safe message.
 */

import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { resolveBalletDangerAction, type BalletDangerAction } from "@workspace/api-zod";
import {
  fetchMyApplications,
  fetchBalletApplicationDetail,
  cancelBalletApplication,
  requestBalletEnrollmentCancellation,
  withdrawBalletEnrollmentCancellationRequest,
  ACTIVE_APPLICATION_STATUSES,
  isOfflineError,
  type BalletApplication,
  type BalletApplicationDetail,
} from "@/services/balletAssessmentService";
import colors from "@/constants/colors";
import { useCentralAlert } from "@/hooks/useCentralAlert";

const DANGER = colors.error; // #FF3B47 — Central Studio semantic danger token (--cs-danger-500)

type ReasonModalState =
  | { kind: "cancelApplication" }
  | { kind: "cancelProgram"; requestedTiming: "immediate" | "endOfPeriod" };

function isRefundEligible(detail: BalletApplicationDetail | null): boolean {
  const payment = detail?.currentPayment;
  return Boolean(
    payment &&
      payment.status === "paid" &&
      payment.paymentMethod === "inPerson" &&
      payment.paidAt,
  );
}

export default function BalletProgramDangerZone({ bottomInset = 0 }: { bottomInset?: number }) {
  const alert = useCentralAlert();
  const [ready, setReady] = useState(false);
  const [application, setApplication] = useState<BalletApplication | null>(null);
  const [detail, setDetail] = useState<BalletApplicationDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const [reasonModal, setReasonModal] = useState<ReasonModalState | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [requestRefund, setRequestRefund] = useState(false);

  const trimmedReason = reasonText.trim();
  const reasonError =
    trimmedReason.length === 0
      ? "Reason is required."
      : trimmedReason.length < 5
        ? "Reason must be at least 5 characters."
        : trimmedReason.length > 500
          ? "Reason must be at most 500 characters."
          : null;

  // Authoritative refetch — current application status, assignment status,
  // open cancellation request, refund eligibility. No polling: runs on focus
  // and after every mutation.
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const apps = await fetchMyApplications(signal);
      if (signal?.aborted) return;
      if (apps.length === 0) {
        setApplication(null);
        setDetail(null);
        setReady(true);
        return;
      }
      const active = apps.find((a) => ACTIVE_APPLICATION_STATUSES.has(a.status));
      const selected = active ?? apps[0]!;
      setApplication(selected);
      try {
        const d = await fetchBalletApplicationDetail(selected.id, signal);
        if (!signal?.aborted) setDetail(d);
      } catch {
        if (!signal?.aborted) setDetail(null);
      }
      if (!signal?.aborted) setReady(true);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      // Best-effort — leave prior state; the zone simply won't render on first
      // failure. Program content above is unaffected.
      setReady(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const ctrl = new AbortController();
      load(ctrl.signal);
      return () => ctrl.abort();
    }, [load]),
  );

  function openReasonModal(next: ReasonModalState) {
    setReasonText("");
    setRequestRefund(false);
    setReasonModal(next);
  }

  function closeReasonModal() {
    if (busy) return;
    setReasonModal(null);
    setReasonText("");
    setRequestRefund(false);
  }

  function promptCancelApplication() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    alert.show({
      tone: "destructive",
      title: "Cancel Application",
      message: "Are you sure you want to cancel this Ballet application? You will be able to submit a new application afterwards.",
      actions: [
        { label: "Keep Application", tone: "neutral" },
        { label: "Yes, Cancel", tone: "danger", onPress: () => openReasonModal({ kind: "cancelApplication" }) },
      ],
    });
  }

  // "Cancel Program" — cancellation timing decision. Presentation and
  // behavior preserved exactly from the original CentralDecisionDialog
  // implementation: same title/message/option order/tones, backdrop press
  // and Android Back both resolve to "Keep Enrollment" (the dialog's
  // dismissible neutral action), never the destructive Immediate action.
  function promptCancelProgram() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    alert.show({
      tone: "destructive",
      title: "Cancel Program",
      message: "When would you like the enrollment cancellation to take effect? Your request will be reviewed by the studio.",
      actions: [
        { label: "Immediate", tone: "danger", onPress: () => chooseCancelProgramTiming("immediate") },
        { label: "End of Current Period", tone: "primary", onPress: () => chooseCancelProgramTiming("endOfPeriod") },
        { label: "Keep Enrollment", tone: "neutral" },
      ],
    });
  }

  function chooseCancelProgramTiming(requestedTiming: "immediate" | "endOfPeriod") {
    openReasonModal({ kind: "cancelProgram", requestedTiming });
  }

  async function submitReasonModal() {
    if (!reasonModal || reasonError || busy) return;
    setBusy(true);
    try {
      if (reasonModal.kind === "cancelApplication") {
        if (!application) return;
        await cancelBalletApplication(application.id, { reason: trimmedReason, requestRefund });
        alert.show({ tone: "success", title: "Application Cancelled", message: "Your Ballet application has been cancelled." });
      } else {
        const assignmentId = detail?.activeAssignment?.id;
        if (!assignmentId) { await handleConflict("This enrollment is no longer active."); return; }
        await requestBalletEnrollmentCancellation(assignmentId, {
          requestedTiming: reasonModal.requestedTiming,
          reason: trimmedReason,
          requestRefund,
        });
        alert.show({ tone: "success", title: "Request Submitted", message: "Your Ballet cancellation request has been sent to the studio for review." });
      }
      setReasonModal(null);
      setReasonText("");
      setRequestRefund(false);
      await load();
    } catch (err) {
      await handleMutationError(err);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    const requestId = detail?.openCancellationRequest?.id;
    if (!requestId || busy) return;
    setBusy(true);
    try {
      await withdrawBalletEnrollmentCancellationRequest(requestId);
      alert.show({ tone: "success", title: "Request Withdrawn", message: "Your cancellation request has been withdrawn." });
      await load();
    } catch (err) {
      await handleMutationError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleConflict(message: string) {
    await load();
    alert.show({ tone: "warning", title: "Please try again", message });
  }

  async function handleMutationError(err: unknown) {
    const status = (err as any)?.status ?? (err as any)?.response?.status;
    if (isOfflineError(err)) {
      alert.show({ tone: "error", title: "No Connection", message: "Please check your internet connection and try again." });
      return;
    }
    if (status === 409 || status === 422) {
      // Server state moved under us — refetch and show a safe message.
      await load();
      const msg = (err as any)?.data?.error ?? "This action is no longer available. We've refreshed your status.";
      alert.show({ tone: "warning", title: "Please try again", message: msg });
      return;
    }
    const msg = (err as any)?.data?.error ?? (err as any)?.message ?? "Something went wrong. Please try again.";
    alert.show({ tone: "error", title: "Error", message: msg });
  }

  // ── Derived action (authoritative) ──────────────────────────────────────────
  if (!ready || !detail) return null;

  const action: BalletDangerAction = resolveBalletDangerAction({
    applicationStatus: detail.application.status,
    assignmentStatus: detail.activeAssignment?.status ?? null,
    openCancellationRequestStatus: detail.openCancellationRequest?.status ?? null,
    viewer: "parent",
    reapplyAllowed: true,
  });

  if (action.kind === "none") return null;

  const refundEligible = isRefundEligible(detail);

  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset }]}>
      <View style={styles.divider} />
      <Text style={styles.zoneLabel}>Manage Enrollment</Text>

      {action.kind === "cancelApplication" && (
        <DangerButton label="Cancel Application" busy={busy} onPress={promptCancelApplication} />
      )}

      {action.kind === "cancelProgram" && (
        <DangerButton label="Cancel Program" busy={busy} onPress={promptCancelProgram} />
      )}

      {action.kind === "viewCancellationRequest" && (
        <>
          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => router.push("/ballet/application-status" as any)}
            activeOpacity={0.85}
          >
            <Text style={styles.outlineBtnText}>View Cancellation Request</Text>
          </TouchableOpacity>
          {action.canWithdraw && (
            <DangerButton
              label={busy ? "Withdrawing…" : "Withdraw Cancellation Request"}
              busy={busy}
              onPress={withdraw}
            />
          )}
        </>
      )}

      {action.kind === "applyAgain" && (
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace("/ballet/assessment" as any)}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Apply Again</Text>
        </TouchableOpacity>
      )}

      {/* Reason / timing / refund modal */}
      <Modal visible={reasonModal != null} transparent animationType="fade" onRequestClose={closeReasonModal}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {reasonModal?.kind === "cancelApplication" ? "Cancel Application" : "Cancel Program"}
            </Text>

            {reasonModal?.kind === "cancelProgram" && (
              <Text style={styles.sheetCopy}>
                {reasonModal.requestedTiming === "immediate" ? "Immediate cancellation. " : "Cancellation at the end of the current period. "}
                Your request will be reviewed by the studio. Cancellation is not automatically a refund, and requesting a refund does not guarantee approval.
              </Text>
            )}

            <Text style={styles.fieldLabel}>Reason <Text style={styles.req}>*</Text></Text>
            <TextInput
              value={reasonText}
              onChangeText={(v) => setReasonText(v.slice(0, 500))}
              placeholder="Write your reason…"
              placeholderTextColor="#6B7280"
              multiline
              textAlignVertical="top"
              style={[styles.input, reasonError && trimmedReason.length > 0 ? styles.inputError : null]}
              editable={!busy}
              maxLength={500}
            />
            <View style={styles.metaRow}>
              <Text style={[styles.hint, reasonError && trimmedReason.length > 0 ? styles.hintError : null]}>
                {trimmedReason.length === 0 ? "Minimum 5 characters." : reasonError ?? "Looks good."}
              </Text>
              <Text style={styles.count}>{reasonText.length}/500</Text>
            </View>

            {refundEligible && (
              <TouchableOpacity
                style={styles.refundRow}
                onPress={() => setRequestRefund((v) => !v)}
                disabled={busy}
                activeOpacity={0.8}
              >
                <View style={[styles.checkbox, requestRefund && styles.checkboxOn]}>
                  {requestRefund && <Text style={styles.checkboxTick}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.refundLabel}>Request Cash Refund</Text>
                  <Text style={styles.refundSub}>The studio reviews the amount. You cannot enter or approve an amount here.</Text>
                </View>
              </TouchableOpacity>
            )}

            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.ghostBtn} onPress={closeReasonModal} disabled={busy}>
                <Text style={styles.ghostBtnText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, (Boolean(reasonError) || busy) && { opacity: 0.5 }]}
                onPress={submitReasonModal}
                disabled={Boolean(reasonError) || busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function DangerButton({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  return (
    <TouchableOpacity style={styles.dangerBtn} onPress={onPress} disabled={busy} activeOpacity={0.85}>
      <Text style={styles.dangerBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginBottom: 6 },
  zoneLabel: {
    fontSize: 11,
    fontFamily: "Archivo_700Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#8E97A2",
    marginBottom: 2,
  },
  dangerBtn: {
    width: "100%",
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,59,71,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,59,71,0.40)",
  },
  dangerBtnText: { color: DANGER, fontFamily: "Archivo_800ExtraBold", fontSize: 14.5 },
  outlineBtn: {
    width: "100%",
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  outlineBtnText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14.5 },
  primaryBtn: {
    width: "100%",
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyan,
  },
  primaryBtnText: { color: "#0A0B0D", fontFamily: "Archivo_800ExtraBold", fontSize: 14.5 },

  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)", padding: 16 },
  sheet: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#1E2E38",
    backgroundColor: colors.studio.card,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 20, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  sheetCopy: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF", lineHeight: 19 },
  fieldLabel: { fontSize: 12, fontFamily: "Archivo_700Bold", color: "#E5E7EB", textTransform: "uppercase", letterSpacing: 0.5 },
  req: { color: DANGER },
  input: {
    minHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#243645",
    backgroundColor: "#080C11",
    padding: 14,
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    lineHeight: 20,
  },
  inputError: { borderColor: DANGER },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  hint: { flex: 1, fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  hintError: { color: DANGER },
  count: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B7280" },
  refundRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  checkboxTick: { color: "#0A0B0D", fontSize: 13, fontFamily: "Archivo_800ExtraBold" },
  refundLabel: { fontSize: 14, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  refundSub: { fontSize: 11.5, fontFamily: "Archivo_400Regular", color: "#8E97A2", marginTop: 2, lineHeight: 16 },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  ghostBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  ghostBtnText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14.5 },
  submitBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: DANGER },
  submitBtnText: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 14.5 },
});
