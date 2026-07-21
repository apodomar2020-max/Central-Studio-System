import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useMemo, useState } from "react";
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

import {
  cancelBalletApplication,
  fetchBalletApplicationDetail,
  fetchBalletGroups,
  fetchBalletLevels,
  fetchMyApplications,
  isOfflineError,
  requestBalletEnrollmentCancellation,
  type BalletApplication,
  type BalletApplicationDetail,
} from "@/services/balletAssessmentService";
import colors from "@/constants/colors";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import BalletCancellationTargetSelector, {
  type BalletCancellationSelectionKind,
} from "./BalletCancellationTargetSelector";
import {
  buildBalletCancellationTargets,
  findFreshCancellationTarget,
  type BalletCancellationTarget,
  type BalletCancellationTargetLists,
} from "./balletCancellationTargets";

const DANGER = colors.error;

type CancellationKind = "cancelApplication" | "cancelProgram";
type ReasonModalState =
  | { kind: "cancelApplication"; target: BalletCancellationTarget }
  | {
      kind: "cancelProgram";
      target: BalletCancellationTarget;
      requestedTiming: "immediate" | "endOfPeriod";
    };

type SelectorState = {
  kind: BalletCancellationSelectionKind;
  targets: BalletCancellationTarget[];
} | null;

const EMPTY_LISTS: BalletCancellationTargetLists = {
  cancelApplication: [],
  cancelProgram: [],
  cancellationRequests: [],
};

function targetSummary(target: BalletCancellationTarget): string {
  const parts = [target.levelName, target.groupName].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : `Status: ${target.applicationStatus}`;
}

