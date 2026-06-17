import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  BALLET_LEVELS,
  BALLET_PRICING,
  type BalletSettings,
  AssessmentSlot,
  fetchBalletSettings,
  fetchAssessmentSlots,
  fetchMyApplications,
  submitBalletApplication,
  ACTIVE_APPLICATION_STATUSES,
  isOfflineError,
} from "@/services/balletAssessmentService";
import { probeConnectivity } from "@/services/connectivity";

// NOTE: This screen is only navigated to when the ballet gate (app/ballet/index.tsx)
// has already confirmed there is no active application, OR from within the ballet
// flow after a terminal status (rejected/cancelled). Do NOT add a duplicate-app
// check here — index.tsx handles that redirect before this screen ever renders.
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import StepIndicator from "@/components/StepIndicator";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";

const BALLET_COLOR = "#00B6D6";
const STEPS = ["About You", "Child Info", "Experience", "Select Slot", "Review"];

type FormData = {
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  childName: string;
  childBirthday: string;
  childAge: string;
  childGender: "male" | "female";
  previousExperience: boolean | null;
  experienceDetails: string;
  medicalNotes: string;
  selectedSlot: AssessmentSlot | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
};

const INITIAL_FORM: FormData = {
  parentName: "",
  parentPhone: "",
  parentEmail: "",
  childName: "",
  childBirthday: "",
  childAge: "",
  childGender: "female",
  previousExperience: null,
  experienceDetails: "",
  medicalNotes: "",
  selectedSlot: null,
  emergencyContactName: "",
  emergencyContactPhone: "",
  notes: "",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad" | "numeric";
  multiline?: boolean;
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required && <Text style={{ color: BALLET_COLOR }}> *</Text>}
      </Text>
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

// ─── Date Picker ─────────────────────────────────────────────────────────────

const DP_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DP_MIN_YEAR = 2000;
const DP_MAX_YEAR = new Date().getFullYear() - 1;

