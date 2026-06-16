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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";

import {
  fetchMyApplications,
  cancelBalletApplication,
  CANCELLABLE_APPLICATION_STATUSES,
  EDITABLE_APPLICATION_STATUSES,
  ACTIVE_APPLICATION_STATUSES,
  type BalletApplication,
  isOfflineError,
} from "@/services/balletAssessmentService";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import OfflineState from "@/components/OfflineState";

const BALLET_COLOR = "#A78BFA";

// ─── Status meta ──────────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
}

function getStatusMeta(status: string): StatusMeta {
  switch (status) {
    case "submitted":
      return {
        label: "Under Review",
        description:
          "Your application has been received. Our team is reviewing it and will reach out to confirm your assessment appointment.",
        icon: "time-outline",
        color: "#F59E0B",
      };
    case "pendingAssessment":
      return {
        label: "Assessment Scheduled",
        description:
          "Your assessment appointment has been confirmed. Please ensure your child attends on the scheduled date.",
        icon: "calendar-outline",
        color: "#60A5FA",
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
        description:
          "Your child has been assessed and assigned to a ballet level. Enrolment can now be completed.",
        icon: "ribbon-outline",
        color: BALLET_COLOR,
      };
    case "activeBallet":
      return {
        label: "Active Student",
        description:
          "Your child is currently an active ballet student at Central Studio.",
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

  const [loadState, setLoadState] = useState<"loading" | "success" | "empty" | "offline" | "error">("loading");
  const [application, setApplication] = useState<BalletApplication | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    try {
      const apps = await fetchMyApplications(signal);
      if (signal?.aborted) return;

      if (apps.length === 0) {
        setLoadState("empty");
        return;
      }

      // Prefer the latest ACTIVE application (API returns newest-first,
      // so find() picks the most recently created active one).
      // Fall back to apps[0] (most recent overall) if all are terminal,
      // so the parent can still see their most recent history.
      const active = apps.find((a) => ACTIVE_APPLICATION_STATUSES.has(a.status));
      setApplication(active ?? apps[0]!);
      setLoadState("success");
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setLoadState(isOfflineError(e) ? "offline" : "error");
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // ── Cancel handler ─────────────────────────────────────────────────────────

  function promptCancel() {
    Alert.alert(
      "Cancel Application",
      "Are you sure you want to cancel your ballet application? You will be able to submit a new application afterwards.",
      [
        { text: "Keep Application", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: doCancel,
        },
      ]
    );
  }

  async function doCancel() {
    if (!application || cancelling) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCancelling(true);
    try {
      await cancelBalletApplication(application.id);
      // Refresh to show updated status
      await load();
    } catch (err) {
      if (isOfflineError(err)) {
        Alert.alert("No Connection", "Please check your internet connection and try again.");
      } else {
        const msg =
          (err as any)?.data?.error ??
          (err as any)?.message ??
          "Unable to cancel. Please try again.";
        Alert.alert("Error", msg);
      }
    } finally {
      setCancelling(false);
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
        const meta = getStatusMeta(application.status);
        const isCancellable = CANCELLABLE_APPLICATION_STATUSES.has(application.status);
        const isEditable    = EDITABLE_APPLICATION_STATUSES.has(application.status);
        const isTerminal    = !ACTIVE_APPLICATION_STATUSES.has(application.status);

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
              {application.slotLabel && (
                <InfoRow label="Assessment Slot" value={application.slotLabel} />
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
            {application.status === "submitted" && (
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
});
