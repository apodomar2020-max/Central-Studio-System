import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import { probeConnectivity } from "@/services/connectivity";
import type { BalletPaymentMethod } from "@workspace/api-zod";

// NOTE: This screen is only navigated to when the ballet gate (app/ballet/index.tsx)
// has already confirmed there is no active application, OR from within the ballet
// flow after a terminal status (rejected/cancelled). Do NOT add a duplicate-app
// check here — index.tsx handles that redirect before this screen ever renders.
import { useAppContext, type ChildProfile } from "@/contexts/AppContext";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { showAuthRequiredPrompt, showParentAccountRequiredPrompt } from "@/utils/authRequired";

/* ─── Design tokens (home-ballet2.jsx visual system) ─────────────── */
const BASE    = "#0A0B0D";
const CARD    = "#15171B";
const SURFACE = "#22262C";
const CYAN    = "#00B6D7";
const AMBER   = "#FFB02E";
const SUCCESS = "#1FB871";
const DANGER  = "#FF3B47";
const INK_200 = "#D1D5DB";
const INK_300 = "#9CA3AF";
const INK_400 = "#4B5563";
const BALLET_COLOR = CYAN; // keep the existing semantic name; aligned to the design cyan
// C1: "Payment Method" sits between slot selection and the final Review, per
// the original spec (payment-method choice before Review).
const STEPS = ["About You", "Child Info", "Experience", "Select Slot", "Payment Method", "Review"];

// C1: parent-facing labels for the three app-layer payment methods.
const PAYMENT_METHOD_OPTIONS: { value: BalletPaymentMethod; label: string; hint: string }[] = [
  { value: "bankTransfer", label: "Bank Transfer",     hint: "Transfer to the studio's bank account" },
  { value: "kashier",      label: "Kashier",           hint: "Pay online via Kashier" },
  { value: "inPerson",     label: "Pay at the Studio", hint: "Settle in person at reception" },
];

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
  preferredPaymentMethod: BalletPaymentMethod | null;
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
  preferredPaymentMethod: null,
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
        style={[styles.input, styles.inputText, multiline && { minHeight: 72 }]}
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

/**
 * Effective age at time of use — always recomputed fresh from the birthday
 * (never trusts a possibly-stale stored `age` field, including for a
 * selected saved child). Falls back to the stored/typed age string only
 * when no birthday is available at all.
 */
function computeEffectiveAge(birthday: string, fallbackAgeStr: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    const y = +birthday.slice(0, 4);
    const m = +birthday.slice(5, 7);
    const d = +birthday.slice(8, 10);
    return calcAgeFromDate(y, m, d);
  }
  const n = parseInt(fallbackAgeStr, 10);
  return Number.isNaN(n) ? null : n;
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
    fontFamily: "Archivo_400Regular",
    fontSize: 15,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: CYAN + "30",
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
    fontFamily: "Archivo_800ExtraBold",
    color: "#FFFFFF",
  },
  spinners: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    backgroundColor: BASE,
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
    fontFamily: "SpaceMono_700Bold",
    color: INK_400,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  col: {
    alignItems: "center",
    gap: 12,
  },
  arrowBtn: {
    padding: 4,
  },
  spinnerValue: {
    fontSize: 30,
    fontFamily: "Anton_400Regular",
    color: "#FFFFFF",
    ...iosDisplayTextStyle(30, 35),
    minWidth: 60,
    textAlign: "center",
  },
  spinnerSep: {
    width: 1,
    height: 80,
    backgroundColor: "rgba(255,255,255,0.10)",
    marginHorizontal: 4,
  },
  preview: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CYAN + "30",
    backgroundColor: CYAN + "0F",
  },
  previewDate: {
    fontSize: 16,
    fontFamily: "Archivo_800ExtraBold",
    color: CYAN,
  },
  previewAge: {
    fontSize: 12,
    fontFamily: "Archivo_400Regular",
    color: INK_300,
  },
  confirmBtn: {
    backgroundColor: CYAN,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 15,
    fontFamily: "Archivo_800ExtraBold",
    color: "#FFFFFF",
  },
});

