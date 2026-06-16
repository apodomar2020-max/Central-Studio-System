/**
 * app/ballet/edit-application.tsx
 *
 * Allows a parent to edit their ballet application while it is in an editable
 * status (submitted, pendingAssessment, needsFollowUp).
 *
 * Route params:
 *   id  — the application ID (string, parsed to int)
 *
 * Flow:
 *   1. Load the application from /api/ballet/applications/my.
 *   2. Pre-fill the form with existing field values.
 *   3. On save, PATCH /api/ballet/applications/:id with only changed fields.
 *   4. Navigate back to /ballet/application-status on success.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  AssessmentSlot,
  fetchAssessmentSlots,
  fetchMyApplications,
  updateBalletApplication,
  isOfflineError,
  type BalletApplication,
} from "@/services/balletAssessmentService";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import OfflineState from "@/components/OfflineState";

const BALLET_COLOR = "#A78BFA";

// ─── Form types ───────────────────────────────────────────────────────────────

type EditFormData = {
  parentPhone: string;
  parentEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  previousExperience: boolean | null;
  experienceDetails: string;
  medicalNotes: string;
  notes: string;
  selectedSlot: AssessmentSlot | null;
};

// ─── Field helper ─────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#4B5563"
        style={[styles.input, multiline && { minHeight: 72 }]}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
      />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditApplicationScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const applicationId = parseInt(id ?? "", 10);

  // Load state
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "offline">("loading");
  const [application, setApplication] = useState<BalletApplication | null>(null);

  // Slot state (for optional slot change)
  const [slots, setSlots] = useState<AssessmentSlot[]>([]);
  const [slotsState, setSlotsState] = useState<"idle" | "loading" | "done">("idle");
  const [showSlotPicker, setShowSlotPicker] = useState(false);

  // Form state
  const [form, setForm] = useState<EditFormData>({
    parentPhone: "",
    parentEmail: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    previousExperience: null,
    experienceDetails: "",
    medicalNotes: "",
    notes: "",
    selectedSlot: null,
  });

  const [saving, setSaving] = useState(false);

  // ── Load application ───────────────────────────────────────────────────────

  const loadApplication = useCallback(async (signal?: AbortSignal) => {
    if (isNaN(applicationId)) {
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    try {
      const apps = await fetchMyApplications(signal);
      if (signal?.aborted) return;
      const app = apps.find((a) => a.id === applicationId) ?? null;
      if (!app) {
        setLoadState("error");
        return;
      }
      setApplication(app);
      setForm({
        parentPhone:           app.parentPhone ?? "",
        parentEmail:           app.parentEmail ?? "",
        emergencyContactName:  app.emergencyContactName ?? "",
        emergencyContactPhone: app.emergencyContactPhone ?? "",
        previousExperience:    app.previousExperience,
        experienceDetails:     app.experienceDetails ?? "",
        medicalNotes:          app.medicalNotes ?? "",
        notes:                 app.notes ?? "",
        selectedSlot:          null, // no change by default
      });
      setLoadState("ready");
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setLoadState(isOfflineError(e) ? "offline" : "error");
    }
  }, [applicationId]);

  useEffect(() => {
    const ctrl = new AbortController();
    loadApplication(ctrl.signal);
    return () => ctrl.abort();
  }, [loadApplication]);

  // ── Load slots (lazy — only when the slot picker is opened) ───────────────

  async function openSlotPicker() {
    setShowSlotPicker(true);
    if (slotsState !== "idle") return;
    setSlotsState("loading");
    try {
      const data = await fetchAssessmentSlots();
      setSlots(data);
      setSlotsState("done");
    } catch {
      setSlotsState("done"); // show empty state
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!application || saving) return;

    const payload: Parameters<typeof updateBalletApplication>[1] = {};

    if (form.parentPhone.trim()           !== (application.parentPhone ?? ""))           payload.parentPhone           = form.parentPhone.trim();
    if (form.parentEmail.trim()           !== (application.parentEmail ?? ""))           payload.parentEmail           = form.parentEmail.trim();
    if (form.emergencyContactName.trim()  !== (application.emergencyContactName ?? ""))  payload.emergencyContactName  = form.emergencyContactName.trim();
    if (form.emergencyContactPhone.trim() !== (application.emergencyContactPhone ?? "")) payload.emergencyContactPhone = form.emergencyContactPhone.trim();
    if (form.experienceDetails.trim()     !== (application.experienceDetails ?? ""))     payload.experienceDetails     = form.experienceDetails.trim();
    if (form.medicalNotes.trim()          !== (application.medicalNotes ?? ""))          payload.medicalNotes          = form.medicalNotes.trim();
    if (form.notes.trim()                 !== (application.notes ?? ""))                 payload.notes                 = form.notes.trim();
    if (form.previousExperience !== null  && form.previousExperience !== application.previousExperience) {
      payload.previousExperience = form.previousExperience;
    }
    if (form.selectedSlot && parseInt(form.selectedSlot.id, 10) !== application.slotId) {
      payload.slotId = parseInt(form.selectedSlot.id, 10);
    }

    if (Object.keys(payload).length === 0) {
      Alert.alert("No Changes", "You haven't changed anything.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);

    try {
      await updateBalletApplication(applicationId, payload);
      router.replace("/ballet/application-status" as any);
    } catch (err: unknown) {
      const typed = err as { status?: number; data?: { error?: string }; message?: string };
      if (typed.status === 422) {
        Alert.alert("Cannot Edit", typed.data?.error ?? "This application can no longer be edited.");
        return;
      }
      if (typed.status === 409) {
        Alert.alert("Slot Full", "The selected assessment slot has just filled up. Please choose a different slot.");
        return;
      }
      if (isOfflineError(err)) {
        Alert.alert("No Connection", "Please check your internet connection and try again.");
        return;
      }
      Alert.alert("Error", typed.data?.error ?? typed.message ?? "Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
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
        <Text style={styles.topBarTitle}>Edit Application</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Loading */}
      {loadState === "loading" && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BALLET_COLOR} />
        </View>
      )}

      {/* Offline */}
      {loadState === "offline" && (
        <OfflineState onRetry={() => loadApplication()} />
      )}

      {/* Error */}
      {loadState === "error" && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
          <Text style={styles.errorText}>Could not load application.</Text>
          <AppButton title="Retry" variant="ghost" onPress={() => loadApplication()} style={{ marginTop: 16 }} />
        </View>
      )}

      {/* Form */}
      {loadState === "ready" && application && (
        <>
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Read-only summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Application for {application.childName}</Text>
              <Text style={styles.summaryMeta}>
                Submitted {new Date(application.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </Text>
              {application.slotLabel && !form.selectedSlot && (
                <Text style={styles.summarySlot}>
                  <Ionicons name="calendar-outline" size={12} color="#9CA3AF" /> {application.slotLabel}
                </Text>
              )}
              {form.selectedSlot && (
                <Text style={[styles.summarySlot, { color: BALLET_COLOR }]}>
                  <Ionicons name="calendar" size={12} color={BALLET_COLOR} /> New slot: {form.selectedSlot.dayOfWeek} {form.selectedSlot.date}, {form.selectedSlot.startTime}
                </Text>
              )}
            </View>

            <Text style={styles.sectionLabel}>Contact Details</Text>
            <Field
              label="Parent Phone"
              value={form.parentPhone}
              onChange={(v) => setForm((f) => ({ ...f, parentPhone: v }))}
              placeholder="+20 1XX XXX XXXX"
              keyboardType="phone-pad"
            />
            <Field
              label="Parent Email"
              value={form.parentEmail}
              onChange={(v) => setForm((f) => ({ ...f, parentEmail: v }))}
              placeholder="your@email.com"
              keyboardType="email-address"
            />

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Emergency Contact</Text>
            <Field
              label="Emergency Contact Name"
              value={form.emergencyContactName}
              onChange={(v) => setForm((f) => ({ ...f, emergencyContactName: v }))}
              placeholder="Full name"
            />
            <Field
              label="Emergency Contact Phone"
              value={form.emergencyContactPhone}
              onChange={(v) => setForm((f) => ({ ...f, emergencyContactPhone: v }))}
              placeholder="+20 1XX XXX XXXX"
              keyboardType="phone-pad"
            />

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Experience & Notes</Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Previous ballet or dance experience?</Text>
              <View style={styles.yesNoRow}>
                {[true, false].map((val) => (
                  <TouchableOpacity
                    key={String(val)}
                    onPress={() => setForm((f) => ({ ...f, previousExperience: val }))}
                    style={[
                      styles.yesNoBtn,
                      form.previousExperience === val && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "15" },
                    ]}
                  >
                    <Ionicons
                      name={val ? "checkmark-circle" : "close-circle"}
                      size={20}
                      color={form.previousExperience === val ? BALLET_COLOR : "#4B5563"}
                    />
                    <Text style={[styles.yesNoBtnText, form.previousExperience === val && { color: BALLET_COLOR }]}>
                      {val ? "Yes" : "No"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {form.previousExperience && (
              <Field
                label="Describe the experience"
                value={form.experienceDetails}
                onChange={(v) => setForm((f) => ({ ...f, experienceDetails: v }))}
                placeholder="School name, years of experience, styles studied..."
                multiline
              />
            )}

            <Field
              label="Medical Notes or Injuries"
              value={form.medicalNotes}
              onChange={(v) => setForm((f) => ({ ...f, medicalNotes: v }))}
              placeholder="Any conditions, injuries, or medical info the instructor should know..."
              multiline
            />
            <Field
              label="Additional Notes"
              value={form.notes}
              onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
              placeholder="Anything else you'd like us to know..."
              multiline
            />

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Assessment Slot</Text>
            <TouchableOpacity style={styles.slotPickerBtn} onPress={openSlotPicker} activeOpacity={0.8}>
              <View style={{ flex: 1 }}>
                {form.selectedSlot ? (
                  <>
                    <Text style={[styles.slotPickerValue, { color: BALLET_COLOR }]}>
                      {form.selectedSlot.dayOfWeek} {form.selectedSlot.date}
                    </Text>
                    <Text style={styles.slotPickerMeta}>{form.selectedSlot.startTime} – {form.selectedSlot.endTime}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.slotPickerValue}>Keep current slot</Text>
                    {application.slotLabel && (
                      <Text style={styles.slotPickerMeta}>{application.slotLabel}</Text>
                    )}
                  </>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#4B5563" />
            </TouchableOpacity>

            {/* Inline slot picker */}
            {showSlotPicker && (
              <View style={styles.slotList}>
                <TouchableOpacity
                  style={[styles.slotItem, !form.selectedSlot && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "10" }]}
                  onPress={() => { setForm((f) => ({ ...f, selectedSlot: null })); setShowSlotPicker(false); }}
                >
                  <Text style={[styles.slotItemText, !form.selectedSlot && { color: BALLET_COLOR }]}>Keep current slot</Text>
                </TouchableOpacity>

                {slotsState === "loading" && (
                  <ActivityIndicator size="small" color={BALLET_COLOR} style={{ marginVertical: 12 }} />
                )}

                {slotsState === "done" && slots.map((slot) => {
                  const isFull = slot.status === "full";
                  const isSelected = form.selectedSlot?.id === slot.id;
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      disabled={isFull}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setForm((f) => ({ ...f, selectedSlot: slot }));
                        setShowSlotPicker(false);
                      }}
                      style={[
                        styles.slotItem,
                        isSelected && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "10" },
                        isFull && { opacity: 0.4 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.slotItemText, isSelected && { color: BALLET_COLOR }]}>
                          {slot.dayOfWeek} {slot.date}
                        </Text>
                        <Text style={styles.slotItemMeta}>{slot.startTime} – {slot.endTime}</Text>
                      </View>
                      <Text style={{
                        fontSize: 11,
                        fontFamily: "Inter_600SemiBold",
                        color: slot.status === "available" ? "#22C55E" : slot.status === "fewSeats" ? "#F59E0B" : "#EF4444",
                      }}>
                        {isFull ? "Full" : slot.status === "fewSeats" ? `${slot.availableSeats} left` : "Available"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Platform.OS === "web" ? 24 : (insets.bottom || 16) + 8 }]}>
            <AppButton title="Cancel" variant="ghost" onPress={() => router.back()} style={{ flex: 1 }} />
            <AppButton
              title={saving ? "Saving…" : "Save Changes"}
              onPress={handleSave}
              disabled={saving}
              style={{ flex: 2, backgroundColor: BALLET_COLOR }}
            />
          </View>
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topBarTitle: { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#EF4444", textAlign: "center" },
  scroll: { padding: 20, gap: 14, paddingBottom: 24 },
  summaryCard: {
    borderRadius: 16, borderWidth: 1, borderColor: BALLET_COLOR + "30",
    padding: 14, backgroundColor: "#1A0D2D", gap: 4, marginBottom: 4,
  },
  summaryTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  summaryMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  summarySlot: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5 },
  divider: { height: 1, backgroundColor: "#1E2E38", marginVertical: 4 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  input: {
    backgroundColor: "#1E1E26", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 14,
    borderWidth: 1, borderColor: "#2A2A35",
  },
  yesNoRow: { flexDirection: "row", gap: 10 },
  yesNoBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
    borderColor: "#2A2A35", backgroundColor: "#1E1E26",
  },
  yesNoBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  slotPickerBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#1E1E26", borderRadius: 12, borderWidth: 1,
    borderColor: "#2A2A35", padding: 14,
  },
  slotPickerValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  slotPickerMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  slotList: { gap: 8, marginTop: 4 },
  slotItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#1E1E26", borderRadius: 12, borderWidth: 1,
    borderColor: "#2A2A35", padding: 12,
  },
  slotItemText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  slotItemMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  footer: {
    flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: colors.studio.background, borderTopWidth: 1, borderTopColor: "#1E2E38",
  },
});