export default function BalletProgramDangerZone({
  bottomInset = 0,
  onChanged,
}: {
  bottomInset?: number;
  onChanged?: () => void;
}) {
  const alert = useCentralAlert();
  const [ready, setReady] = useState(false);
  const [applications, setApplications] = useState<BalletApplication[]>([]);
  const [targetLists, setTargetLists] = useState<BalletCancellationTargetLists>(EMPTY_LISTS);
  const [busy, setBusy] = useState(false);
  const [selector, setSelector] = useState<SelectorState>(null);
  const [selectedTarget, setSelectedTarget] = useState<BalletCancellationTarget | null>(null);
  const [reasonModal, setReasonModal] = useState<ReasonModalState | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [requestRefund, setRequestRefund] = useState(false);

  const trimmedReason = reasonText.trim();
  const reasonError = trimmedReason.length === 0
    ? "Reason is required."
    : trimmedReason.length < 5
      ? "Reason must be at least 5 characters."
      : trimmedReason.length > 500
        ? "Reason must be at most 500 characters."
        : null;

  const fetchSnapshot = useCallback(async (signal?: AbortSignal) => {
    const apps = await fetchMyApplications(signal);
    if (signal?.aborted) return null;

    const [detailResults, levels, groups] = await Promise.all([
      Promise.allSettled(apps.map((application) => fetchBalletApplicationDetail(application.id, signal))),
      fetchBalletLevels(signal).catch(() => []),
      fetchBalletGroups(signal).catch(() => []),
    ]);
    if (signal?.aborted) return null;

    const detailsByApplicationId = new Map<number, BalletApplicationDetail | null>();
    detailResults.forEach((result, index) => {
      const application = apps[index];
      if (!application) return;
      detailsByApplicationId.set(
        application.id,
        result.status === "fulfilled" ? result.value : null,
      );
    });

    return {
      applications: apps,
      lists: buildBalletCancellationTargets({
        applications: apps,
        detailsByApplicationId,
        levelNameById: new Map(levels.map((level) => [level.id, level.name])),
        groupNameById: new Map(groups.map((group) => [group.id, group.name])),
      }),
    };
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const snapshot = await fetchSnapshot(signal);
      if (!snapshot || signal?.aborted) return null;
      setApplications(snapshot.applications);
      setTargetLists(snapshot.lists);
      setReady(true);
      return snapshot;
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return null;
      setReady(true);
      return null;
    }
  }, [fetchSnapshot]);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      load(controller.signal);
      return () => controller.abort();
    }, [load]),
  );

  function closeSelector() {
    setSelector(null);
    setSelectedTarget(null);
  }

  function beginTargetedAction(kind: BalletCancellationSelectionKind, targets: BalletCancellationTarget[]) {
    if (targets.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (targets.length === 1) {
      const onlyTarget = targets.at(0);
      if (onlyTarget) continueWithTarget(kind, onlyTarget);
      return;
    }
    setSelectedTarget(null);
    setSelector({ kind, targets });
  }

  function continueSelectedTarget() {
    if (!selector || !selectedTarget) return;
    const kind = selector.kind;
    closeSelector();
    continueWithTarget(kind, selectedTarget);
  }

  function continueWithTarget(kind: BalletCancellationSelectionKind, target: BalletCancellationTarget) {
    if (kind === "viewRequest") {
      router.push({
        pathname: "/ballet/application-status" as never,
        params: { id: String(target.applicationId) },
      });
      return;
    }
    if (kind === "cancelApplication") {
      promptCancelApplication(target);
      return;
    }
    promptCancelProgram(target);
  }

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

  function promptCancelApplication(target: BalletCancellationTarget) {
    alert.show({
      tone: "destructive",
      title: `Cancel ${target.childName}'s Application?`,
      message: `${targetSummary(target)}. This cancels only ${target.childName}'s Ballet application. You can apply again afterwards.`,
      actions: [
        { label: "Keep Application", tone: "neutral" },
        { label: "Yes, Cancel", tone: "danger", onPress: () => openReasonModal({ kind: "cancelApplication", target }) },
      ],
    });
  }

  function promptCancelProgram(target: BalletCancellationTarget) {
    alert.show({
      tone: "destructive",
      title: `Cancel ${target.childName}'s Ballet Program?`,
      message: `${targetSummary(target)}. When should ${target.childName}'s enrollment cancellation take effect?`,
      actions: [
        { label: "Immediate", tone: "danger", onPress: () => openReasonModal({ kind: "cancelProgram", target, requestedTiming: "immediate" }) },
        { label: "End of Current Period", tone: "primary", onPress: () => openReasonModal({ kind: "cancelProgram", target, requestedTiming: "endOfPeriod" }) },
        { label: "Keep Enrollment", tone: "neutral" },
      ],
    });
  }

  async function submitReasonModal() {
    if (!reasonModal || reasonError || busy) return;
    setBusy(true);
    try {
      const snapshot = await fetchSnapshot();
      if (!snapshot) {
        await handleConflict("We couldn't refresh this enrollment. Nothing was cancelled.");
        return;
      }

      const kind: CancellationKind = reasonModal.kind;
      const freshTarget = findFreshCancellationTarget({
        lists: snapshot.lists,
        kind,
        applicationId: reasonModal.target.applicationId,
        assignmentId: reasonModal.target.assignmentId,
      });
      if (!freshTarget) {
        setApplications(snapshot.applications);
        setTargetLists(snapshot.lists);
        alert.show({
          tone: "warning",
          title: "Enrollment Changed",
          message: `${reasonModal.target.childName}'s application is no longer eligible for this action. Nothing was cancelled.`,
        });
        return;
      }

      if (reasonModal.kind === "cancelApplication") {
        await cancelBalletApplication(freshTarget.applicationId, {
          reason: trimmedReason,
          requestRefund,
        });
        alert.show({
          tone: "success",
          title: "Application Cancelled",
          message: `${freshTarget.childName}'s Ballet application has been cancelled.`,
        });
      } else {
        if (freshTarget.assignmentId == null) {
          await handleConflict("This enrollment is no longer active. Nothing was cancelled.");
          return;
        }
        await requestBalletEnrollmentCancellation(freshTarget.assignmentId, {
          requestedTiming: reasonModal.requestedTiming,
          reason: trimmedReason,
          requestRefund,
        });
        alert.show({
          tone: "success",
          title: "Request Submitted",
          message: `${freshTarget.childName}'s cancellation request was sent to the studio for review.`,
        });
      }

      setReasonModal(null);
      setReasonText("");
      setRequestRefund(false);
      await load();
      onChanged?.();
    } catch (error) {
      await handleMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleConflict(message: string) {
    await load();
    onChanged?.();
    alert.show({ tone: "warning", title: "Please try again", message });
  }

  async function handleMutationError(error: unknown) {
    const status = (error as { status?: number; response?: { status?: number } })?.status
      ?? (error as { response?: { status?: number } })?.response?.status;
    if (isOfflineError(error)) {
      alert.show({ tone: "error", title: "No Connection", message: "Please check your internet connection and try again." });
      return;
    }
    if (status === 409 || status === 422) {
      await load();
      onChanged?.();
      const message = (error as { data?: { error?: string } })?.data?.error
        ?? "This action is no longer available. We've refreshed your Ballet status.";
      alert.show({ tone: "warning", title: "Please try again", message });
      return;
    }
    const message = (error as { data?: { error?: string }; message?: string })?.data?.error
      ?? (error as { message?: string })?.message
      ?? "Something went wrong. Please try again.";
    alert.show({ tone: "error", title: "Error", message });
  }

  const hasOpenApplication = applications.some((application) => (
    ["pending", "needsFollowUp", "accepted", "assignedToLevel", "active"].includes(application.status)
  ));
  const hasActions = targetLists.cancelApplication.length > 0
    || targetLists.cancelProgram.length > 0
    || targetLists.cancellationRequests.length > 0;
  const canApplyAgain = ready && applications.length > 0 && !hasOpenApplication;
  const refundEligible = reasonModal?.target.refundEligible === true;

  const selectorTargetId = useMemo(() => selectedTarget?.applicationId ?? null, [selectedTarget]);

  if (!ready || (!hasActions && !canApplyAgain)) return null;

  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset }]}>
      <View style={styles.divider} />
      <Text style={styles.zoneLabel}>Manage Enrollment</Text>

      {targetLists.cancelApplication.length > 0 ? (
        <DangerButton
          label="Cancel Application"
          busy={busy}
          onPress={() => beginTargetedAction("cancelApplication", targetLists.cancelApplication)}
        />
      ) : null}

      {targetLists.cancelProgram.length > 0 ? (
        <DangerButton
          label="Cancel Program"
          busy={busy}
          onPress={() => beginTargetedAction("cancelProgram", targetLists.cancelProgram)}
        />
      ) : null}

      {targetLists.cancellationRequests.length > 0 ? (
        <TouchableOpacity
          style={styles.outlineBtn}
          onPress={() => beginTargetedAction("viewRequest", targetLists.cancellationRequests)}
          activeOpacity={0.85}
        >
          <Text style={styles.outlineBtnText}>View Cancellation Request</Text>
        </TouchableOpacity>
      ) : null}

      {canApplyAgain ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/ballet/assessment" as never)} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Apply Again</Text>
        </TouchableOpacity>
      ) : null}

      <BalletCancellationTargetSelector
        visible={selector != null}
        kind={selector?.kind ?? "cancelApplication"}
        targets={selector?.targets ?? []}
        selectedApplicationId={selectorTargetId}
        onSelect={setSelectedTarget}
        onClose={closeSelector}
        onContinue={continueSelectedTarget}
      />

      <Modal visible={reasonModal != null} transparent animationType="fade" onRequestClose={closeReasonModal}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {reasonModal?.kind === "cancelApplication"
                ? `Cancel ${reasonModal.target.childName}'s Application`
                : `Cancel ${reasonModal?.target.childName ?? "Child"}'s Program`}
            </Text>
            <Text style={styles.sheetCopy}>
              This request applies only to {reasonModal?.target.childName}. Please tell the studio why you are making it.
            </Text>

            <Text style={styles.fieldLabel}>Reason <Text style={styles.req}>*</Text></Text>
            <TextInput
              value={reasonText}
              onChangeText={(value) => setReasonText(value.slice(0, 500))}
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

            {refundEligible ? (
              <TouchableOpacity style={styles.refundRow} onPress={() => setRequestRefund((value) => !value)} disabled={busy} activeOpacity={0.8}>
                <View style={[styles.checkbox, requestRefund && styles.checkboxOn]}>
                  {requestRefund ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.refundLabel}>Request Cash Refund</Text>
                  <Text style={styles.refundSub}>The studio reviews the amount. You cannot enter or approve an amount here.</Text>
                </View>
              </TouchableOpacity>
            ) : null}

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
  zoneLabel: { fontSize: 11, fontFamily: "Archivo_700Bold", letterSpacing: 1, textTransform: "uppercase", color: "#8E97A2", marginBottom: 2 },
  dangerBtn: { width: "100%", minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,59,71,0.10)", borderWidth: 1, borderColor: "rgba(255,59,71,0.40)" },
  dangerBtnText: { color: DANGER, fontFamily: "Archivo_800ExtraBold", fontSize: 14.5 },
  outlineBtn: { width: "100%", minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.05)" },
  outlineBtnText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14.5 },
  primaryBtn: { width: "100%", minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryBtnText: { color: "#0A0B0D", fontFamily: "Archivo_800ExtraBold", fontSize: 14.5 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)", padding: 16 },
  sheet: { borderRadius: 24, borderWidth: 1, borderColor: "#1E2E38", backgroundColor: colors.studio.card, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 20, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  sheetCopy: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF", lineHeight: 19 },
  fieldLabel: { fontSize: 12, fontFamily: "Archivo_700Bold", color: "#E5E7EB", textTransform: "uppercase", letterSpacing: 0.5 },
  req: { color: DANGER },
  input: { minHeight: 120, borderRadius: 16, borderWidth: 1, borderColor: "#243645", backgroundColor: "#080C11", padding: 14, color: "#FFFFFF", fontSize: 14, fontFamily: "Archivo_400Regular", lineHeight: 20 },
  inputError: { borderColor: DANGER },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  hint: { flex: 1, fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  hintError: { color: DANGER },
  count: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B7280" },
  refundRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.03)" },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
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