// ─────────────────────────────────────────────────────────────────────────────

export default function BalletAssessmentScreen() {
  const insets = useSafeAreaInsets();
  const { user, children, addChild } = useAppContext();
  const [step, setStep] = useState(0);
  const [showIntro, setShowIntro] = useState(true);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);

  // ── Parent/child prefill (logged-in accounts only) ─────────────────────────
  const isLoggedIn = !!user;
  // Saved child profiles available to pick from (parents with synced children).
  const hasChildProfiles = isLoggedIn && children.length > 0;
  // Backend children.id of the picked saved child (null = manual entry).
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);
  // Whether the prefilled About You section is in (submission-only) edit mode.
  // Note: the Child Info identity fields (name/birthday/gender) have no such
  // edit-in-place mode — while selectedChildId is set, they stay locked to
  // the saved profile's values; "Enter a different child manually" is the
  // only way to change them (see clearChildSelection).
  const [editAboutYou, setEditAboutYou] = useState(false);
  const authPromptShownRef = useRef(false);
  const parentGatePromptShownRef = useRef(false);

  // Auth + account-type gate. Also blocks direct deep-link navigation
  // straight to this screen (not just the "Apply" button on app/ballet/index.tsx).
  useEffect(() => {
    if (!user) {
      if (!authPromptShownRef.current) {
        authPromptShownRef.current = true;
        showAuthRequiredPrompt();
        router.replace("/ballet" as any);
      }
      return;
    }
    if (user.accountType !== "parent") {
      if (!parentGatePromptShownRef.current) {
        parentGatePromptShownRef.current = true;
        showParentAccountRequiredPrompt();
        router.replace("/ballet" as any);
      }
      return;
    }
  }, [user]);

  // Prefill the parent fields from the logged-in account once — only filling
  // blanks so we never clobber something the user already typed.
  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      parentName: prev.parentName || user.fullName || "",
      parentEmail: prev.parentEmail || user.email || "",
      parentPhone: prev.parentPhone || user.phone || "",
    }));
  }, [user]);

  // Apply a saved child's details to the form (submission-only — never writes
  // back to the saved profile). Stores the backend childId for linking.
  function selectChild(c: ChildProfile) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const numericId = Number(c.id);
    setSelectedChildId(Number.isNaN(numericId) ? null : numericId);
    setForm((prev) => ({
      ...prev,
      childName: c.fullName ?? "",
      childBirthday: c.birthday || "",
      childAge: c.age ? String(c.age) : "",
      childGender: c.gender,
      medicalNotes: c.medicalNotes || prev.medicalNotes,
    }));
  }

  // Switch to manual child entry (no linked profile).
  function clearChildSelection() {
    setSelectedChildId(null);
    setForm((prev) => ({
      ...prev,
      childName: "",
      childBirthday: "",
      childAge: "",
      childGender: "female",
    }));
  }
  // Note: success/duplicate navigation goes to /ballet/application-status — no local "submitted" state.

  // ── Connectivity gate ──────────────────────────────────────────────────────
  // We probe connectivity on mount so offline users see OfflineState immediately
  // rather than navigating into the form and hitting an error at step 3.
  const [connectivity, setConnectivity] = useState<"checking" | "online" | "offline">("checking");

  // ── Live settings (pricing from admin) ────────────────────────────────────
  const [liveSettings, setLiveSettings] = useState<BalletSettings | null>(null);

  useFocusEffect(useCallback(() => {
    if (!user) return;
    let active = true;
    fetchBalletSettings()
      .then((s) => { if (active) setLiveSettings(s); })
      .catch(() => { /* keep BALLET_PRICING fallback on error */ });
    return () => { active = false; };
  }, [user]));

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

  // Recomputed fresh from the birthday on every render — see computeEffectiveAge.
  const effectiveAge = computeEffectiveAge(form.childBirthday, form.childAge);

  const loadSlots = useCallback(async (signal?: AbortSignal, age?: number) => {
    setSlotsState("loading");
    try {
      const data = await fetchAssessmentSlots(signal, age);
      setSlots(data);
      setSlotsState(data.length === 0 ? "empty" : "success");
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setSlotsState(isOfflineError(e) ? "offline" : "error");
    }
  }, []);

  // Connectivity probe — runs once per mount/user change only.
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    probeConnectivity(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        setConnectivity(status);
      })
      .catch(() => {
        // AbortError from navigation — ignore.
      });
    return () => controller.abort();
  }, [user]);

  // Slot loading — fires once connectivity is confirmed online, and again
  // whenever the effective age changes (selected child switched, or the
  // entered birthday changed) so the age-filtered list stays in sync. Also
  // clears any previously selected slot on every firing (a no-op on the very
  // first load, since selectedSlot starts null) — no need to re-check for
  // active applications here because the ballet gate (app/ballet/index.tsx)
  // already verified there are none before navigating to this screen.
  useEffect(() => {
    if (!user || connectivity !== "online") return;
    setForm((prev) => (prev.selectedSlot ? { ...prev, selectedSlot: null } : prev));
    const controller = new AbortController();
    loadSlots(controller.signal, effectiveAge ?? undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, connectivity, effectiveAge, loadSlots]);

  if (!user || user.accountType !== "parent") {
    return <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]} />;
  }

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // D5: sensitive-information confirmation. Editing the prefilled About You
  // fields here only affects this one Ballet application — it never writes
  // back to the saved account/profile. Reuses this file's existing
  // Alert.alert confirmation pattern (see promptCancel-style usage elsewhere
  // in this app) rather than introducing a new confirmation mechanism, and
  // only flips editAboutYou (i.e. only enables the editable fields) once the
  // parent has explicitly confirmed.
  function confirmEditAboutYou() {
    Alert.alert(
      "Edit for this application only",
      "Changing your name, phone, or email here only affects this Ballet application. Your saved account profile will not be updated.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", onPress: () => setEditAboutYou(true) },
      ],
    );
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
      if (computeEffectiveAge(form.childBirthday, form.childAge) == null) return "A valid age is required.";
    }
    if (step === 2) {
      if (form.previousExperience === null) return "Please indicate previous dance experience.";
    }
    if (step === 3) {
      if (!form.selectedSlot) return "Please select an assessment appointment slot.";
    }
    if (step === 4) {
      if (!form.preferredPaymentMethod) return "Please choose a payment method.";
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

    // Guard: the selected slot may have fallen out of the age-filtered list
    // (e.g. the child selection or birthday changed after it was picked, or
    // it filled up in the background). Never submit a stale slotId silently.
    if (!slots.some((s) => s.id === form.selectedSlot!.id)) {
      Alert.alert(
        "Slot No Longer Available",
        "Your selected assessment slot is no longer available for this child's age. Please choose a new slot."
      );
      update("selectedSlot", null);
      setStep(3);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSubmitting(true);

    // ── Manual entry: persist the child profile BEFORE submitting the ──────
    // application, so a retry after a later failure can reuse it as a saved
    // profile instead of re-entering it (and never creates a duplicate child
    // on retry, since selectedChildId is set immediately on success below).
    let childId = selectedChildId;
    let justCreatedChild = false;

    if (childId == null) {
      try {
        const newChild = await addChild({
          id: "",
          fullName: form.childName.trim(),
          birthday: form.childBirthday.trim(),
          age: effectiveAge ?? 0,
          gender: form.childGender,
          medicalNotes: form.medicalNotes.trim() || undefined,
        });
        if (!newChild) {
          // addChild already surfaced its own error Alert — nothing else to add.
          setSubmitting(false);
          return;
        }
        const numericId = Number(newChild.id);
        childId = Number.isNaN(numericId) ? null : numericId;
        justCreatedChild = true;
        if (childId != null) setSelectedChildId(childId);
      } catch {
        // addChild is designed to catch its own errors and return null, but
        // guard defensively so the button never gets stuck on "Submitting…".
        Alert.alert("Error", "Failed to save the child profile. Please try again.");
        setSubmitting(false);
        return;
      }
    }

    const childSavedNote = justCreatedChild
      ? " Your child's profile has been saved to your account — you can try again and select it as a saved profile."
      : "";

    try {
      await submitBalletApplication({
        parentName:             form.parentName.trim(),
        parentPhone:            form.parentPhone.trim(),
        parentEmail:            form.parentEmail.trim(),
        childName:              form.childName.trim(),
        childBirthday:          form.childBirthday.trim() || undefined,
        childAge:               effectiveAge ?? undefined,
        childGender:            form.childGender,
        previousExperience:     form.previousExperience ?? false,
        experienceDetails:      form.experienceDetails.trim() || undefined,
        medicalNotes:           form.medicalNotes.trim() || undefined,
        emergencyContactName:   form.emergencyContactName.trim() || undefined,
        emergencyContactPhone:  form.emergencyContactPhone.trim() || undefined,
        notes:                  form.notes.trim() || undefined,
        slotId,
        // C1: validated non-null by validateStep() before Review is reachable.
        preferredPaymentMethod: form.preferredPaymentMethod!,
        // Link the saved child profile when one was picked (backend verifies
        // ownership) — including one just created above for manual entry.
        childId:                childId ?? undefined,
      });

      // ── 201 Success: navigate to status screen ──────────────────────────
      router.replace("/ballet/application-status" as any);
    } catch (err: unknown) {
      const typed = err as { status?: number; data?: { code?: string; error?: string }; message?: string };

      // ── D4: 403 Parent account required ─────────────────────────────────
      // Defense in depth — the gate above (user.accountType !== "parent")
      // already keeps a Student-type account off this screen entirely, but
      // the server enforces the same rule independently (account type could
      // theoretically change between screen mount and submit). Handle it the
      // same way as the client-side gate: the existing conversion prompt,
      // which points at the existing profile-update route.
      if (typed.status === 403 && typed.data?.code === "PARENT_ACCOUNT_REQUIRED") {
        showParentAccountRequiredPrompt();
        return;
      }

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
          "The assessment slot you selected has just filled up. Please go back and choose a different slot." + childSavedNote
        );
        // Reload slots so the user sees updated availability
        loadSlots(undefined, effectiveAge ?? undefined);
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
          "Unable to reach the server. Please check your internet connection and try again. If you submitted before, your application may already be saved." + childSavedNote
        );
        return;
      }

      // ── Other server errors ─────────────────────────────────────────────
      const serverMsg =
        typed.data?.error ??
        typed.message ??
        "Something went wrong. Please try again.";
      Alert.alert("Submission Failed", serverMsg + childSavedNote);
    } finally {
      setSubmitting(false);
    }
  }

  // Show offline gate while checking, or if offline
  if (connectivity !== "online") {
    const handleConnectivityRetry = () => {
      setConnectivity("checking");
      const controller = new AbortController();
      // No need to call loadSlots() here — flipping connectivity to "online"
      // re-triggers the slot-loading effect above, which already carries the
      // current effectiveAge.
      probeConnectivity(controller.signal)
        .then((status) => setConnectivity(status))
        .catch(() => {});
    };

    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <LinearGradient
          colors={["rgba(0,182,215,0.18)", "rgba(0,182,215,0.05)", "transparent"]}
          locations={[0, 0.4, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.glow}
          pointerEvents="none"
        />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={CYAN} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Ballet Assessment</Text>
          <View style={{ width: 60 }} />
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

  // ── Intro / overview step (design parity: home-ballet2 Step1) ──
  if (showIntro) {
    const HOW_IT_WORKS = [
      { icon: "clipboard-outline", title: "Complete the form", desc: "Personal info, dance background, and physical details" },
      { icon: "camera-outline", title: "Submit your media", desc: "Profile photo, full-body photo, and optional video" },
      { icon: "calendar-outline", title: "Get your appointment", desc: "We'll contact you to schedule the assessment session" },
      { icon: "ribbon-outline", title: "Receive your result", desc: "Your level placement within 48 hours of the session" },
    ] as const;
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <LinearGradient
          colors={["rgba(0,182,215,0.18)", "rgba(0,182,215,0.05)", "transparent"]}
          locations={[0, 0.4, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.glow}
          pointerEvents="none"
        />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={CYAN} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Ballet Assessment</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}>
          <View style={styles.introHeader}>
            <View style={styles.introIconCircle}>
              <Ionicons name="sparkles-outline" size={36} color={CYAN} />
            </View>
            <Text style={styles.introTitle}>{"Ballet\nAssessment"}</Text>
            <Text style={styles.introLead}>A free placement assessment to find the perfect level for your dance journey.</Text>
          </View>

          {HOW_IT_WORKS.map((s) => (
            <View key={s.title} style={styles.introCard}>
              <View style={styles.introCardIcon}>
                <Ionicons name={s.icon as any} size={20} color={CYAN} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.introCardTitle}>{s.title}</Text>
                <Text style={styles.introCardDesc}>{s.desc}</Text>
              </View>
            </View>
          ))}

          <View style={styles.introFreeNote}>
            <Ionicons name="sparkles" size={15} color={CYAN} />
            <Text style={styles.introFreeText}>The placement assessment is completely free of charge.</Text>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Platform.OS === "web" ? 24 : (insets.bottom || 16) + 8 }]}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowIntro(false); }}
            style={[styles.btnPrimary, { flex: 1 }]}
            activeOpacity={0.88}
          >
            <Text style={styles.btnPrimaryText}>Start Application →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <LinearGradient
        colors={["rgba(0,182,215,0.18)", "rgba(0,182,215,0.05)", "transparent"]}
        locations={[0, 0.4, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.glow}
        pointerEvents="none"
      />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={step === 0 ? () => setShowIntro(true) : handleBack} style={styles.headerBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={CYAN} />
          <Text style={styles.headerBackText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Ballet Assessment</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Progress — segmented bar + step label (design parity) */}
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressSeg,
                { backgroundColor: i <= step ? CYAN : "rgba(255,255,255,0.08)" },
              ]}
            />
          ))}
        </View>
        <Text style={styles.progressLabel}>
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </Text>
      </View>

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
            {isLoggedIn && !editAboutYou ? (
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Name</Text><Text style={styles.summaryValue}>{form.parentName || "—"}</Text></View>
                <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Phone</Text><Text style={styles.summaryValue}>{form.parentPhone || "—"}</Text></View>
                <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Email</Text><Text style={styles.summaryValue}>{form.parentEmail || "—"}</Text></View>
                <TouchableOpacity onPress={confirmEditAboutYou} style={styles.editLink}>
                  <Ionicons name="create-outline" size={14} color={BALLET_COLOR} />
                  <Text style={styles.editLinkText}>Edit for this application</Text>
                </TouchableOpacity>
                <Text style={styles.summaryHint}>From your account. Editing here only changes this application.</Text>
              </View>
            ) : (
              <>
                <Field label="Parent Full Name" value={form.parentName} onChange={(v) => update("parentName", v)} placeholder="Your full name" required />
                <Field label="Phone Number" value={form.parentPhone} onChange={(v) => update("parentPhone", v)} placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" required />
                <Field label="Email Address" value={form.parentEmail} onChange={(v) => update("parentEmail", v)} placeholder="your@email.com" keyboardType="email-address" required />
              </>
            )}
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
            {hasChildProfiles && (
              <View style={{ gap: 8, marginBottom: 4 }}>
                <Text style={styles.subSectionLabel}>Select a child profile</Text>
                {children.map((c) => {
                  const selected = selectedChildId === Number(c.id);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => selectChild(c)}
                      style={[styles.childCard, selected && styles.childCardSelected]}
                    >
                      <View style={styles.childAvatar}>
                        <Ionicons name="happy-outline" size={18} color={BALLET_COLOR} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.childCardName}>{c.fullName}</Text>
                        <Text style={styles.childCardMeta}>
                          {c.age ? `${c.age} yrs` : "Age —"} · {c.gender === "female" ? "Girl" : "Boy"}
                          {c.birthday ? ` · ${c.birthday}` : ""}
                        </Text>
                      </View>
                      {selected && <Ionicons name="checkmark-circle" size={20} color={BALLET_COLOR} />}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity onPress={clearChildSelection} style={styles.editLink}>
                  <Ionicons name="add-circle-outline" size={14} color={BALLET_COLOR} />
                  <Text style={styles.editLinkText}>Enter a different child manually</Text>
                </TouchableOpacity>
              </View>
            )}

            {isLoggedIn && children.length === 0 && (
              <View style={styles.emptyChildBox}>
                <Text style={styles.emptyChildText}>
                  No saved child profiles yet. Add a child from your Profile to reuse it next time, or enter the details below for this application.
                </Text>
              </View>
            )}

            {/* Identity fields (name/birthday/gender) are locked to the saved
                profile's values whenever a real childId is attached — the
                only way to change them is "Enter a different child manually"
                above, which clears selectedChildId. */}
            {(!hasChildProfiles || selectedChildId == null) && (
              <>
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
              </>
            )}
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
                onRetry={() => loadSlots(undefined, effectiveAge ?? undefined)}
              />
            )}

            {/* Server/endpoint error — endpoint not ready yet */}
            {slotsState === "error" && (
              <ErrorState
                variant="compact"
                title="Slots Unavailable"
                message="Assessment slot booking is not yet available online. Please contact the studio to schedule your assessment."
                onRetry={() => loadSlots(undefined, effectiveAge ?? undefined)}
              />
            )}

            {/* Empty — no future slots (age-specific copy when we know the age) */}
            {slotsState === "empty" && (
              <View style={styles.slotsPlaceholder}>
                <Ionicons name="calendar-outline" size={28} color="#6B7280" />
                <Text style={[styles.slotsPlaceholderText, { color: "#9CA3AF" }]}>
                  {effectiveAge != null
                    ? `No assessment slots are currently available for age ${effectiveAge}. Please check back soon or contact the studio.`
                    : "No assessment slots are currently available. Please check back soon or contact the studio."}
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
                          slot.status === "available" ? SUCCESS + "22" :
                          slot.status === "fewSeats" ? AMBER + "22" : DANGER + "22",
                      },
                    ]}>
                      <Text style={[
                        styles.slotStatusText,
                        {
                          color:
                            slot.status === "available" ? SUCCESS :
                            slot.status === "fewSeats" ? AMBER : DANGER,
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
              <Text style={styles.stepTitle}>Payment Method</Text>
              <Text style={styles.stepDesc}>How would you like to pay for the ballet program? You can confirm the actual payment with the studio after acceptance.</Text>
            </View>

            {PAYMENT_METHOD_OPTIONS.map((opt) => {
              const isSelected = form.preferredPaymentMethod === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => { Haptics.selectionAsync(); update("preferredPaymentMethod", opt.value); }}
                  style={[
                    styles.slotCard,
                    isSelected && { borderColor: BALLET_COLOR, backgroundColor: BALLET_COLOR + "10" },
                  ]}
                  activeOpacity={0.8}
                >
                  <View style={styles.slotLeft}>
                    <Text style={styles.slotDay}>{opt.label}</Text>
                    <Text style={styles.slotTime}>{opt.hint}</Text>
                  </View>
                  <View style={styles.slotRight}>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={BALLET_COLOR} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 5 && (
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
              { label: "Child Age", value: effectiveAge != null ? `${effectiveAge} years old` : `${form.childAge} years old` },
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

            {selectedChildId != null ? (
              <View style={styles.linkedNote}>
                <Ionicons name="link" size={13} color={BALLET_COLOR} />
                <Text style={styles.linkedNoteText}>Linked to a saved child profile in your account.</Text>
              </View>
            ) : (
              <View style={styles.linkedNote}>
                <Ionicons name="save-outline" size={13} color={BALLET_COLOR} />
                <Text style={styles.linkedNoteText}>This child's profile will be saved to your account when you submit.</Text>
              </View>
            )}

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

            {/* C1: chosen payment method */}
            <View style={[styles.slotReview, { borderColor: BALLET_COLOR + "40" }]}>
              <Ionicons name="card-outline" size={18} color={BALLET_COLOR} />
              <View>
                <Text style={styles.slotReviewLabel}>Payment Method</Text>
                <Text style={[styles.slotReviewValue, { color: BALLET_COLOR }]}>
                  {PAYMENT_METHOD_OPTIONS.find((o) => o.value === form.preferredPaymentMethod)?.label ?? "—"}
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
          <TouchableOpacity onPress={handleBack} style={[styles.btnGhost, { flex: 1 }]} activeOpacity={0.85}>
            <Text style={styles.btnGhostText}>Back</Text>
          </TouchableOpacity>
        )}
        {step < STEPS.length - 1 ? (
          <TouchableOpacity onPress={handleNext} style={[styles.btnPrimary, { flex: 2 }]} activeOpacity={0.88}>
            <Text style={styles.btnPrimaryText}>Continue →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            style={[styles.btnPrimary, { flex: 2 }, submitting && { opacity: 0.6 }]}
            activeOpacity={0.88}
          >
            <Text style={styles.btnPrimaryText}>
              {submitting ? "Submitting…" : "Submit Application ✦"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BASE },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 280 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.14)",
  },
  headerBack: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 60 },
  headerBackText: { fontSize: 14, fontFamily: "Archivo_600SemiBold", color: CYAN },
  topBarTitle: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },

  // ── Progress (segmented + step label) ──
  progressWrap: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14 },
  progressTrack: { flexDirection: "row", gap: 3 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2 },
  progressLabel: {
    fontSize: 11,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: INK_400,
    marginTop: 8,
  },

  scroll: { paddingHorizontal: 20 },
  stepWrap: { gap: 14 },
  stepHeader: { gap: 6, marginBottom: 6 },
  stepTitle: { fontSize: 22, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  stepDesc: { fontSize: 13.5, fontFamily: "Archivo_400Regular", color: INK_300, lineHeight: 20 },
  introHeader: { alignItems: "center", paddingVertical: 20 },
  introIconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(0,182,215,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  introTitle: { fontSize: 44, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", textAlign: "center", lineHeight: 40, ...iosDisplayTextStyle(44, 40), marginBottom: 12 - iosCapGuard(44, 40) },
  introLead: { fontSize: 15, fontFamily: "Archivo_400Regular", color: "#B6BDC6", textAlign: "center", lineHeight: 23, maxWidth: 300 },
  introCard: { flexDirection: "row", gap: 13, padding: 13, marginBottom: 12, borderRadius: 14, backgroundColor: "rgba(0,182,215,0.07)", borderWidth: 1, borderColor: "rgba(0,182,215,0.16)" },
  introCardIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(0,182,215,0.12)", alignItems: "center", justifyContent: "center" },
  introCardTitle: { fontSize: 14.5, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  introCardDesc: { fontSize: 12.5, fontFamily: "Archivo_400Regular", color: INK_300, marginTop: 2, lineHeight: 18 },
  introFreeNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 12, backgroundColor: "rgba(0,182,215,0.08)", borderWidth: 1, borderColor: "rgba(0,182,215,0.22)", marginTop: 4 },
  introFreeText: { flex: 1, fontSize: 13, fontFamily: "Archivo_600SemiBold", color: CYAN, lineHeight: 18 },

  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_300 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
  },
  inputText: {
    color: "#FFFFFF",
    fontFamily: "Archivo_400Regular",
    fontSize: 15,
    ...iosTextInputStyle(15, 18),
  },
  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  genderBtnText: { fontSize: 13, fontFamily: "Archivo_700Bold", color: INK_400 },
  yesNoRow: { flexDirection: "row", gap: 10 },
  yesNoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  yesNoBtnText: { fontSize: 15, fontFamily: "Archivo_700Bold", color: INK_400 },
  subSectionLabel: {
    fontSize: 11,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: CYAN,
    marginBottom: 2,
  },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginVertical: 4 },
  slotsPlaceholder: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  slotsPlaceholderText: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: CYAN,
    textAlign: "center",
    lineHeight: 18,
  },
  slotCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: CARD,
  },
  slotLeft: { gap: 3 },
  slotDay: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  slotDate: { fontSize: 12, fontFamily: "Archivo_400Regular", color: INK_300 },
  slotTime: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  slotRight: { alignItems: "flex-end", gap: 8 },
  slotStatusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  slotStatusText: { fontSize: 11, fontFamily: "Archivo_700Bold" },
  levelsInfo: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CYAN + "30",
    padding: 14,
    backgroundColor: CARD,
    gap: 10,
    marginTop: 4,
  },
  levelsInfoTitle: {
    fontSize: 11,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: CYAN,
  },
  levelsList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  levelItem: { flexDirection: "row", alignItems: "center", gap: 5, width: "47%" },
  levelDot: { width: 6, height: 6, borderRadius: 3 },
  levelText: { fontSize: 12, fontFamily: "Archivo_400Regular", color: INK_300 },
  reviewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    gap: 16,
  },
  reviewLabel: { fontSize: 12.5, fontFamily: "Archivo_600SemiBold", color: INK_400, flex: 1 },
  reviewValue: { fontSize: 13, fontFamily: "Archivo_700Bold", color: "#FFFFFF", flex: 2, textAlign: "right" },
  slotReview: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: CARD,
  },
  slotReviewLabel: { fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_400 },
  slotReviewValue: { fontSize: 15, fontFamily: "Archivo_700Bold" },
  slotReviewTime: { fontSize: 12, fontFamily: "Archivo_400Regular", color: INK_300 },
  pricingBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 14,
    gap: 10,
    backgroundColor: CARD,
  },
  pricingTitle: {
    fontSize: 11,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: INK_300,
  },
  pricingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pricingLevel: { fontSize: 14, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  pricingHours: { fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_400 },
  pricingAmount: { fontSize: 19, fontFamily: "Anton_400Regular", ...iosDisplayTextStyle(19, 22) },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: BASE,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },

  // ── Footer buttons (design parity) ──
  btnPrimary: {
    paddingVertical: 15,
    backgroundColor: CYAN,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: CYAN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  btnPrimaryText: { fontSize: 15, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  btnGhost: {
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  btnGhostText: { fontSize: 15, fontFamily: "Archivo_700Bold", color: INK_200 },

  // ── Prefill: parent summary card ──
  summaryCard: { borderRadius: 16, borderWidth: 1, borderColor: CYAN + "30", backgroundColor: CYAN + "0D", padding: 14, gap: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  summaryLabel: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  summaryValue: { fontSize: 14, fontFamily: "Archivo_700Bold", color: "#FFFFFF", flexShrink: 1, textAlign: "right" },
  summaryHint: { fontSize: 11, fontFamily: "Archivo_400Regular", color: INK_400 },
  editLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  editLinkText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: CYAN },

  // ── Prefill: child selector cards ──
  childCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", backgroundColor: SURFACE },
  childCardSelected: { borderColor: CYAN, backgroundColor: CYAN + "15" },
  childAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: CYAN + "1F" },
  childCardName: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  childCardMeta: { fontSize: 12, fontFamily: "Archivo_400Regular", color: INK_300, marginTop: 1 },
  emptyChildBox: { borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", backgroundColor: CARD, padding: 12, marginBottom: 4 },
  emptyChildText: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_300, lineHeight: 19 },

  // ── Review: linked-profile note ──
  linkedNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  linkedNoteText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: CYAN },
});