function calcAgeFromDate(y: number, m: number, d: number): number {
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return Math.max(0, age);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function SpinnerCol({
  displayValue,
  onIncrement,
  onDecrement,
}: {
  displayValue: string;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <View style={dpStyles.col}>
      <TouchableOpacity onPress={onIncrement} style={dpStyles.arrowBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-up" size={22} color={BALLET_COLOR} />
      </TouchableOpacity>
      <Text style={dpStyles.spinnerValue}>{displayValue}</Text>
      <TouchableOpacity onPress={onDecrement} style={dpStyles.arrowBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-down" size={22} color={BALLET_COLOR} />
      </TouchableOpacity>
    </View>
  );
}

function DatePickerField({
  value,
  onChangeWithAge,
  label,
}: {
  value: string;
  onChangeWithAge: (dateStr: string, age: number) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  // Parse initial or default to ~8 years old
  const defaultYear = new Date().getFullYear() - 8;
  const parseInitial = () => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { y: +value.slice(0, 4), m: +value.slice(5, 7), d: +value.slice(8, 10) };
    }
    return { y: defaultYear, m: 1, d: 1 };
  };

  const init = parseInitial();
  const [year, setYear] = useState(init.y);
  const [month, setMonth] = useState(init.m);
  const [day, setDay] = useState(init.d);

  // Re-sync if external value changes
  useEffect(() => {
    const p = parseInitial();
    setYear(p.y); setMonth(p.m); setDay(p.d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const maxDay = daysInMonth(year, month);
  const clampedDay = Math.min(day, maxDay);

  // Clamp day if month/year changes makes it invalid
  useEffect(() => {
    if (day > daysInMonth(year, month)) setDay(daysInMonth(year, month));
  }, [year, month]);

  function handleConfirm() {
    const d = clampedDay;
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    onChangeWithAge(dateStr, calcAgeFromDate(year, month, d));
    setOpen(false);
  }

  const displayDate = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${String(+value.slice(8, 10)).padStart(2, "0")} ${DP_MONTHS[+value.slice(5, 7) - 1]} ${value.slice(0, 4)}`
    : "";

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.input, dpStyles.trigger]}
        activeOpacity={0.8}
      >
        <Text style={[dpStyles.triggerText, !displayDate && { color: "#4B5563" }]}>
          {displayDate || "Select date of birth"}
        </Text>
        <Ionicons name="calendar-outline" size={16} color={BALLET_COLOR} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={dpStyles.overlay}>
          <View style={dpStyles.sheet}>
            {/* Header */}
            <View style={dpStyles.sheetHeader}>
              <Text style={dpStyles.sheetTitle}>Date of Birth</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {/* Spinners */}
            <View style={dpStyles.spinners}>
              {/* Day */}
              <View style={dpStyles.spinnerWrap}>
                <Text style={dpStyles.spinnerLabel}>Day</Text>
                <SpinnerCol
                  displayValue={String(clampedDay).padStart(2, "0")}
                  onIncrement={() => setDay((d) => (d >= maxDay ? 1 : d + 1))}
                  onDecrement={() => setDay((d) => (d <= 1 ? maxDay : d - 1))}
                />
              </View>

              <View style={dpStyles.spinnerSep} />

              {/* Month */}
              <View style={dpStyles.spinnerWrap}>
                <Text style={dpStyles.spinnerLabel}>Month</Text>
                <SpinnerCol
                  displayValue={DP_MONTHS[month - 1] ?? ""}
                  onIncrement={() => setMonth((m) => (m >= 12 ? 1 : m + 1))}
                  onDecrement={() => setMonth((m) => (m <= 1 ? 12 : m - 1))}
                />
              </View>

              <View style={dpStyles.spinnerSep} />

              {/* Year */}
              <View style={dpStyles.spinnerWrap}>
                <Text style={dpStyles.spinnerLabel}>Year</Text>
                <SpinnerCol
                  displayValue={String(year)}
                  onIncrement={() => setYear((y) => Math.min(y + 1, DP_MAX_YEAR))}
                  onDecrement={() => setYear((y) => Math.max(y - 1, DP_MIN_YEAR))}
                />
              </View>
            </View>

            {/* Preview */}
            <View style={dpStyles.preview}>
              <Text style={dpStyles.previewDate}>
                {String(clampedDay).padStart(2, "0")} {DP_MONTHS[month - 1]} {year}
              </Text>
              <Text style={dpStyles.previewAge}>
                Age: {calcAgeFromDate(year, month, clampedDay)} years old
              </Text>
            </View>

            {/* Confirm */}
            <TouchableOpacity onPress={handleConfirm} style={dpStyles.confirmBtn} activeOpacity={0.85}>
              <Text style={dpStyles.confirmText}>Confirm Date</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const dpStyles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  triggerText: {
    flex: 1,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0F0A1E",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: BALLET_COLOR + "30",
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 20,
    gap: 20,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  spinners: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    backgroundColor: "#071418",
    borderRadius: 16,
    padding: 16,
  },
  spinnerWrap: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  spinnerLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  col: {
    alignItems: "center",
    gap: 12,
  },
  arrowBtn: {
    padding: 4,
  },
  spinnerValue: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    minWidth: 60,
    textAlign: "center",
  },
  spinnerSep: {
    width: 1,
    height: 80,
    backgroundColor: "#2A2A35",
    marginHorizontal: 4,
  },
  preview: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BALLET_COLOR + "30",
    backgroundColor: BALLET_COLOR + "0A",
  },
  previewDate: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: BALLET_COLOR,
  },
  previewAge: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
  },
  confirmBtn: {
    backgroundColor: BALLET_COLOR,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
});

// ─────────────────────────────────────────────────────────────────────────────

export default function BalletAssessmentScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  // Note: success/duplicate navigation goes to /ballet/application-status — no local "submitted" state.

  // ── Connectivity gate ──────────────────────────────────────────────────────
  // We probe connectivity on mount so offline users see OfflineState immediately
  // rather than navigating into the form and hitting an error at step 3.
  const [connectivity, setConnectivity] = useState<"checking" | "online" | "offline">("checking");

  // ── Live settings (pricing from admin) ────────────────────────────────────
  const [liveSettings, setLiveSettings] = useState<BalletSettings | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    fetchBalletSettings()
      .then((s) => { if (active) setLiveSettings(s); })
      .catch(() => { /* keep BALLET_PRICING fallback on error */ });
    return () => { active = false; };
  }, []));

  // Pricing shown on Review step — live from admin settings, with static fallback
  const displayPricing = liveSettings
    ? [
        { level: "Pre-Ballet", hours: `${liveSettings.preBallet.monthlyHours} hours monthly`, price: liveSettings.preBallet.priceEgp },
        { level: "Levels 1–9", hours: `${liveSettings.levels19.monthlyHours} hours monthly`, price: liveSettings.levels19.priceEgp },
      ]
    : BALLET_PRICING;

  // ── Slot data state ────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<AssessmentSlot[]>([]);
  const [slotsState, setSlotsState] = useState<"idle" | "loading" | "success" | "empty" | "error" | "offline">("idle");

  const loadSlots = useCallback(async (signal?: AbortSignal) => {
    setSlotsState("loading");
    try {
      const data = await fetchAssessmentSlots(signal);
      setSlots(data);
      setSlotsState(data.length === 0 ? "empty" : "success");
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setSlotsState(isOfflineError(e) ? "offline" : "error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // 1. Probe connectivity.
    // 2. If online, load slots immediately — no need to re-check for active
    //    applications here because the ballet gate (app/ballet/index.tsx) already
    //    verified there are none before navigating to this screen.
    probeConnectivity(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        setConnectivity(status);
        if (status === "online") loadSlots(controller.signal);
      })
      .catch(() => {
        // AbortError from navigation — ignore.
      });

    return () => controller.abort();
  }, [loadSlots]);

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!form.parentName.trim()) return "Parent full name is required.";
      if (!form.parentPhone.trim()) return "Parent phone is required.";
      if (!form.parentEmail.trim()) return "Parent email is required.";
      if (!form.emergencyContactName.trim()) return "Emergency contact name is required.";
      if (!form.emergencyContactPhone.trim()) return "Emergency contact phone is required.";
    }
    if (step === 1) {
      if (!form.childName.trim()) return "Child's full name is required.";
      if (!form.childAge.trim() || isNaN(Number(form.childAge))) return "A valid age is required.";
    }
    if (step === 2) {
      if (form.previousExperience === null) return "Please indicate previous dance experience.";
    }
    if (step === 3) {
      if (!form.selectedSlot) return "Please select an assessment appointment slot.";
    }
    return null;
  }

  function handleNext() {
    const err = validateStep();
    if (err) { Alert.alert("Required", err); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function handleBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    if (!form.selectedSlot || submitting) return;

    const slotId = parseInt(form.selectedSlot.id, 10);
    if (isNaN(slotId)) {
      Alert.alert("Error", "Invalid slot selection. Please go back and select a slot again.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSubmitting(true);

    try {
      await submitBalletApplication({
        parentName:             form.parentName.trim(),
        parentPhone:            form.parentPhone.trim(),
        parentEmail:            form.parentEmail.trim(),
        childName:              form.childName.trim(),
        childBirthday:          form.childBirthday.trim() || undefined,
        childAge:               form.childAge.trim() ? parseInt(form.childAge, 10) : undefined,
        childGender:            form.childGender,
        previousExperience:     form.previousExperience ?? false,
        experienceDetails:      form.experienceDetails.trim() || undefined,
        medicalNotes:           form.medicalNotes.trim() || undefined,
        emergencyContactName:   form.emergencyContactName.trim() || undefined,
        emergencyContactPhone:  form.emergencyContactPhone.trim() || undefined,
        notes:                  form.notes.trim() || undefined,
        slotId,
      });

      // ── 201 Success: navigate to status screen ──────────────────────────
      router.replace("/ballet/application-status" as any);
    } catch (err: unknown) {
      const typed = err as { status?: number; data?: { code?: string; error?: string }; message?: string };

      // ── 409 Duplicate application ───────────────────────────────────────
      // Server returned 409 with code DUPLICATE_APPLICATION — this parent
      // already has an active application for this child. Treat it the same
      // as a successful submit and navigate to the status screen.
      if (typed.status === 409 && typed.data?.code === "DUPLICATE_APPLICATION") {
        router.replace("/ballet/application-status" as any);
        return;
      }

      // ── 409 Slot full ───────────────────────────────────────────────────
      if (typed.status === 409) {
        Alert.alert(
          "Slot Full",
          "The assessment slot you selected has just filled up. Please go back and choose a different slot."
        );
        // Reload slots so the user sees updated availability
        loadSlots();
        return;
      }

      // ── TypeError — possible dropped response after server commit ────────
      // React Native throws TypeError: "Network request failed" when the
      // connection drops AFTER the server has committed the insert but BEFORE
      // the 201 response arrives on the device. We don't know whether the
      // server actually saved the record, so we probe the server.
      if (isOfflineError(err)) {
        try {
          // Small delay to let connectivity recover, then check.
          await new Promise((r) => setTimeout(r, 1_500));
          const apps = await fetchMyApplications();
          const hasActive = apps.some((a) => ACTIVE_APPLICATION_STATUSES.has(a.status));
          if (hasActive) {
            // Server did commit — redirect as if success.
            router.replace("/ballet/application-status" as any);
            return;
          }
        } catch {
          // /my fetch also failed (still offline). Fall through to the alert.
        }

        Alert.alert(
          "No Connection",
          "Unable to reach the server. Please check your internet connection and try again. If you submitted before, your application may already be saved."
        );
        return;
      }

      // ── Other server errors ─────────────────────────────────────────────
      const serverMsg =
        typed.data?.error ??
        typed.message ??
        "Something went wrong. Please try again.";
      Alert.alert("Submission Failed", serverMsg);
    } finally {
      setSubmitting(false);
    }
  }

  // Show offline gate while checking, or if offline
  if (connectivity !== "online") {
    const handleConnectivityRetry = () => {
      setConnectivity("checking");
      const controller = new AbortController();
      probeConnectivity(controller.signal)
        .then((status) => {
          setConnectivity(status);
          if (status === "online") loadSlots();
        })
        .catch(() => {});
    };

    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.topBarCenter}>
            <Text style={styles.topBarTitle}>Ballet Assessment</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        {connectivity === "offline" ? (
          <OfflineState onRetry={handleConnectivityRetry} />
        ) : (
          // "checking" state — blank while we probe
          <View style={{ flex: 1 }} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={step === 0 ? () => router.back() : handleBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Ballet Assessment</Text>
          <Text style={styles.topBarSub}>Step {step + 1} of {STEPS.length}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <StepIndicator current={step + 1} total={STEPS.length} labels={STEPS} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Parent / Guardian Information</Text>
              <Text style={styles.stepDesc}>As most applications are submitted by parents, please fill in your details.</Text>
            </View>
            <Field label="Parent Full Name" value={form.parentName} onChange={(v) => update("parentName", v)} placeholder="Your full name" required />
            <Field label="Phone Number" value={form.parentPhone} onChange={(v) => update("parentPhone", v)} placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" required />
            <Field label="Email Address" value={form.parentEmail} onChange={(v) => update("parentEmail", v)} placeholder="your@email.com" keyboardType="email-address" required />
            <View style={styles.divider} />
            <Text style={styles.subSectionLabel}>Emergency Contact</Text>
            <Field label="Emergency Contact Name" value={form.emergencyContactName} onChange={(v) => update("emergencyContactName", v)} placeholder="Full name" required />
            <Field label="Emergency Contact Phone" value={form.emergencyContactPhone} onChange={(v) => update("emergencyContactPhone", v)} placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" required />
          </View>
        )}

        {step === 1 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Child Information</Text>
              <Text style={styles.stepDesc}>Tell us about the child applying for the ballet assessment.</Text>
            </View>
            <Field label="Child Full Name" value={form.childName} onChange={(v) => update("childName", v)} placeholder="Child's full name" required />
            <DatePickerField
              label="Date of Birth"
              value={form.childBirthday}
              onChangeWithAge={(dateStr, age) => {
                update("childBirthday", dateStr);
                update("childAge", String(age));
              }}
            />
            <Field label="Age" value={form.childAge} onChange={(v) => update("childAge", v)} placeholder="Age (auto-filled from date)" keyboardType="numeric" required />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Gender</Text>
              <View style={styles.genderRow}>
                {(["female", "male"] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    onPress={() => update("childGender", g)}
                    style={[styles.genderBtn, form.childGender === g && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "15" }]}
                  >
                    <Text style={[styles.genderBtnText, form.childGender === g && { color: BALLET_COLOR }]}>
                      {g === "female" ? "Girl" : "Boy"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Field label="Medical Notes or Injuries" value={form.medicalNotes} onChange={(v) => update("medicalNotes", v)} placeholder="Any conditions, injuries, or medical info the instructor should know..." multiline />
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Dance Experience</Text>
              <Text style={styles.stepDesc}>This helps us understand your child's starting level.</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Previous ballet or dance experience?</Text>
              <View style={styles.yesNoRow}>
                {[true, false].map((val) => (
                  <TouchableOpacity
                    key={String(val)}
                    onPress={() => update("previousExperience", val)}
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
                onChange={(v) => update("experienceDetails", v)}
                placeholder="School name, years of experience, styles studied..."
                multiline
              />
            )}

            <Field
              label="Additional Notes"
              value={form.notes}
              onChange={(v) => update("notes", v)}
              placeholder="Anything else you'd like us to know..."
              multiline
            />

            <View style={styles.levelsInfo}>
              <Text style={styles.levelsInfoTitle}>Ballet Levels</Text>
              <View style={styles.levelsList}>
                {BALLET_LEVELS.map((level, i) => (
                  <View key={level} style={styles.levelItem}>
                    <View style={[styles.levelDot, { backgroundColor: BALLET_COLOR }]} />
                    <Text style={styles.levelText}>{level}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Choose Assessment Slot</Text>
              <Text style={styles.stepDesc}>Select your preferred assessment appointment. Each session is 30 minutes.</Text>
            </View>

            {/* Loading state */}
            {slotsState === "loading" && (
              <View style={styles.slotsPlaceholder}>
                <Ionicons name="time-outline" size={28} color={BALLET_COLOR} />
                <Text style={styles.slotsPlaceholderText}>Loading available slots…</Text>
              </View>
            )}

            {/* Offline state (detected while loading slots) */}
            {slotsState === "offline" && (
              <OfflineState
                variant="compact"
                onRetry={() => loadSlots()}
              />
            )}

            {/* Server/endpoint error — endpoint not ready yet */}
            {slotsState === "error" && (
              <ErrorState
                variant="compact"
                title="Slots Unavailable"
                message="Assessment slot booking is not yet available online. Please contact the studio to schedule your assessment."
                onRetry={() => loadSlots()}
              />
            )}

            {/* Empty — no future slots */}
            {slotsState === "empty" && (
              <View style={styles.slotsPlaceholder}>
                <Ionicons name="calendar-outline" size={28} color="#6B7280" />
                <Text style={[styles.slotsPlaceholderText, { color: "#9CA3AF" }]}>
                  No assessment slots are currently available. Please check back soon or contact the studio.
                </Text>
              </View>
            )}

            {/* Success — render live slots from backend */}
            {slotsState === "success" && slots.map((slot) => {
              const isSelected = form.selectedSlot?.id === slot.id;
              const isFull = slot.status === "full";
              return (
                <TouchableOpacity
                  key={slot.id}
                  onPress={() => {
                    if (!isFull) {
                      Haptics.selectionAsync();
                      update("selectedSlot", slot);
                    }
                  }}
                  disabled={isFull}
                  style={[
                    styles.slotCard,
                    isSelected && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "10" },
                    isFull && { opacity: 0.4 },
                  ]}
                  activeOpacity={0.8}
                >
                  <View style={styles.slotLeft}>
                    <Text style={styles.slotDay}>{slot.dayOfWeek}</Text>
                    <Text style={styles.slotDate}>{slot.date}</Text>
                    <Text style={styles.slotTime}>{slot.startTime} – {slot.endTime}</Text>
                  </View>
                  <View style={styles.slotRight}>
                    <View style={[
                      styles.slotStatusBadge,
                      {
                        backgroundColor:
                          slot.status === "available" ? "#22C55E20" :
                          slot.status === "fewSeats" ? "#F59E0B20" : "#EF444420",
                      },
                    ]}>
                      <Text style={[
                        styles.slotStatusText,
                        {
                          color:
                            slot.status === "available" ? "#22C55E" :
                            slot.status === "fewSeats" ? "#F59E0B" : "#EF4444",
                        },
                      ]}>
                        {isFull ? "Full" : slot.status === "fewSeats" ? `${slot.availableSeats} left` : "Available"}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={BALLET_COLOR} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 4 && (
          <View style={styles.stepWrap}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Review & Submit</Text>
              <Text style={styles.stepDesc}>Please review your information before submitting.</Text>
            </View>

            {[
              { label: "Parent Name", value: form.parentName },
              { label: "Parent Phone", value: form.parentPhone },
              { label: "Parent Email", value: form.parentEmail },
              { label: "Emergency Contact", value: `${form.emergencyContactName} · ${form.emergencyContactPhone}` },
            ].map((item) => (
              <View key={item.label} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{item.label}</Text>
                <Text style={styles.reviewValue}>{item.value || "—"}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            {[
              { label: "Child Name", value: form.childName },
              { label: "Child Age", value: `${form.childAge} years old` },
              { label: "Child Gender", value: form.childGender === "female" ? "Girl" : "Boy" },
              { label: "Date of Birth", value: form.childBirthday || "Not provided" },
              { label: "Experience", value: form.previousExperience ? "Yes" : form.previousExperience === false ? "No" : "—" },
              { label: "Medical Notes", value: form.medicalNotes || "None" },
            ].map((item) => (
              <View key={item.label} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{item.label}</Text>
                <Text style={styles.reviewValue}>{item.value}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            <View style={[styles.slotReview, { borderColor: BALLET_COLOR + "40" }]}>
              <Ionicons name="calendar" size={18} color={BALLET_COLOR} />
              <View>
                <Text style={styles.slotReviewLabel}>Assessment Appointment</Text>
                <Text style={[styles.slotReviewValue, { color: BALLET_COLOR }]}>
                  {form.selectedSlot?.dayOfWeek} {form.selectedSlot?.date}
                </Text>
                <Text style={styles.slotReviewTime}>
                  {form.selectedSlot?.startTime} – {form.selectedSlot?.endTime}
                </Text>
              </View>
            </View>

            <View style={styles.pricingBox}>
              <Text style={styles.pricingTitle}>Ballet Pricing (if accepted)</Text>
              {displayPricing.map((p) => (
                <View key={p.level} style={styles.pricingRow}>
                  <View>
                    <Text style={styles.pricingLevel}>{p.level}</Text>
                    <Text style={styles.pricingHours}>{p.hours}</Text>
                  </View>
                  <Text style={[styles.pricingAmount, { color: BALLET_COLOR }]}>EGP {p.price.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Platform.OS === "web" ? 24 : (insets.bottom || 16) + 8 }]}>
        {step > 0 && (
          <AppButton title="Back" variant="ghost" onPress={handleBack} style={{ flex: 1 }} />
        )}
        {step < STEPS.length - 1 ? (
          <AppButton title="Continue" onPress={handleNext} style={{ flex: 2 }} />
        ) : (
          <AppButton
            title={submitting ? "Submitting…" : "Submit Application"}
            onPress={handleSubmit}
            disabled={submitting}
            style={{ flex: 2, backgroundColor: BALLET_COLOR, opacity: submitting ? 0.7 : 1 }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
    alignItems: "center",
    justifyContent: "center",
  },
  topBarCenter: { flex: 1, alignItems: "center" },
  topBarTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  topBarSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  scroll: { paddingHorizontal: 20 },
  stepWrap: { gap: 14 },
  stepHeader: { gap: 6, marginBottom: 4 },
  stepTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  stepDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  input: {
    backgroundColor: "#1E1E26",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#2A2A35",
  },
  rowFields: { flexDirection: "row", gap: 10 },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2A2A35",
    backgroundColor: "#1E1E26",
  },
  genderBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  yesNoRow: { flexDirection: "row", gap: 10 },
  yesNoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A35",
    backgroundColor: "#1E1E26",
  },
  yesNoBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  subSectionLabel: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: -4 },
  divider: { height: 1, backgroundColor: "#1E2E38", marginVertical: 4 },
  slotsPlaceholder: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  slotsPlaceholderText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: BALLET_COLOR,
    textAlign: "center",
    lineHeight: 18,
  },
  slotCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E2E38",
    backgroundColor: colors.studio.card,
  },
  slotLeft: { gap: 3 },
  slotDay: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  slotDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  slotTime: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  slotRight: { alignItems: "flex-end", gap: 8 },
  slotStatusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  slotStatusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  levelsInfo: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#00B6D630",
    padding: 14,
    backgroundColor: "#071418",
    gap: 10,
    marginTop: 4,
  },
  levelsInfoTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#00B6D6" },
  levelsList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  levelItem: { flexDirection: "row", alignItems: "center", gap: 5, width: "47%" },
  levelDot: { width: 6, height: 6, borderRadius: 3 },
  levelText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  reviewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2E38",
    gap: 16,
  },
  reviewLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", flex: 1 },
  reviewValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFF", flex: 2, textAlign: "right" },
  slotReview: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#071418",
  },
  slotReviewLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  slotReviewValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  slotReviewTime: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pricingBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E2E38",
    padding: 14,
    gap: 10,
    backgroundColor: colors.studio.card,
  },
  pricingTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#9CA3AF" },
  pricingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pricingLevel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  pricingHours: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pricingAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.studio.background,
    borderTopWidth: 1,
    borderTopColor: "#1E2E38",
  },
  successHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14,
  },
  successHeaderBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center",
  },
  successHeaderTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  successWrap: { flex: 1, padding: 20 },
  successCard: { borderRadius: 24, padding: 24, gap: 16, alignItems: "center" },
  successIcon: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center" },
  successDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 19 },
  successInfo: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    width: "100%",
    backgroundColor: "#0A1014",
  },
  successInfoTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFFFFF", marginBottom: 4 },
  successStep: { flexDirection: "row", alignItems: "center", gap: 10 },
  successStepNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  successStepNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  successStepText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", flex: 1 },
  existingCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 14,
    alignItems: "center",
    backgroundColor: colors.studio.card,
  },
  statusRow: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, width: "100%", alignItems: "center" },
  statusLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
